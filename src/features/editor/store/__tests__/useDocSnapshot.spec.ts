import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { AddWallCommand, SetWallPropsCommand } from '../../domain/commands'
import { createEmptyDocument } from '../../domain/operations'
import { documentDb } from '../../persistence/documentDb'
import { useEditorStore } from '../editorStore'
import { useDocSnapshot } from '../useDocSnapshot'

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
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

async function openedStore() {
  db.get.mockResolvedValue(createEmptyDocument())
  db.save.mockResolvedValue('p1')
  const store = useEditorStore()
  await store.open('p1')
  return store
}

describe('useDocSnapshot', () => {
  it('re-reads the doc when a command bumps the revision', async () => {
    const store = await openedStore()
    const thickness = useDocSnapshot((doc) => doc.walls[0]?.thickness)
    expect(thickness.value).toBeNull()

    store.apply(new AddWallCommand({ x: 0, y: 0 }, { x: 100, y: 0 }))
    expect(thickness.value).toBe(10)

    store.apply(new SetWallPropsCommand(store.doc!.walls[0]!.id, { thickness: 30 }))
    expect(thickness.value).toBe(30)

    store.undo()
    expect(thickness.value).toBe(10)
  })

  it("returns a copy, never the doc's own object", async () => {
    const store = await openedStore()
    store.apply(new AddWallCommand({ x: 0, y: 0 }, { x: 100, y: 0 }))

    const wall = useDocSnapshot((doc) => doc.walls[0])

    expect(wall.value).toEqual(store.doc!.walls[0])
    expect(wall.value).not.toBe(store.doc!.walls[0])
  })

  it('is null while no document is open', () => {
    useEditorStore()
    const count = useDocSnapshot((doc) => doc.walls.length)

    expect(count.value).toBeNull()
  })
})
