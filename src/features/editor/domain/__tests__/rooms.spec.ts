import { describe, expect, it } from 'vitest'
import {
  addDivider,
  addNode,
  addWall,
  addWallBetween,
  createEmptyDocument,
  removeWall,
} from '../operations'
import { detectRooms, insideAnyRoom, roomAt, roomExclusiveWalls, roomKey, wallFaceSides } from '../rooms'
import { computeWallGeometry } from '../wallJoints'
import type { NodeId, SceneDocument, Vec2 } from '../types'

/** Adds nodes at the given points and walls closing them into a ring. */
function ring(doc: SceneDocument, points: Vec2[]): NodeId[] {
  const ids = points.map((p) => addNode(doc, p))
  for (let i = 0; i < ids.length; i++) {
    addWall(doc, ids[i]!, ids[(i + 1) % ids.length]!)
  }
  return ids
}

/** Adds nodes at the given points and walls along the open polyline. */
function chain(doc: SceneDocument, points: Vec2[]): NodeId[] {
  const ids = points.map((p) => addNode(doc, p))
  for (let i = 0; i < ids.length - 1; i++) {
    addWall(doc, ids[i]!, ids[i + 1]!)
  }
  return ids
}

const square = (x: number, y: number, size: number): Vec2[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
]

describe('detectRooms', () => {
  it('finds nothing in an empty document', () => {
    expect(detectRooms(createEmptyDocument())).toEqual([])
  })

  it('finds nothing in an open polyline', () => {
    const doc = createEmptyDocument()
    chain(doc, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ])
    expect(detectRooms(doc)).toEqual([])
  })

  it('detects a square as one room with its area', () => {
    const doc = createEmptyDocument()
    const ids = ring(doc, square(0, 0, 100))

    const rooms = detectRooms(doc)

    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.area).toBe(100 * 100)
    expect([...rooms[0]!.nodeIds].sort()).toEqual([...ids].sort())
  })

  it('detects a non-convex (L-shaped) room with the correct area', () => {
    const doc = createEmptyDocument()
    ring(doc, [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ])

    const rooms = detectRooms(doc)

    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.area).toBe(200 * 100 + 100 * 100)
  })

  it('detects two rooms sharing a wall, each owning the shared nodes', () => {
    const doc = createEmptyDocument()
    const left = ring(doc, square(0, 0, 100))
    const sharedTop = left[1]! // (100, 0)
    const sharedBottom = left[2]! // (100, 100)
    const rightTop = addNode(doc, { x: 200, y: 0 })
    const rightBottom = addNode(doc, { x: 200, y: 100 })
    addWall(doc, sharedTop, rightTop)
    addWall(doc, rightTop, rightBottom)
    addWall(doc, rightBottom, sharedBottom)

    const rooms = detectRooms(doc)

    expect(rooms).toHaveLength(2)
    expect(rooms.map((room) => room.area)).toEqual([100 * 100, 100 * 100])
    for (const room of rooms) {
      expect(room.nodeIds).toContain(sharedTop)
      expect(room.nodeIds).toContain(sharedBottom)
    }
  })

  it('ignores a dead-end spur and keeps the room contour simple', () => {
    const doc = createEmptyDocument()
    const ids = ring(doc, square(0, 0, 100))
    const spur = addNode(doc, { x: 50, y: 50 })
    addWall(doc, ids[0]!, spur)

    const rooms = detectRooms(doc)

    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.area).toBe(100 * 100)
    expect(rooms[0]!.nodeIds).not.toContain(spur)
  })

  it('detects two rooms joined by a corridor wall (bridge edge)', () => {
    const doc = createEmptyDocument()
    const left = ring(doc, square(0, 0, 100))
    const right = ring(doc, square(300, 0, 100))
    addWall(doc, left[2]!, right[3]!) // (100,100) — (300,100)

    const rooms = detectRooms(doc)

    expect(rooms).toHaveLength(2)
    expect(rooms.map((room) => room.area)).toEqual([100 * 100, 100 * 100])
  })

  it('rejects a zero-area collinear loop', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 200, y: 0 })
    addWall(doc, a, b)
    addWall(doc, b, c)
    addWall(doc, c, a)

    expect(detectRooms(doc)).toEqual([])
  })

  it('drops the room when a wall of the loop is removed', () => {
    const doc = createEmptyDocument()
    ring(doc, square(0, 0, 100))
    expect(detectRooms(doc)).toHaveLength(1)

    removeWall(doc, doc.walls[0]!.id)

    expect(detectRooms(doc)).toEqual([])
  })

  it('carves a nested loop out of the outer room as a hole', () => {
    const doc = createEmptyDocument()
    ring(doc, square(0, 0, 300))
    ring(doc, square(100, 100, 100))

    const rooms = detectRooms(doc)

    expect(rooms.map((room) => room.area)).toEqual([300 * 300 - 100 * 100, 100 * 100])
    expect(rooms[0]!.holes).toHaveLength(1)
    expect(rooms[1]!.holes).toEqual([])
  })

  it('assigns a doubly nested loop to its immediate parent room', () => {
    const doc = createEmptyDocument()
    ring(doc, square(0, 0, 300))
    ring(doc, square(100, 100, 100))
    ring(doc, square(130, 130, 40))

    const rooms = detectRooms(doc)

    expect(rooms.map((room) => room.area)).toEqual([
      300 * 300 - 100 * 100,
      100 * 100 - 40 * 40,
      40 * 40,
    ])
  })

  it('carves a multi-room nested block out once, by its outer contour', () => {
    const doc = createEmptyDocument()
    ring(doc, square(0, 0, 400))
    // 200x100 block at (100,100) split into two 100x100 rooms by a divider
    const a = addNode(doc, { x: 100, y: 100 })
    const b = addNode(doc, { x: 200, y: 100 })
    const c = addNode(doc, { x: 300, y: 100 })
    const d = addNode(doc, { x: 300, y: 200 })
    const e = addNode(doc, { x: 200, y: 200 })
    const f = addNode(doc, { x: 100, y: 200 })
    for (const [p, q] of [[a, b], [b, c], [c, d], [d, e], [e, f], [f, a], [b, e]] as const) {
      addWall(doc, p, q)
    }

    const rooms = detectRooms(doc)

    expect(rooms.map((room) => room.area)).toEqual([
      400 * 400 - 200 * 100,
      100 * 100,
      100 * 100,
    ])
  })

  it('finds the room containing a point and nothing outside', () => {
    const doc = createEmptyDocument()
    const ids = ring(doc, square(0, 0, 100))

    const hit = roomAt(doc, { x: 50, y: 50 })
    expect(hit).toBeDefined()
    expect([...hit!.nodeIds].sort()).toEqual([...ids].sort())
    expect(roomAt(doc, { x: 250, y: 50 })).toBeUndefined()
  })

  it('resolves a point in a nested loop to the innermost room', () => {
    const doc = createEmptyDocument()
    ring(doc, square(0, 0, 300))
    ring(doc, square(100, 100, 100))

    expect(roomAt(doc, { x: 150, y: 150 })!.area).toBe(100 * 100)
    expect(roomAt(doc, { x: 50, y: 50 })!.area).toBe(300 * 300 - 100 * 100)
  })

  it('keeps roomKey stable across re-detection and node moves', () => {
    const doc = createEmptyDocument()
    const ids = ring(doc, square(0, 0, 100))

    const before = roomKey(detectRooms(doc)[0]!)
    doc.nodes[ids[0]!]!.pos = { x: -50, y: -50 } // move a corner: same topology
    const after = roomKey(detectRooms(doc)[0]!)

    expect(after).toBe(before)
  })

  it('lists every wall of a lone room as exclusive', () => {
    const doc = createEmptyDocument()
    const ids = ring(doc, square(0, 0, 100))
    const key = [...ids].sort().join('|')

    expect(roomExclusiveWalls(doc, key)).toHaveLength(4)
    expect(roomExclusiveWalls(doc, 'not-a-room')).toEqual([])
  })

  it('excludes the wall shared between two rooms', () => {
    const doc = createEmptyDocument()
    const left = ring(doc, square(0, 0, 100))
    const rightTop = addNode(doc, { x: 200, y: 0 })
    const rightBottom = addNode(doc, { x: 200, y: 100 })
    addWall(doc, left[1]!, rightTop)
    addWall(doc, rightTop, rightBottom)
    addWall(doc, rightBottom, left[2]!)
    const key = [...left].sort().join('|')

    const walls = roomExclusiveWalls(doc, key)

    expect(walls).toHaveLength(3)
    const sharedPair = new Set([left[1], left[2]])
    expect(walls.some((w) => sharedPair.has(w.a) && sharedPair.has(w.b))).toBe(false)
  })

  it('finds nothing exclusive for a room fully enclosed by neighbours', () => {
    const doc = createEmptyDocument()
    const seg = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      addWallBetween(doc, p, q, { snapDist: 1 })
    // centre cell of a plus shape: all four walls shared with the arm cells
    const centre = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
    ]
    for (let i = 0; i < 4; i++) seg(centre[i]!, centre[(i + 1) % 4]!)
    // each arm adds only its three outer walls, reusing the shared corners
    const arms = [
      [{ x: 100, y: 100 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }],
      [{ x: 200, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 200, y: 200 }],
      [{ x: 200, y: 200 }, { x: 200, y: 300 }, { x: 100, y: 300 }, { x: 100, y: 200 }],
      [{ x: 100, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 100 }, { x: 100, y: 100 }],
    ]
    for (const arm of arms) {
      for (let i = 0; i < arm.length - 1; i++) seg(arm[i]!, arm[i + 1]!)
    }

    const centreRoom = roomAt(doc, { x: 150, y: 150 })!
    expect(centreRoom.area).toBe(100 * 100)
    expect(roomExclusiveWalls(doc, roomKey(centreRoom))).toEqual([])
  })

  it('returns polygon points detached from the document nodes', () => {
    const doc = createEmptyDocument()
    const ids = ring(doc, square(0, 0, 100))

    const [room] = detectRooms(doc)
    const nodePositions = ids.map((id) => doc.nodes[id]!.pos)

    for (const point of room!.polygon) {
      expect(nodePositions).not.toContain(point)
    }
  })
})

describe('insideAnyRoom', () => {
  it('tells room floor from outside', () => {
    const doc = createEmptyDocument()
    ring(doc, square(0, 0, 200))
    const rooms = detectRooms(doc)

    expect(insideAnyRoom(rooms, { x: 100, y: 100 })).toBe(true)
    expect(insideAnyRoom(rooms, { x: 300, y: 100 })).toBe(false)
  })
})

describe('wallFaceSides', () => {
  const facesOf = (doc: SceneDocument, index: number) =>
    computeWallGeometry(doc).faces.get(doc.walls[index]!.id)!

  it('reports room-side face shorter and outer face longer on a square room', () => {
    const doc = createEmptyDocument()
    ring(doc, square(0, 0, 200)) // default thickness 10 → miter eats 5 per corner

    const sides = wallFaceSides(detectRooms(doc), facesOf(doc, 0))
    const [inner, outer] = sides.left.bordersRoom
      ? [sides.left, sides.right]
      : [sides.right, sides.left]

    expect(inner.bordersRoom).toBe(true)
    expect(outer.bordersRoom).toBe(false)
    expect(inner.length).toBeCloseTo(190, 6)
    expect(outer.length).toBeCloseTo(210, 6)
  })

  it('reports both faces at axis length and no rooms on a standalone wall', () => {
    const doc = createEmptyDocument()
    chain(doc, [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ])

    const sides = wallFaceSides(detectRooms(doc), facesOf(doc, 0))

    expect(sides.left).toEqual({ length: 200, bordersRoom: false })
    expect(sides.right).toEqual({ length: 200, bordersRoom: false })
  })

  it('reports rooms on both sides of a shared partition wall', () => {
    const doc = createEmptyDocument()
    ring(doc, square(0, 0, 200))
    // second room shares the x=200 wall; only its three outer edges are added
    const extension = [
      { x: 200, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 200 },
      { x: 200, y: 200 },
    ]
    for (let i = 0; i < extension.length - 1; i++) {
      addWallBetween(doc, extension[i]!, extension[i + 1]!, { snapDist: 1 })
    }

    const shared = wallFaceSides(detectRooms(doc), facesOf(doc, 1)) // the x=200 wall
    expect(shared.left.bordersRoom).toBe(true)
    expect(shared.right.bordersRoom).toBe(true)
    // a T-junction at each end trims both faces by the crossing wall's half thickness
    expect(shared.left.length).toBeCloseTo(190, 6)
    expect(shared.right.length).toBeCloseTo(190, 6)
  })
})

describe('detectRooms with zoning dividers', () => {
  /** A 100×100 square whose top and bottom edges carry a midpoint node at x=50. */
  function squareWithMidpoints(doc: SceneDocument): { topMid: NodeId; bottomMid: NodeId } {
    const c00 = addNode(doc, { x: 0, y: 0 })
    const topMid = addNode(doc, { x: 50, y: 0 })
    const c10 = addNode(doc, { x: 100, y: 0 })
    const c11 = addNode(doc, { x: 100, y: 100 })
    const bottomMid = addNode(doc, { x: 50, y: 100 })
    const c01 = addNode(doc, { x: 0, y: 100 })
    for (const [a, b] of [
      [c00, topMid],
      [topMid, c10],
      [c10, c11],
      [c11, bottomMid],
      [bottomMid, c01],
      [c01, c00],
    ] as const) {
      addWall(doc, a, b)
    }
    return { topMid, bottomMid }
  }

  it('splits a room into two zones of the right area with a chord divider', () => {
    const doc = createEmptyDocument()
    const { topMid, bottomMid } = squareWithMidpoints(doc)
    expect(detectRooms(doc)).toHaveLength(1) // one open room before zoning

    addDivider(doc, topMid, bottomMid)

    const zones = detectRooms(doc)
    expect(zones).toHaveLength(2)
    expect(zones.map((z) => z.area)).toEqual([50 * 100, 50 * 100])
  })

  it('does not form a zone from a divider that dead-ends inside the room', () => {
    const doc = createEmptyDocument()
    const { topMid } = squareWithMidpoints(doc)
    const loose = addNode(doc, { x: 50, y: 50 }) // free end, not on the contour
    addDivider(doc, topMid, loose)

    // the spur is pruned like a dead-end wall: still one undivided room
    const rooms = detectRooms(doc)
    expect(rooms).toHaveLength(1)
    expect(rooms[0]!.area).toBe(100 * 100)
  })
})
