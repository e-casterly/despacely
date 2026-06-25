import type { NodeId, SceneDocument, Vec2, Wall } from '../domain/types'

/**
 * Wall junction geometry as a radial seam partition. Each wall becomes a single
 * filled polygon; at a shared node the incident walls fan out from the node and
 * the seams between neighbours all radiate from it, so the walls tile the
 * junction exactly — no overlap, no void.
 *
 * At every node the incident walls are sorted by outgoing angle into a ring. For
 * each adjacent pair the two facing offset edges are intersected to get the
 * seam point they share — the CCW wall's left corner and the CW wall's right
 * corner. When that miter would run far past the node (a very sharp corner) the
 * walls fall back to their square butt corners and simply overlap instead, which
 * still covers the node.
 *
 * The node itself is the tip between a wall's two seam corners. At a plain 2-wall
 * corner it lands on the straight seam and drops out as collinear, leaving a
 * clean miter. At a 3+-wall junction it is the real point the walls fan from, so
 * a middle wall comes to a point there (with the two outer walls meeting at their
 * apex above it) — the way a floor-plan editor draws it — and never leaves a void.
 */

/** Miter falls back to overlapping butts once it would reach past this × half-thickness. */
const MITER_LIMIT = 4

export interface WallGeometry {
  /** One filled polygon per wall id, already mitered at both ends. */
  polygons: Map<string, Vec2[]>
}

/** A wall as seen leaving one of its nodes. */
interface Arm {
  wall: Wall
  u: Vec2 // outgoing unit direction, pointing away from the node
  leftN: Vec2 // u rotated +90°
  hw: number // half thickness
}

export function computeWallGeometry(doc: SceneDocument): WallGeometry {
  // caps[wallId][nodeId] = the wall's end cap at that node, in the node's
  // outgoing frame, ordered [right corner, (node tip), left corner].
  const caps = new Map<string, Map<NodeId, Vec2[]>>()
  const setCap = (wallId: string, nodeId: NodeId, cap: Vec2[]): void => {
    let perNode = caps.get(wallId)
    if (!perNode) caps.set(wallId, (perNode = new Map()))
    perNode.set(nodeId, cap)
  }

  for (const [nodeId, ring] of Object.entries(rings(doc))) {
    const node = doc.nodes[nodeId]?.pos
    if (!node) continue
    const n = ring.length
    if (n === 1) {
      // Free end: a square butt, no node tip.
      const a = ring[0]!
      setCap(a.wall.id, nodeId, [addScaled(node, a.leftN, -a.hw), addScaled(node, a.leftN, a.hw)])
      continue
    }

    // Each sector's seam point is the CCW wall's left corner and the CW wall's
    // right corner: a reachable miter, else each wall's own butt (they overlap).
    const left: Vec2[] = new Array(n)
    const right: Vec2[] = new Array(n)
    for (let k = 0; k < n; k++) {
      const w = ring[k]! // sector's CCW (left) wall
      const x = ring[(k + 1) % n]! // sector's CW (right) neighbour
      const wButt = addScaled(node, w.leftN, w.hw) // on w's left edge
      const xButt = addScaled(node, x.leftN, -x.hw) // on x's right edge
      const miter = intersect(wButt, w.u, xButt, x.u)
      if (miter && dist(miter, node) <= MITER_LIMIT * Math.max(w.hw, x.hw)) {
        left[k] = miter
        right[(k + 1) % n] = miter
      } else {
        left[k] = wButt
        right[(k + 1) % n] = xButt
      }
    }

    // The node is the cap's tip between the two seam corners.
    for (let k = 0; k < n; k++) {
      setCap(ring[k]!.wall.id, nodeId, [right[k]!, node, left[k]!])
    }
  }

  const polygons = new Map<string, Vec2[]>()
  for (const wall of doc.walls) {
    const poly = wallPolygon(doc, wall, caps.get(wall.id))
    if (poly) polygons.set(wall.id, poly)
  }
  return { polygons }
}

/**
 * Assembles one wall's polygon from its two end caps: the B-end cap, down the
 * shared side to the A-end cap, and back. Each cap is stored in its node's
 * outgoing frame, which already lines the two up head-to-tail.
 */
function wallPolygon(
  doc: SceneDocument,
  wall: Wall,
  perNode: Map<NodeId, Vec2[]> | undefined,
): Vec2[] | null {
  const posA = doc.nodes[wall.a]?.pos
  const posB = doc.nodes[wall.b]?.pos
  if (!posA || !posB) return null
  const u = unit(sub(posB, posA))
  if (u.x === 0 && u.y === 0) return null
  const leftN = { x: -u.y, y: u.x }
  const hw = wall.thickness / 2

  // Square-end fallbacks, only if a node had no ring entry (shouldn't happen).
  const aCap = perNode?.get(wall.a) ?? [addScaled(posA, leftN, -hw), addScaled(posA, leftN, hw)]
  const bCap = perNode?.get(wall.b) ?? [addScaled(posB, leftN, hw), addScaled(posB, leftN, -hw)]

  return cleanPolygon([...bCap, ...aCap])
}

/** Arms touching each node, sorted CCW by the angle of their outgoing direction. */
function rings(doc: SceneDocument): Record<NodeId, Arm[]> {
  const out: Record<NodeId, Arm[]> = {}
  const push = (nodeId: NodeId, arm: Arm): void => {
    ;(out[nodeId] ?? (out[nodeId] = [])).push(arm)
  }
  for (const wall of doc.walls) {
    const posA = doc.nodes[wall.a]?.pos
    const posB = doc.nodes[wall.b]?.pos
    if (!posA || !posB) continue
    const u = unit(sub(posB, posA))
    if (u.x === 0 && u.y === 0) continue
    const hw = wall.thickness / 2
    push(wall.a, { wall, u, leftN: { x: -u.y, y: u.x }, hw })
    const ub = neg(u)
    push(wall.b, { wall, u: ub, leftN: { x: -ub.y, y: ub.x }, hw })
  }
  for (const ring of Object.values(out)) {
    ring.sort((p, q) => Math.atan2(p.u.y, p.u.x) - Math.atan2(q.u.y, q.u.x))
  }
  return out
}

/** Drops duplicate and collinear vertices so a straight seam is one clean edge. */
function cleanPolygon(pts: Vec2[]): Vec2[] {
  const deduped: Vec2[] = []
  for (const p of pts) {
    const last = deduped[deduped.length - 1]
    if (!last || dist(last, p) > 1e-7) deduped.push(p)
  }
  if (deduped.length > 1 && dist(deduped[0]!, deduped[deduped.length - 1]!) < 1e-7) deduped.pop()
  if (deduped.length < 3) return deduped
  const out: Vec2[] = []
  const m = deduped.length
  for (let i = 0; i < m; i++) {
    const a = deduped[(i - 1 + m) % m]!
    const b = deduped[i]!
    const c = deduped[(i + 1) % m]!
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (Math.abs(cross) > 1e-6) out.push(b)
  }
  return out.length >= 3 ? out : deduped
}

// --- vector helpers ---

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

function neg(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y }
}

function addScaled(p: Vec2, v: Vec2, s: number): Vec2 {
  return { x: p.x + v.x * s, y: p.y + v.y * s }
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function unit(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y)
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len }
}

/** Intersection of lines (p1 + t·d1) and (p2 + s·d2); null if near-parallel. */
function intersect(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const cross = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(cross) < 1e-9) return null
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / cross
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t }
}
