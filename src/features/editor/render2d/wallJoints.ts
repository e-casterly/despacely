import type { NodeId, SceneDocument, Vec2, Wall } from '../domain/types'

/**
 * Wall junction geometry as a radial seam partition. Each wall becomes a single
 * filled polygon; at a shared node the incident walls fan out from the node and
 * the seams between neighbours all radiate from it, so the walls tile the
 * junction — no void, and no overlap except where a degenerate pair falls back
 * to square butts (below).
 *
 * At every node the incident walls are sorted by outgoing angle into a ring. For
 * each adjacent pair the two facing offset edges are intersected to get the
 * seam corner they share — the CCW wall's left corner and the CW wall's right
 * corner. A crossing inside the corner is used however sharp the pair is (the
 * walls keep full thickness up to it and taper into the node together), as long
 * as it stays within both walls' lengths. A crossing behind the node (a reflex
 * outer gap) is a normal outer corner only while it hugs the node; past the
 * miter limit it would grow a spike out the back, so the walls end in square
 * butts there instead and simply overlap.
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
  /** One filled polygon per wall id, end caps (seams or butts) already applied. */
  polygons: Map<string, Vec2[]>
  /** Per wall id: its two mitered side faces, for face-length dimensioning. */
  faces: Map<string, WallFaces>
}

/** A wall's two long faces after mitering, each in a→b order;
 * 'left' lies on the (-dy, dx) side of the wall's a→b axis. */
export interface WallFaces {
  left: [Vec2, Vec2]
  right: [Vec2, Vec2]
}

/** A wall as seen leaving one of its nodes. */
interface Arm {
  wall: Wall
  dir: Vec2 // outgoing unit direction, pointing away from the node
  leftNormal: Vec2 // dir rotated +90°, towards the wall's left edge
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
      const arm = ring[0]!
      setCap(arm.wall.id, nodeId, [
        addScaled(node, arm.leftNormal, -arm.halfThickness),
        addScaled(node, arm.leftNormal, arm.halfThickness),
      ])
      continue
    }

    // Go around the node pairing each arm with its next neighbour. Where the
    // pair's two facing edges cross is the seam corner they share: it becomes
    // the arm's left corner and the neighbour's right corner. A crossing inside
    // the corner is the real seam however far it runs (a sharp pair tapers into
    // the node together), as long as it stays within both walls. A crossing
    // behind the node is kept only while it hugs the node (an ordinary outer
    // corner); otherwise the pair falls back to square butts and simply
    // overlaps — no spike out the back of the node.
    // the loop below writes every slot of both (each arm gets a left corner, and
    // each arm's right corner comes from its neighbour) before either is read
    const leftCorners: Vec2[] = []
    const rightCorners: Vec2[] = []
    for (let k = 0; k < armCount; k++) {
      const arm = ring[k]!
      const next = ring[(k + 1) % armCount]! // next neighbour going around the node
      const armButt = addScaled(node, arm.leftNormal, arm.halfThickness) // on arm's left edge
      const nextButt = addScaled(node, next.leftNormal, -next.halfThickness) // on next's right edge
      const crossing = intersect(armButt, arm.dir, nextButt, next.dir)
      let seam: Vec2 | null = null
      if (crossing) {
        const insideCorner =
          dot(subtract(crossing, node), arm.dir) > 0 && dot(subtract(crossing, node), next.dir) > 0
        const maxReach = insideCorner
          ? Math.min(arm.length, next.length)
          : MITER_LIMIT * Math.max(arm.halfThickness, next.halfThickness)
        if (distance(crossing, node) <= maxReach) seam = crossing
      }
      leftCorners[k] = seam ?? armButt
      rightCorners[(k + 1) % armCount] = seam ?? nextButt
    }

    // The node is the cap's tip between the two seam corners.
    for (let k = 0; k < armCount; k++) {
      setCap(ring[k]!.wall.id, nodeId, [rightCorners[k]!, node, leftCorners[k]!])
    }
  }

  const polygons = new Map<string, Vec2[]>()
  const faces = new Map<string, WallFaces>()
  for (const wall of doc.walls) {
    const built = wallPolygon(doc, wall, caps.get(wall.id))
    if (!built) continue
    polygons.set(wall.id, built.polygon)
    faces.set(wall.id, built.faces)
  }
  return { polygons, faces }
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
): { polygon: Vec2[]; faces: WallFaces } | null {
  const posA = doc.nodes[wall.a]?.pos
  const posB = doc.nodes[wall.b]?.pos
  if (!posA || !posB) return null
  const dir = unit(subtract(posB, posA))
  if (dir.x === 0 && dir.y === 0) return null
  const leftNormal = { x: -dir.y, y: dir.x }
  const halfThickness = wall.thickness / 2

  // Square-end fallbacks, only if a node had no ring entry (shouldn't happen).
  const aCap = perNode?.get(wall.a) ?? [
    addScaled(posA, leftNormal, -halfThickness),
    addScaled(posA, leftNormal, halfThickness),
  ]
  const bCap = perNode?.get(wall.b) ?? [
    addScaled(posB, leftNormal, halfThickness),
    addScaled(posB, leftNormal, -halfThickness),
  ]

  return {
    polygon: cleanPolygon([...bCap, ...aCap], [posA, posB]),
    // caps run [right, (tip), left] in each node's outgoing frame; the B frame
    // is flipped, so its first entry sits on the wall's left side in a→b terms
    faces: {
      left: [aCap[aCap.length - 1]!, bCap[0]!],
      right: [aCap[0]!, bCap[bCap.length - 1]!],
    },
  }
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
    addArm(wall.a, { wall, dir, leftNormal: { x: -dir.y, y: dir.x }, halfThickness, length })
    const dirB = negate(dir)
    addArm(wall.b, { wall, dir: dirB, leftNormal: { x: -dirB.y, y: dirB.x }, halfThickness, length })
  }
  for (const ring of Object.values(armsByNode)) {
    ring.sort((p, q) => Math.atan2(p.dir.y, p.dir.x) - Math.atan2(q.dir.y, q.dir.x))
  }
  return armsByNode
}

/**
 * Drops duplicate and collinear vertices, plus a node tip that folded inward at
 * a sharp junction: removing it leaves a clean straight end, and the junction
 * centre stays covered by the neighbouring walls. Only the node tips may be
 * dropped for being reflex — any other vertex is a real corner and stays put.
 */
function cleanPolygon(pts: Vec2[], nodeTips: Vec2[]): Vec2[] {
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
    else if (cross * winding < -1e-6 && !nodeTips.some((t) => distance(t, b) < 1e-7)) out.push(b)
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
