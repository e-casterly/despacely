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
 * corner. A crossing inside the corner is always used, however sharp: the pair
 * keeps full thickness up to the crossing and tapers into the node together
 * along the seam. A crossing behind the node (a reflex outer gap) is a normal
 * outer corner only while it hugs the node; past the miter limit it would grow
 * a spike out the back, so the walls end in square butts there instead and
 * simply overlap.
 *
 * The node itself is the tip between a wall's two seam corners. At a plain 2-wall
 * corner it lands on the straight seam and drops out as collinear, leaving a
 * clean miter. At a 3+-wall junction it is the real point the walls fan from, so
 * a middle wall comes to a point there (with the two outer walls meeting at their
 * apex above it) — the way a floor-plan editor draws it — and never leaves a void.
 */

/** An outer-corner miter reaching past this × half-thickness becomes square butts. */
const MITER_LIMIT = 4

export interface WallGeometry {
  /** One filled polygon per wall id, already mitered at both ends. */
  polygons: Map<string, Vec2[]>
}

/** A wall as seen leaving one of its nodes. */
interface Arm {
  wall: Wall
  dir: Vec2 // outgoing unit direction, pointing away from the node
  leftN: Vec2 // dir rotated +90° (the wall's left edge normal)
  halfThickness: number
  length: number
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
    const armCount = ring.length
    if (armCount === 1) {
      // Free end: a square butt, no node tip.
      const a = ring[0]!
      setCap(a.wall.id, nodeId, [
        addScaled(node, a.leftN, -a.halfThickness),
        addScaled(node, a.leftN, a.halfThickness),
      ])
      continue
    }

    // Go around the node pairing each wall `w` with its next neighbour `x`. Where
    // the two facing edges of the pair cross is the seam corner they share: it
    // becomes w's left corner (left[k]) and x's right corner (right[k+1]). A
    // crossing inside the corner is the real seam however far it runs (a sharp
    // pair tapers into the node together), as long as it stays within both
    // walls. A crossing behind the node is kept only while it hugs the node
    // (an ordinary outer corner); otherwise the pair falls back to square
    // butts and simply overlaps — no spike out the back of the node.
    const left: Vec2[] = new Array(armCount)
    const right: Vec2[] = new Array(armCount)
    for (let k = 0; k < armCount; k++) {
      const w = ring[k]! // current wall
      const x = ring[(k + 1) % armCount]! // its next neighbour going around the node
      const wButt = addScaled(node, w.leftN, w.halfThickness) // on w's left edge
      const xButt = addScaled(node, x.leftN, -x.halfThickness) // on x's right edge
      const miter = intersect(wButt, w.dir, xButt, x.dir)
      let seam: Vec2 | null = null
      if (miter) {
        const front =
          dot(subtract(miter, wButt), w.dir) > 0 && dot(subtract(miter, xButt), x.dir) > 0
        const reach = distance(miter, node)
        const withinLimit = front
          ? reach <= Math.min(w.length, x.length)
          : reach <= MITER_LIMIT * Math.max(w.halfThickness, x.halfThickness)
        if (withinLimit) seam = miter
      }
      left[k] = seam ?? wButt
      right[(k + 1) % armCount] = seam ?? xButt
    }

    // The node is the cap's tip between the two seam corners.
    for (let k = 0; k < armCount; k++) {
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
  const dir = unit(subtract(posB, posA))
  if (dir.x === 0 && dir.y === 0) return null
  const leftN = { x: -dir.y, y: dir.x }
  const halfThickness = wall.thickness / 2

  // Square-end fallbacks, only if a node had no ring entry (shouldn't happen).
  const aCap = perNode?.get(wall.a) ?? [
    addScaled(posA, leftN, -halfThickness),
    addScaled(posA, leftN, halfThickness),
  ]
  const bCap = perNode?.get(wall.b) ?? [
    addScaled(posB, leftN, halfThickness),
    addScaled(posB, leftN, -halfThickness),
  ]

  return cleanPolygon([...bCap, ...aCap], [posA, posB])
}

/** Arms touching each node, sorted CCW by the angle of their outgoing direction. */
function rings(doc: SceneDocument): Record<NodeId, Arm[]> {
  const armsByNode: Record<NodeId, Arm[]> = {}
  const addArm = (nodeId: NodeId, arm: Arm): void => {
    const ring = armsByNode[nodeId] ?? (armsByNode[nodeId] = [])
    ring.push(arm)
  }
  for (const wall of doc.walls) {
    const posA = doc.nodes[wall.a]?.pos
    const posB = doc.nodes[wall.b]?.pos
    if (!posA || !posB) continue
    const dir = unit(subtract(posB, posA))
    if (dir.x === 0 && dir.y === 0) continue
    const halfThickness = wall.thickness / 2
    const length = distance(posA, posB)
    addArm(wall.a, { wall, dir, leftN: { x: -dir.y, y: dir.x }, halfThickness, length })
    const dirB = negate(dir)
    addArm(wall.b, { wall, dir: dirB, leftN: { x: -dirB.y, y: dirB.x }, halfThickness, length })
  }
  for (const ring of Object.values(armsByNode)) {
    ring.sort((p, q) => Math.atan2(p.dir.y, p.dir.x) - Math.atan2(q.dir.y, q.dir.x))
  }
  return armsByNode
}

/**
 * Drops duplicate and collinear vertices, plus reflex (concave) node tips: a tip
 * that folded inward at a sharp junction leaves a clean end when removed, and the
 * junction centre stays covered by the neighbouring walls. Other reflex vertices
 * are kept — a bevelled corner's seam end is legitimately concave.
 */
function cleanPolygon(pts: Vec2[], tips: Vec2[]): Vec2[] {
  const deduped: Vec2[] = []
  for (const p of pts) {
    const last = deduped[deduped.length - 1]
    if (!last || distance(last, p) > 1e-7) deduped.push(p)
  }
  if (deduped.length > 1 && distance(deduped[0]!, deduped[deduped.length - 1]!) < 1e-7) deduped.pop()
  if (deduped.length < 3) return deduped
  // Winding sign from the signed area; a convex corner turns the same way as it.
  let area = 0
  for (let i = 0; i < deduped.length; i++) {
    const b = deduped[i]!
    const c = deduped[(i + 1) % deduped.length]!
    area += b.x * c.y - c.x * b.y
  }
  const winding = Math.sign(area)
  const out: Vec2[] = []
  const m = deduped.length
  for (let i = 0; i < m; i++) {
    const a = deduped[(i - 1 + m) % m]!
    const b = deduped[i]!
    const c = deduped[(i + 1) % m]!
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (cross * winding > 1e-6) out.push(b)
    else if (cross * winding < -1e-6 && !tips.some((t) => distance(t, b) < 1e-7)) out.push(b)
  }
  return out.length >= 3 ? out : deduped
}

// --- vector helpers ---

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

function negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y }
}

/** Moves `point` by `length` along `vector` (a unit direction): point + vector · length. */
function addScaled(point: Vec2, vector: Vec2, length: number): Vec2 {
  return { x: point.x + vector.x * length, y: point.y + vector.y * length }
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function unit(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y)
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len }
}

/** Intersection of lines (p1 + t·dir1) and (p2 + s·dir2); null if near-parallel. */
function intersect(p1: Vec2, dir1: Vec2, p2: Vec2, dir2: Vec2): Vec2 | null {
  const cross = dir1.x * dir2.y - dir1.y * dir2.x
  if (Math.abs(cross) < 1e-9) return null
  const t = ((p2.x - p1.x) * dir2.y - (p2.y - p1.y) * dir2.x) / cross
  return { x: p1.x + dir1.x * t, y: p1.y + dir1.y * t }
}
