import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { createEmptyDocument } from '@/features/editor/domain/operations'
import { projectDb } from '../projectDb'
import type { Project } from '../types'

function makeProject(id = 'p1'): Project {
  return { id, name: 'My flat', createdAt: 1000, updatedAt: 1000 }
}

beforeEach(async () => {
  await db.projects.clear()
  await db.documents.clear()
})

describe('projectDb.duplicate', () => {
  it('copies the project together with its scene document', async () => {
    await db.projects.put(makeProject())
    const doc = createEmptyDocument()
    doc.nodes.n1 = { id: 'n1', pos: { x: 0, y: 0 } }
    doc.nodes.n2 = { id: 'n2', pos: { x: 100, y: 0 } }
    doc.walls.push({ id: 'w1', a: 'n1', b: 'n2', thickness: 10, height: 270 })
    await db.documents.put({ projectId: 'p1', doc, updatedAt: 1000 })

    const copy = await projectDb.duplicate('p1', 'My flat (copy)')

    expect(copy).toBeDefined()
    expect(copy?.name).toBe('My flat (copy)')
    const copiedDoc = await db.documents.get(copy!.id)
    expect(copiedDoc?.doc.walls).toHaveLength(1)
    expect(await db.documents.count()).toBe(2)
  })

  it('duplicates a project that has no document yet', async () => {
    await db.projects.put(makeProject())

    const copy = await projectDb.duplicate('p1', 'My flat (copy)')

    expect(copy).toBeDefined()
    expect(await db.documents.count()).toBe(0)
  })

  it('returns undefined for a missing source', async () => {
    expect(await projectDb.duplicate('nope', 'Name')).toBeUndefined()
  })
})

describe('projectDb.remove', () => {
  it('deletes the project and its document together', async () => {
    await db.projects.put(makeProject())
    await db.documents.put({ projectId: 'p1', doc: createEmptyDocument(), updatedAt: 1000 })

    await projectDb.remove('p1')

    expect(await db.projects.count()).toBe(0)
    expect(await db.documents.count()).toBe(0)
  })
})
