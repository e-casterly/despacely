import { describe, expect, it } from 'vitest'
import {
  addItem,
  addWall,
  createEmptyDocument,
  findItem,
  findWall,
  moveItem,
  removeItem,
  removeWall,
} from '../operations'
import type { Item, Wall } from '../types'

function makeWall(id = 'w1'): Wall {
  return { id, a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 10, height: 270 }
}

function makeItem(id = 'i1'): Item {
  return {
    id,
    kind: 'box',
    pos: { x: 50, y: 50 },
    size: { x: 60, y: 60 },
    height: 75,
    rotation: 0,
    color: '#94a3b8',
  }
}

describe('operations', () => {
  it('creates an empty v1 document', () => {
    expect(createEmptyDocument()).toEqual({ version: 1, walls: [], items: [] })
  })

  it('adds, finds and removes walls', () => {
    const doc = createEmptyDocument()
    addWall(doc, makeWall())

    expect(findWall(doc, 'w1')).toBeDefined()
    removeWall(doc, 'w1')
    expect(doc.walls).toHaveLength(0)
  })

  it('adds, finds and removes items', () => {
    const doc = createEmptyDocument()
    addItem(doc, makeItem())

    expect(findItem(doc, 'i1')).toBeDefined()
    removeItem(doc, 'i1')
    expect(doc.items).toHaveLength(0)
  })

  it('moves an item and ignores unknown ids', () => {
    const doc = createEmptyDocument()
    addItem(doc, makeItem())

    moveItem(doc, 'i1', { x: 200, y: 300 })
    expect(findItem(doc, 'i1')?.pos).toEqual({ x: 200, y: 300 })

    expect(() => moveItem(doc, 'missing', { x: 0, y: 0 })).not.toThrow()
  })
})
