import { pointInPolygon } from './geometry'
import type { NodeId, SceneDocument, Vec2, Wall } from './types'

/**
 * A closed contour in the wall graph. Rooms are derived from the graph on
 * demand and never stored in the document — the wall graph stays the single
 * source of truth, so commands and persistence never have to keep rooms in
 * sync.
 */
export interface Room {
  /** contour vertices in traversal order; the first one is not repeated at the end */
  nodeIds: NodeId[]
  /** the same contour as points — fresh copies, safe to hand outside the hot doc */
  polygon: Vec2[]
  /** outer contours of detached loops nested inside: not part of this room's floor */
  holes: Vec2[][]
  /** floor area along wall centerlines with holes carved out, cm² */
  area: number
}

/** Closed contours below this area are numeric degenerates (collinear loops), not rooms. */
const MIN_ROOM_AREA = 1 // cm²

/**
 * Enumerates the rooms — interior faces of the planar wall graph — largest
 * first. Walls bound a room only when they share nodes; geometric crossings
 * without a common node do not count.
 *
 * Standard half-edge face traversal: every wall yields two directed edges,
 * and a face is walked by turning onto the angular predecessor of the
 * reversed incoming edge at every vertex. With the Y axis pointing down this walks
 * interior faces with positive shoelace area while the unbounded outer face
 * of each connected component comes out negative, which is how outer faces
 * are discarded.
 */
export function detectRooms(doc: SceneDocument): Room[] {
  const neighbors = cycleNeighbors(doc)

  // ascending-atan2 neighbor order around each vertex; face walking picks the
  // entry right before the reversed incoming edge in this order
  const ordered = new Map<NodeId, NodeId[]>()
  for (const [id, around] of neighbors) {
    const at = doc.nodes[id]!.pos
    ordered.set(
      id,
      [...around].sort((p, q) => angleTo(at, doc.nodes[p]!.pos) - angleTo(at, doc.nodes[q]!.pos)),
    )
  }

  const component = componentIds(neighbors)

  const used = new Set<string>() // directed edges already claimed by a face
  const rooms: Room[] = []
  const gross = new Map<Room, number>() // contour area before holes, for parent picking
  const roomComponent = new Map<Room, number>()
  const outerContours: { component: number; polygon: Vec2[]; area: number }[] = []
  for (const [from, around] of ordered) {
    for (const to of around) {
      if (used.has(`${from}:${to}`)) continue
      const nodeIds = walkFace(ordered, used, from, to)
      const polygon = nodeIds.map((id) => ({ ...doc.nodes[id]!.pos }))
      const area = shoelaceArea(polygon)
      if (area > MIN_ROOM_AREA) {
        const room: Room = { nodeIds, polygon, holes: [], area }
        rooms.push(room)
        gross.set(room, area)
        roomComponent.set(room, component.get(from)!)
      } else if (area < -MIN_ROOM_AREA) {
        outerContours.push({ component: component.get(from)!, polygon, area: -area })
      }
    }
  }

  // A detached component nested inside a room is not floor: its outer contour
  // becomes a hole of the innermost containing room of another component, and
  // the hole's whole footprint is carved out of that room's area. Components
  // never touch (touching means shared nodes means one component), so any one
  // contour vertex decides containment.
  for (const outer of outerContours) {
    const anchor = outer.polygon[0]!
    let parent: Room | undefined
    for (const room of rooms) {
      if (roomComponent.get(room) === outer.component) continue
      if (!pointInPolygon(anchor, room.polygon)) continue
      if (!parent || gross.get(room)! < gross.get(parent)!) parent = room
    }
    if (parent) {
      parent.holes.push(outer.polygon)
      parent.area -= outer.area
    }
  }

  return rooms.sort((a, b) => b.area - a.area)
}

/**
 * Stable identity for a derived room: its contour node ids, sorted. Survives
 * re-detection and node moves and only changes when the topology does, which
 * is what lets a selection reference a room that is never stored.
 */
export function roomKey(room: Room): string {
  return [...room.nodeIds].sort().join('|')
}

/** The innermost (smallest) room whose floor contains the point, or undefined. */
export function roomAt(doc: SceneDocument, pos: Vec2): Room | undefined {
  const rooms = detectRooms(doc) // largest first, so scan from the back
  for (let i = rooms.length - 1; i >= 0; i--) {
    const room = rooms[i]!
    if (!pointInPolygon(pos, room.polygon)) continue
    if (room.holes.some((hole) => pointInPolygon(pos, hole))) continue
    return room
  }
  return undefined
}

/** The current room carrying this roomKey, or undefined once the topology changed. */
export function findRoom(doc: SceneDocument, key: string): Room | undefined {
  return detectRooms(doc).find((room) => roomKey(room) === key)
}

/**
 * What deleting the room removes: its contour walls except those bounding a
 * neighbouring room too — a room doesn't own a shared wall. Empty both for a
 * stale key and for a room fully enclosed by neighbours (callers distinguish
 * via findRoom).
 */
export function roomExclusiveWalls(doc: SceneDocument, key: string): Wall[] {
  const rooms = detectRooms(doc)
  const target = rooms.find((room) => roomKey(room) === key)
  if (!target) return []

  const pair = (a: NodeId, b: NodeId) => (a < b ? `${a}:${b}` : `${b}:${a}`)
  const shared = new Set<string>()
  for (const room of rooms) {
    if (room === target) continue
    for (let i = 0; i < room.nodeIds.length; i++) {
      shared.add(pair(room.nodeIds[i]!, room.nodeIds[(i + 1) % room.nodeIds.length]!))
    }
  }

  const contour = new Set<string>()
  for (let i = 0; i < target.nodeIds.length; i++) {
    const edge = pair(target.nodeIds[i]!, target.nodeIds[(i + 1) % target.nodeIds.length]!)
    if (!shared.has(edge)) contour.add(edge)
  }
  return doc.walls.filter((wall) => contour.has(pair(wall.a, wall.b)))
}

/**
 * Adjacency of the wall graph with dead ends pruned: nodes of degree ≤ 1 are
 * removed repeatedly, so every surviving edge can lie on a cycle and room
 * contours stay simple polygons (no zero-width spurs poking inside).
 */
function cycleNeighbors(doc: SceneDocument): Map<NodeId, NodeId[]> {
  const neighbors = new Map<NodeId, NodeId[]>()
  for (const wall of doc.walls) {
    neighbors.set(wall.a, [...(neighbors.get(wall.a) ?? []), wall.b])
    neighbors.set(wall.b, [...(neighbors.get(wall.b) ?? []), wall.a])
  }

  const leaves = [...neighbors.keys()].filter((id) => neighbors.get(id)!.length <= 1)
  while (leaves.length > 0) {
    const leaf = leaves.pop()!
    const around = neighbors.get(leaf)
    if (!around) continue // already pruned via another queue entry
    neighbors.delete(leaf)
    for (const other of around) {
      const rest = neighbors.get(other)?.filter((id) => id !== leaf)
      if (!rest) continue
      neighbors.set(other, rest)
      if (rest.length <= 1) leaves.push(other)
    }
  }
  return neighbors
}

/** Connected-component id per node, over the pruned adjacency. */
function componentIds(neighbors: Map<NodeId, NodeId[]>): Map<NodeId, number> {
  const component = new Map<NodeId, number>()
  let next = 0
  for (const start of neighbors.keys()) {
    if (component.has(start)) continue
    const queue = [start]
    component.set(start, next)
    while (queue.length > 0) {
      const id = queue.pop()!
      for (const other of neighbors.get(id) ?? []) {
        if (!component.has(other)) {
          component.set(other, next)
          queue.push(other)
        }
      }
    }
    next++
  }
  return component
}

/** Walks one face starting along from→to and marks its directed edges used. */
function walkFace(
  ordered: Map<NodeId, NodeId[]>,
  used: Set<string>,
  from: NodeId,
  to: NodeId,
): NodeId[] {
  const cycle: NodeId[] = []
  let u = from
  let v = to
  do {
    cycle.push(u)
    used.add(`${u}:${v}`)
    const around = ordered.get(v)!
    const next = around[(around.indexOf(u) - 1 + around.length) % around.length]!
    u = v
    v = next
  } while (u !== from || v !== to)
  return cycle
}

function angleTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

/** Signed shoelace area; positive for faces walked in interior orientation (Y down). */
function shoelaceArea(polygon: Vec2[]): number {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!
    const q = polygon[(i + 1) % polygon.length]!
    sum += p.x * q.y - q.x * p.y
  }
  return sum / 2
}
