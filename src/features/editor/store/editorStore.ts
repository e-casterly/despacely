import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { useToastStore } from '@/stores/toasts'
import { RemoveNodeCommand, RemoveRoomCommand, RemoveWallCommand, type Command } from '../domain/commands'
import { createEmptyDocument, findNode, findWall } from '../domain/operations'
import { findRoom, roomExclusiveWalls } from '../domain/rooms'
import type { SceneDocument } from '../domain/types'
import type { Selection } from '../tools/types'
import { documentDb } from '../persistence/documentDb'
import { History } from './history'

export type SaveState = 'saved' | 'saving' | 'error'

export const AUTOSAVE_DELAY_MS = 800

export const useEditorStore = defineStore('editor', () => {
  const toasts = useToastStore()

  const projectId = ref<string | null>(null)
  // shallowRef: the document is plain (no deep Vue proxy), so it stays
  // structured-cloneable for IndexedDB. Mutations are signalled via `revision`.
  const doc = shallowRef<SceneDocument | null>(null)
  const revision = ref(0)
  const loadFailed = ref(false)
  const saveState = ref<SaveState>('saved')

  const selection = ref<Selection | null>(null)

  const history = new History()
  const canUndo = ref(false)
  const canRedo = ref(false)

  function select(value: Selection | null) {
    selection.value = value
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined

  /** Bumped on any document change to drive the canvas redraw. */
  function bumpRevision() {
    revision.value++
  }

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
    selection.value = null
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
        await documentDb.save(id, doc.value)
      }
      bumpRevision()
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
    bumpRevision()
    scheduleSave()
  }

  /** Deletes the selected wall or vertex (with its walls) as one undoable command. */
  function deleteSelection() {
    if (!doc.value || !selection.value) return
    const target = selection.value
    selection.value = null
    // a stale selection (entity already gone via undo) clears without a command
    if (target.kind === 'wall') {
      if (findWall(doc.value, target.id)) apply(new RemoveWallCommand(target.id))
    } else if (target.kind === 'node') {
      if (findNode(doc.value, target.id)) apply(new RemoveNodeCommand(target.id))
    } else if (findRoom(doc.value, target.id)) {
      // a room fully enclosed by neighbours has nothing of its own to delete;
      // explain instead of pushing an empty history entry
      if (roomExclusiveWalls(doc.value, target.id).length === 0) {
        toasts.show("Couldn't delete the room: every wall is shared.", 'error')
      } else {
        apply(new RemoveRoomCommand(target.id))
      }
    }
  }

  function undo() {
    if (!doc.value || !history.canUndo) return
    history.undo(doc.value)
    syncHistory()
    bumpRevision()
    scheduleSave()
  }

  function redo() {
    if (!doc.value || !history.canRedo) return
    history.redo(doc.value)
    syncHistory()
    bumpRevision()
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
      await documentDb.save(projectId.value, doc.value)
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
    selection.value = null
    loadFailed.value = false
    saveState.value = 'saved'
    history.clear()
    syncHistory()
  }

  return {
    projectId,
    doc,
    revision,
    selection,
    loadFailed,
    saveState,
    canUndo,
    canRedo,
    open,
    select,
    apply,
    deleteSelection,
    undo,
    redo,
    scheduleSave,
    flush,
    close,
  }
})
