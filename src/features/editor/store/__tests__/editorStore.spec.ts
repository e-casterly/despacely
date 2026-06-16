import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from '@/stores/toasts'
import { AddItemCommand } from '../../domain/commands'
import { createEmptyDocument } from '../../domain/operations'
import type { Item } from '../../domain/types'
import { documentDb } from '../../persistence/documentDb'
import { AUTOSAVE_DELAY_MS, useEditorStore } from '../editorStore'

function makeItem(id = 'i1'): Item {
  return {
    id,
    kind: 'box',
    pos: { x: 0, y: 0 },
    size: { x: 60, y: 60 },
    height: 75,
    rotation: 0,
    color: '#94a3b8',
  }
}

vi.mock('../../persistence/documentDb', () => ({
  documentDb: {
    get: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  },
}))

const db = vi.mocked(documentDb)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('open', () => {
  it('loads an existing document', async () => {
    const existing = createEmptyDocument()
    db.get.mockResolvedValue(existing)
    const store = useEditorStore()

    await store.open('p1')

    expect(store.doc).toEqual(existing)
    expect(store.saveState).toBe('saved')
    expect(db.save).not.toHaveBeenCalled()
  })

  it('creates and persists an empty document when none exists', async () => {
    db.get.mockResolvedValue(undefined)
    db.save.mockResolvedValue('p1')
    const store = useEditorStore()

    await store.open('p1')

    expect(store.doc).toEqual(createEmptyDocument())
    expect(db.save).toHaveBeenCalledWith('p1', expect.objectContaining({ nodes: {}, walls: [] }))
  })

  it('sets loadFailed and shows a toast on failure', async () => {
    db.get.mockRejectedValue(new Error('boom'))
    const store = useEditorStore()
    const toasts = useToastStore()

    await store.open('p1')

    expect(store.loadFailed).toBe(true)
    expect(store.doc).toBeNull()
    expect(toasts.toasts[0]?.kind).toBe('error')
  })
})

describe('autosave', () => {
  async function openedStore() {
    db.get.mockResolvedValue(createEmptyDocument())
    const store = useEditorStore()
    await store.open('p1')
    db.save.mockClear()
    return store
  }

  it('debounces saves: many schedules, one write', async () => {
    const store = await openedStore()
    db.save.mockResolvedValue('p1')

    store.scheduleSave()
    store.scheduleSave()
    store.scheduleSave()
    expect(store.saveState).toBe('saving')
    expect(db.save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)

    expect(db.save).toHaveBeenCalledTimes(1)
    expect(store.saveState).toBe('saved')
  })

  it('sets error state and shows a toast when the write fails', async () => {
    const store = await openedStore()
    const toasts = useToastStore()
    db.save.mockRejectedValue(new Error('quota'))

    store.scheduleSave()
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)

    expect(store.saveState).toBe('error')
    expect(toasts.toasts[0]?.kind).toBe('error')
  })

  it('flush writes a pending save immediately', async () => {
    const store = await openedStore()
    db.save.mockResolvedValue('p1')

    store.scheduleSave()
    await store.flush()

    expect(db.save).toHaveBeenCalledTimes(1)
    expect(store.saveState).toBe('saved')

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS)
    expect(db.save).toHaveBeenCalledTimes(1)
  })

  it('flush without a pending save does nothing', async () => {
    const store = await openedStore()

    await store.flush()

    expect(db.save).not.toHaveBeenCalled()
  })
})

describe('history', () => {
  async function openedStore() {
    db.get.mockResolvedValue(createEmptyDocument())
    db.save.mockResolvedValue('p1')
    const store = useEditorStore()
    await store.open('p1')
    return store
  }

  it('applies a command, mutating the doc and enabling undo', async () => {
    const store = await openedStore()

    store.apply(new AddItemCommand(makeItem()))

    expect(store.doc?.items).toHaveLength(1)
    expect(store.canUndo).toBe(true)
    expect(store.canRedo).toBe(false)
    expect(store.saveState).toBe('saving')
  })

  it('undoes and redoes through the store', async () => {
    const store = await openedStore()
    store.apply(new AddItemCommand(makeItem()))

    store.undo()
    expect(store.doc?.items).toHaveLength(0)
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(true)

    store.redo()
    expect(store.doc?.items).toHaveLength(1)
    expect(store.canRedo).toBe(false)
  })

  it('resets history when opening another project', async () => {
    const store = await openedStore()
    store.apply(new AddItemCommand(makeItem()))
    expect(store.canUndo).toBe(true)

    await store.open('p2')
    expect(store.canUndo).toBe(false)
  })
})

describe('close', () => {
  it('flushes the pending save and resets state', async () => {
    db.get.mockResolvedValue(createEmptyDocument())
    db.save.mockResolvedValue('p1')
    const store = useEditorStore()
    await store.open('p1')

    store.scheduleSave()
    await store.close()

    expect(db.save).toHaveBeenCalled()
    expect(store.doc).toBeNull()
    expect(store.projectId).toBeNull()
    expect(store.saveState).toBe('saved')
  })
})
