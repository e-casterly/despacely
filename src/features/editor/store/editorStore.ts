import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import { useToastStore } from '@/stores/toasts'
import type { Command } from '../domain/commands'
import { createEmptyDocument } from '../domain/operations'
import type { SceneDocument } from '../domain/types'
import { documentDb } from '../persistence/documentDb'
import { History } from './history'

export type SaveState = 'saved' | 'saving' | 'error'

export const AUTOSAVE_DELAY_MS = 800

export const useEditorStore = defineStore('editor', () => {
  const toasts = useToastStore()

  const projectId = ref<string | null>(null)
  const doc = ref<SceneDocument | null>(null)
  const loadFailed = ref(false)
  const saveState = ref<SaveState>('saved')

  const history = new History()
  const canUndo = ref(false)
  const canRedo = ref(false)

  let saveTimer: ReturnType<typeof setTimeout> | undefined

  function syncHistory() {
    canUndo.value = history.canUndo
    canRedo.value = history.canRedo
  }

  function reportError(action: string, error: unknown) {
    console.error(`Failed to ${action}`, error)
    toasts.show(`Couldn't ${action}.`, 'error')
  }

  async function open(id: string) {
    projectId.value = id
    doc.value = null
    loadFailed.value = false
    saveState.value = 'saved'
    history.clear()
    syncHistory()
    try {
      const existing = await documentDb.get(id)
      if (existing) {
        doc.value = existing
      } else {
        doc.value = createEmptyDocument()
        await documentDb.save(id, toRaw(doc.value))
      }
    } catch (error) {
      loadFailed.value = true
      reportError('open the scene', error)
    }
  }

  /** The single channel for document edits: applies a command, then autosaves. */
  function apply(command: Command) {
    if (!doc.value) return
    history.apply(doc.value, command)
    syncHistory()
    scheduleSave()
  }

  function undo() {
    if (!doc.value || !history.canUndo) return
    history.undo(doc.value)
    syncHistory()
    scheduleSave()
  }

  function redo() {
    if (!doc.value || !history.canRedo) return
    history.redo(doc.value)
    syncHistory()
    scheduleSave()
  }

  /** Call after every document mutation; saves are debounced. */
  function scheduleSave() {
    if (!doc.value || projectId.value === null) return
    saveState.value = 'saving'
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void persist()
    }, AUTOSAVE_DELAY_MS)
  }

  async function persist() {
    if (!doc.value || projectId.value === null) return
    try {
      await documentDb.save(projectId.value, toRaw(doc.value))
      saveState.value = 'saved'
    } catch (error) {
      saveState.value = 'error'
      reportError('save the scene', error)
    }
  }

  /** Writes a pending debounced save immediately (tab close, leaving the editor). */
  async function flush() {
    if (saveTimer === undefined) return
    clearTimeout(saveTimer)
    saveTimer = undefined
    await persist()
  }

  async function close() {
    await flush()
    projectId.value = null
    doc.value = null
    loadFailed.value = false
    saveState.value = 'saved'
    history.clear()
    syncHistory()
  }

  return {
    projectId,
    doc,
    loadFailed,
    saveState,
    canUndo,
    canRedo,
    open,
    apply,
    undo,
    redo,
    scheduleSave,
    flush,
    close,
  }
})
