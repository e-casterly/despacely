import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { createEmptyDocument } from '../../domain/operations'
import { documentDb } from '../documentDb'

beforeEach(async () => {
  await db.documents.clear()
})

describe('documentDb', () => {
  it('round-trips a document', async () => {
    const doc = createEmptyDocument()
    doc.walls.push({ id: 'w1', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 10, height: 270 })

    await documentDb.save('p1', doc)
    const loaded = await documentDb.get('p1')

    expect(loaded).toEqual(doc)
  })

  it('returns undefined for a missing document', async () => {
    expect(await documentDb.get('nope')).toBeUndefined()
  })

  it('overwrites on repeated save (one document per project)', async () => {
    await documentDb.save('p1', createEmptyDocument())
    const updated = createEmptyDocument()
    updated.items.push({
      id: 'i1',
      kind: 'box',
      pos: { x: 0, y: 0 },
      size: { x: 60, y: 60 },
      height: 75,
      rotation: 0,
      color: '#94a3b8',
    })
    await documentDb.save('p1', updated)

    expect(await db.documents.count()).toBe(1)
    expect((await documentDb.get('p1'))?.items).toHaveLength(1)
  })

  it('removes a document', async () => {
    await documentDb.save('p1', createEmptyDocument())
    await documentDb.remove('p1')
    expect(await documentDb.get('p1')).toBeUndefined()
  })

  it('rejects a corrupted document on read', async () => {
    await db.documents.put({
      projectId: 'p1',
      doc: { version: 99 } as never,
      updatedAt: Date.now(),
    })
    await expect(documentDb.get('p1')).rejects.toThrow(/version/)
  })
})
