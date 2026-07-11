import { describe, expect, it } from 'vitest'
import { addNode, addWall, createEmptyDocument, removeWall } from '../operations'
import { detectRooms } from '../rooms'
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

  it('reports a detached loop inside a room as its own room, largest first', () => {
    const doc = createEmptyDocument()
    ring(doc, square(0, 0, 300))
    ring(doc, square(100, 100, 100))

    const rooms = detectRooms(doc)

    // hole subtraction is deferred: the outer room's area includes the inner loop
    expect(rooms.map((room) => room.area)).toEqual([300 * 300, 100 * 100])
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
