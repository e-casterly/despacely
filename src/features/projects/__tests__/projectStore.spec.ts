import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from '@/stores/toasts'
import { projectDb } from '../projectDb'
import { useProjectStore } from '../projectStore'
import type { Project } from '../types'

vi.mock('../projectDb', () => ({
  projectDb: {
    getAll: vi.fn<typeof projectDb.getAll>(),
    get: vi.fn<typeof projectDb.get>(),
    save: vi.fn<typeof projectDb.save>(),
    remove: vi.fn<typeof projectDb.remove>(),
    duplicate: vi.fn<typeof projectDb.duplicate>(),
  },
}))

const db = vi.mocked(projectDb)

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Project 1',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('load', () => {
  it('fills the list and clears loadFailed on success', async () => {
    const store = useProjectStore()
    db.getAll.mockResolvedValue([makeProject()])

    await store.load()

    expect(store.projects).toHaveLength(1)
    expect(store.loadFailed).toBe(false)
  })

  it('sets loadFailed and shows a toast when the db is unavailable', async () => {
    const store = useProjectStore()
    const toasts = useToastStore()
    db.getAll.mockRejectedValue(new Error('boom'))

    await store.load()

    expect(store.loadFailed).toBe(true)
    expect(toasts.toasts).toHaveLength(1)
    expect(toasts.toasts[0]?.kind).toBe('error')
  })
})

describe('create', () => {
  it('returns the project and adds it to the list on success', async () => {
    const store = useProjectStore()
    db.save.mockResolvedValue('id')

    const project = await store.create('New project')

    expect(project).toBeDefined()
    expect(store.projects).toHaveLength(1)
  })

  it('returns undefined, keeps the list intact and shows a toast on failure', async () => {
    const store = useProjectStore()
    const toasts = useToastStore()
    db.save.mockRejectedValue(new Error('boom'))

    const project = await store.create('New project')

    expect(project).toBeUndefined()
    expect(store.projects).toHaveLength(0)
    expect(toasts.toasts[0]?.kind).toBe('error')
  })

  it('mentions storage in the toast on QuotaExceededError', async () => {
    const store = useProjectStore()
    const toasts = useToastStore()
    const quotaError = new Error('quota')
    quotaError.name = 'QuotaExceededError'
    db.save.mockRejectedValue(quotaError)

    await store.create('New project')

    expect(toasts.toasts[0]?.message).toContain('storage is full')
  })
})

describe('rename', () => {
  it('rolls the optimistic update back when the save fails', async () => {
    const store = useProjectStore()
    db.getAll.mockResolvedValue([makeProject({ name: 'Before', updatedAt: 1000 })])
    await store.load()

    db.save.mockRejectedValue(new Error('boom'))
    await store.rename('p1', 'After')

    expect(store.projects[0]?.name).toBe('Before')
    expect(store.projects[0]?.updatedAt).toBe(1000)
  })

  it('keeps the new name when the save succeeds', async () => {
    const store = useProjectStore()
    db.getAll.mockResolvedValue([makeProject({ name: 'Before' })])
    await store.load()

    db.save.mockResolvedValue('p1')
    await store.rename('p1', 'After')

    expect(store.projects[0]?.name).toBe('After')
  })
})

describe('duplicate', () => {
  it('asks the db for a copy with the given name and shows an info toast', async () => {
    const store = useProjectStore()
    const toasts = useToastStore()
    db.getAll.mockResolvedValue([makeProject({ name: 'My flat' })])
    await store.load()

    const copy = makeProject({ id: 'p2', name: 'My flat v2' })
    db.duplicate.mockResolvedValue(copy)

    const result = await store.duplicate('p1', 'My flat v2')

    expect(db.duplicate).toHaveBeenCalledWith('p1', 'My flat v2')
    expect(result).toEqual(copy)
    expect(store.projects[0]).toEqual(copy)
    expect(toasts.toasts[0]?.kind).toBe('info')
  })

  it('returns undefined without touching the db for an unknown id', async () => {
    const store = useProjectStore()

    const result = await store.duplicate('missing', 'Name')

    expect(result).toBeUndefined()
    expect(db.duplicate).not.toHaveBeenCalled()
  })

  it('keeps the list intact and shows an error toast on failure', async () => {
    const store = useProjectStore()
    const toasts = useToastStore()
    db.getAll.mockResolvedValue([makeProject()])
    await store.load()

    db.duplicate.mockRejectedValue(new Error('boom'))
    const result = await store.duplicate('p1', 'Copy name')

    expect(result).toBeUndefined()
    expect(store.projects).toHaveLength(1)
    expect(toasts.toasts[0]?.kind).toBe('error')
  })
})

describe('remove', () => {
  it('keeps the project in the list when the delete fails', async () => {
    const store = useProjectStore()
    db.getAll.mockResolvedValue([makeProject()])
    await store.load()

    db.remove.mockRejectedValue(new Error('boom'))
    await store.remove('p1')

    expect(store.projects).toHaveLength(1)
  })
})
