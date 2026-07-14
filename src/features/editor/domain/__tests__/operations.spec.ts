import { describe, expect, it } from 'vitest'
import {
  addItem,
  addNode,
  addWall,
  addWallBetween,
  collapsesAWall,
  createEmptyDocument,
  docBounds,
  findItem,
  mergeNodes,
  findOpening,
  findWall,
  moveItem,
  moveNode,
  nodeAt,
  nodesConnected,
  removeItem,
  removeWall,
  splitWallAt,
  wallAtPoint,
  wallSegment,
  wallsAtNode,
  wallUnderPoint,
} from '../operations'
import type { Item, Opening } from '../types'

function makeOpening(id: string, overrides: Partial<Opening> = {}): Opening {
  return { id, kind: 'door', offset: 50, width: 20, height: 210, sill: 0, ...overrides }
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

describe('collapsesAWall', () => {
  it('detects a node landing on its wall neighbour', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    addWall(doc, a, b)

    expect(collapsesAWall(doc, { [a]: { x: 100, y: 0 } })).toBe(true)
    expect(collapsesAWall(doc, { [a]: { x: 50, y: 50 } })).toBe(false)
  })

  it('checks moved positions against each other, not only the doc', () => {
    // both endpoints moved onto the same point
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    addWall(doc, a, b)

    expect(collapsesAWall(doc, { [a]: { x: 5, y: 5 }, [b]: { x: 5, y: 5 } })).toBe(true)
  })

  it('ignores unrelated nodes at equal positions', () => {
    // two disconnected walls may share coordinates freely
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 0, y: 100 })
    const d = addNode(doc, { x: 100, y: 100 })
    addWall(doc, a, b)
    addWall(doc, c, d)

    expect(collapsesAWall(doc, { [c]: { x: 0, y: 0 } })).toBe(false) // lands on a, no shared wall
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

  it('nodeAt skips the excluded node', () => {
    const doc = createEmptyDocument()
    const self = addNode(doc, { x: 0, y: 0 })
    const other = addNode(doc, { x: 3, y: 0 })

    expect(nodeAt(doc, { x: 0, y: 0 }, 5, self)?.id).toBe(other)
  })

  it('nodesConnected sees a direct wall in either orientation', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 200, y: 0 })
    addWall(doc, a, b)

    expect(nodesConnected(doc, a, b)).toBe(true)
    expect(nodesConnected(doc, b, a)).toBe(true)
    expect(nodesConnected(doc, a, c)).toBe(false)
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

describe('mergeNodes', () => {
  it('rewires walls at the source to the target and deletes the source', () => {
    // two separate walls; the endpoint of one welds onto an endpoint of the other
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 100, y: 100 })
    const d = addNode(doc, { x: 200, y: 100 })
    const wall = addWall(doc, a, b)
    addWall(doc, c, d)

    const report = mergeNodes(doc, b, c)

    expect(doc.nodes[b]).toBeUndefined()
    expect(wall.b).toBe(c)
    expect(doc.walls).toHaveLength(2)
    expect(wallsAtNode(doc, c)).toHaveLength(2)
    expect(report).toEqual({ rewired: [{ wallId: wall.id, end: 'b' }], removedWalls: [] })
  })

  it('drops a wall that the merge turns into a duplicate', () => {
    // chain a-b-c folded shut: a-b rewired to c-b duplicates b-c
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 200, y: 0 })
    const folded = addWall(doc, a, b)
    const kept = addWall(doc, b, c)

    const report = mergeNodes(doc, a, c)

    expect(doc.walls).toEqual([kept])
    expect(report.removedWalls).toEqual([folded])
    expect(doc.nodes[a]).toBeUndefined()
  })
})

describe('docBounds', () => {
  it('returns null for an empty scene', () => {
    expect(docBounds(createEmptyDocument())).toBeNull()
  })

  it('grows wall ends by half the thickness', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    addWall(doc, a, b, { thickness: 10 })

    expect(docBounds(doc)).toEqual({ min: { x: -5, y: -5 }, max: { x: 105, y: 5 } })
  })

  it('accounts for item rotation', () => {
    const doc = createEmptyDocument()
    addItem(doc, { ...makeItem(), size: { x: 60, y: 20 }, rotation: Math.PI / 2 })

    // a 60x20 box at (50, 50) turned 90° spans 20x60
    const bounds = docBounds(doc)!
    expect(bounds.min.x).toBeCloseTo(40)
    expect(bounds.min.y).toBeCloseTo(20)
    expect(bounds.max.x).toBeCloseTo(60)
    expect(bounds.max.y).toBeCloseTo(80)
  })

  it('unions walls and items', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    addWall(doc, a, b, { thickness: 10 })
    addItem(doc, { ...makeItem(), pos: { x: 200, y: 200 }, size: { x: 40, y: 40 } })

    expect(docBounds(doc)).toEqual({ min: { x: -5, y: -5 }, max: { x: 220, y: 220 } })
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

describe('wallAtPoint', () => {
  it('finds the wall a mid-body point lies on', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    const wall = addWall(doc, a, b)

    expect(wallAtPoint(doc, { x: 100, y: 0 }, 0.5)?.id).toBe(wall.id)
  })

  it('ignores hits at the wall ends and points off the body', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    addWall(doc, a, b)

    expect(wallAtPoint(doc, { x: 0, y: 0 }, 0.5)).toBeUndefined() // an endpoint, not a body point
    expect(wallAtPoint(doc, { x: 100, y: 50 }, 0.5)).toBeUndefined() // off the body
  })

  it('skips a wall whose endpoint is excluded', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    addWall(doc, a, b)

    expect(wallAtPoint(doc, { x: 100, y: 0 }, 0.5, new Set([a]))).toBeUndefined()
  })
})

describe('splitWallAt', () => {
  it('replaces a wall with two halves joined by a new node, inheriting props', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    const wall = addWall(doc, a, b, { thickness: 20, height: 300 })

    const split = splitWallAt(doc, wall.id, { x: 100, y: 0 })!

    expect(doc.walls).toHaveLength(2)
    expect(findWall(doc, wall.id)).toBeUndefined() // original gone
    const [w1, w2] = split.added
    expect([w1.a, w1.b]).toEqual([a, split.nodeId])
    expect([w2.a, w2.b]).toEqual([split.nodeId, b])
    expect(doc.nodes[split.nodeId]!.pos).toEqual({ x: 100, y: 0 })
    expect(w1.thickness).toBe(20)
    expect(w2.height).toBe(300)
    expect(doc.nodes[a]).toBeDefined() // endpoints kept, not GC'd
    expect(doc.nodes[b]).toBeDefined()
  })

  it('returns undefined for a wall that no longer exists', () => {
    const doc = createEmptyDocument()
    expect(splitWallAt(doc, 'gone', { x: 0, y: 0 })).toBeUndefined()
  })
})

describe('splitWallAt (openings)', () => {
  /** A 200cm wall carrying: one opening left of centre, one right, one across it. */
  function docWithOpenings() {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    const wall = addWall(doc, a, b)
    wall.openings = [
      makeOpening('left', { offset: 40, width: 20 }), // [30, 50]
      makeOpening('right', { offset: 160, width: 20 }), // [150, 170]
      makeOpening('across', { offset: 100, width: 40 }), // [80, 120] — spans the split
    ]
    return { doc, wall }
  }

  it('hands each opening to the half it lands on, rebasing the B half', () => {
    const { doc, wall } = docWithOpenings()

    const [first, second] = splitWallAt(doc, wall.id, { x: 100, y: 0 })!.added

    // the A half starts where the original did, so its offsets are unchanged
    expect(first.openings).toEqual([makeOpening('left', { offset: 40, width: 20 })])
    // the B half starts at the split point, 100cm along, so 160 becomes 60
    expect(second.openings).toEqual([makeOpening('right', { offset: 60, width: 20 })])
  })

  it('drops an opening the split runs straight through', () => {
    const { doc, wall } = docWithOpenings()

    const { added } = splitWallAt(doc, wall.id, { x: 100, y: 0 })!

    const survivors = added.flatMap((half) => half.openings.map((o) => o.id))
    expect(survivors).not.toContain('across')
  })

  it('leaves the removed wall’s own openings intact, so undo can restore them', () => {
    const { doc, wall } = docWithOpenings()

    const { removed } = splitWallAt(doc, wall.id, { x: 100, y: 0 })!

    // `removed` is the object AddWallCommand pushes back on undo: it must still
    // carry all three openings, including the one the halves dropped
    expect(removed.openings.map((o) => o.id)).toEqual(['left', 'right', 'across'])
    expect(removed.openings[1]!.offset).toBe(160) // not rebased in place
  })

  it('gives the halves copies, so editing one cannot reach the original', () => {
    const { doc, wall } = docWithOpenings()

    const [first] = splitWallAt(doc, wall.id, { x: 100, y: 0 })!.added
    first.openings[0]!.offset = 999

    expect(wall.openings[0]!.offset).toBe(40)
  })

  it('keeps opening ids across the split, so a selected door survives it', () => {
    const { doc, wall } = docWithOpenings()

    const [first] = splitWallAt(doc, wall.id, { x: 100, y: 0 })!.added

    expect(first.openings[0]!.id).toBe('left')
    expect(findOpening(doc, 'left')?.wall.id).toBe(first.id)
  })
})

describe('findOpening', () => {
  it('finds an opening with its wall and index', () => {
    const doc = createEmptyDocument()
    const wall = addWall(doc, addNode(doc, { x: 0, y: 0 }), addNode(doc, { x: 200, y: 0 }))
    wall.openings = [makeOpening('o1'), makeOpening('o2')]

    const found = findOpening(doc, 'o2')!

    expect(found.wall.id).toBe(wall.id)
    expect(found.index).toBe(1)
    expect(found.opening.id).toBe('o2')
  })

  it('returns undefined for an unknown id', () => {
    expect(findOpening(createEmptyDocument(), 'nope')).toBeUndefined()
  })
})

describe('wallUnderPoint', () => {
  it('picks the wall whose body the point sits deepest inside', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const thick = addWall(doc, a, b, { thickness: 40 })
    const c = addNode(doc, { x: 0, y: 15 })
    const d = addNode(doc, { x: 100, y: 15 })
    addWall(doc, c, d, { thickness: 2 })

    // 12cm below the thick wall's axis: inside its body, but nearer the thin
    // wall's axis — depth into the body must win over raw axis distance
    expect(wallUnderPoint(doc, { x: 50, y: 12 }, 0)?.id).toBe(thick.id)
  })

  it('returns undefined when the point is outside every wall body', () => {
    const doc = createEmptyDocument()
    addWall(doc, addNode(doc, { x: 0, y: 0 }), addNode(doc, { x: 100, y: 0 }))

    expect(wallUnderPoint(doc, { x: 50, y: 500 }, 5)).toBeUndefined()
  })
})
