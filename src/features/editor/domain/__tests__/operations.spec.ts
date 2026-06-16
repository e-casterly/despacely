import { describe, expect, it } from 'vitest'
import {
  addItem,
  addNode,
  addWall,
  addWallBetween,
  createEmptyDocument,
  findItem,
  moveItem,
  moveNode,
  nodeAt,
  removeItem,
  removeWall,
  wallSegment,
  wallsAtNode,
} from '../operations'
import type { Item } from '../types'

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

describe('document', () => {
  it('creates an empty document', () => {
    expect(createEmptyDocument()).toEqual({ nodes: {}, walls: [], items: [] })
  })
})

describe('walls and nodes', () => {
  it('adds a wall between two new nodes and resolves its segment', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })

    const wall = addWall(doc, a, b)

    expect(doc.walls).toHaveLength(1)
    expect(Object.keys(doc.nodes)).toHaveLength(2)
    expect(wallSegment(doc, wall)).toEqual({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } })
  })

  it('shares a node between connected walls so moving it moves both', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const corner = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 100, y: 100 })
    const w1 = addWall(doc, a, corner)
    const w2 = addWall(doc, corner, c)

    moveNode(doc, corner, { x: 120, y: -20 })

    expect(wallSegment(doc, w1).b).toEqual({ x: 120, y: -20 })
    expect(wallSegment(doc, w2).a).toEqual({ x: 120, y: -20 })
  })
})

describe('addWallBetween', () => {
  it('creates fresh nodes when nothing is nearby', () => {
    const doc = createEmptyDocument()
    addWallBetween(doc, { x: 0, y: 0 }, { x: 100, y: 0 }, { snapDist: 5 })
    expect(Object.keys(doc.nodes)).toHaveLength(2)
  })

  it('reuses a nearby node within snapDist (corners connect)', () => {
    const doc = createEmptyDocument()
    addWallBetween(doc, { x: 0, y: 0 }, { x: 100, y: 0 }, { snapDist: 5 })
    // second wall starts ~3cm from the previous endpoint
    addWallBetween(doc, { x: 102, y: 2 }, { x: 100, y: 100 }, { snapDist: 5 })

    expect(doc.walls).toHaveLength(2)
    expect(Object.keys(doc.nodes)).toHaveLength(3) // not 4 — the corner is shared
  })

  it('refuses a zero-length wall', () => {
    const doc = createEmptyDocument()
    const wall = addWallBetween(doc, { x: 0, y: 0 }, { x: 2, y: 0 }, { snapDist: 5 })
    expect(wall).toBeUndefined()
    expect(doc.walls).toHaveLength(0)
  })
})

describe('removeWall (orphan GC)', () => {
  it('garbage-collects endpoints left with no other walls', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const corner = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 100, y: 100 })
    addWall(doc, a, corner)
    const w2 = addWall(doc, corner, c)

    removeWall(doc, w2.id)

    // 'c' had only w2 -> collected; 'corner' still holds w1 -> kept
    expect(doc.nodes[c]).toBeUndefined()
    expect(doc.nodes[corner]).toBeDefined()
    expect(doc.nodes[a]).toBeDefined()
    expect(Object.keys(doc.nodes)).toHaveLength(2)
  })

  it('removes both endpoints of the last wall', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const wall = addWall(doc, a, b)

    removeWall(doc, wall.id)

    expect(doc.nodes).toEqual({})
  })
})

describe('queries', () => {
  it('nodeAt finds the nearest node within range', () => {
    const doc = createEmptyDocument()
    addNode(doc, { x: 0, y: 0 })
    const near = addNode(doc, { x: 100, y: 0 })

    expect(nodeAt(doc, { x: 103, y: 0 }, 5)?.id).toBe(near)
    expect(nodeAt(doc, { x: 130, y: 0 }, 5)).toBeUndefined()
  })

  it('wallsAtNode returns incident walls', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const corner = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 100, y: 100 })
    addWall(doc, a, corner)
    addWall(doc, corner, c)

    expect(wallsAtNode(doc, corner)).toHaveLength(2)
    expect(wallsAtNode(doc, a)).toHaveLength(1)
  })
})

describe('items', () => {
  it('adds, finds, moves and removes items independently of the graph', () => {
    const doc = createEmptyDocument()
    addItem(doc, makeItem())

    expect(findItem(doc, 'i1')).toBeDefined()
    moveItem(doc, 'i1', { x: 200, y: 300 })
    expect(findItem(doc, 'i1')?.pos).toEqual({ x: 200, y: 300 })

    removeItem(doc, 'i1')
    expect(doc.items).toHaveLength(0)
  })
})
