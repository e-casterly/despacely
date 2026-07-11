import type { NodeId, SceneDocument, Vec2 } from './types'

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
  /** enclosed area measured along wall centerlines, cm² */
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

  const used = new Set<string>() // directed edges already claimed by a face
  const rooms: Room[] = []
  for (const [from, around] of ordered) {
    for (const to of around) {
      if (used.has(`${from}:${to}`)) continue
      const nodeIds = walkFace(ordered, used, from, to)
      const polygon = nodeIds.map((id) => ({ ...doc.nodes[id]!.pos }))
      const area = shoelaceArea(polygon)
      if (area > MIN_ROOM_AREA) rooms.push({ nodeIds, polygon, area })
    }
  }
  return rooms.sort((a, b) => b.area - a.area)
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
