import { distToSegment, projectOnSegment } from './geometry'
import type { Item, Node, NodeId, Opening, SceneDocument, Vec2, Wall } from './types'
import { WALL_HEIGHT, WALL_THICKNESS } from './units'

export interface WallOptions {
  thickness?: number
  height?: number
}

export function createEmptyDocument(): SceneDocument {
  return { nodes: {}, walls: [], items: [] }
}

// --- nodes ---

export function addNode(doc: SceneDocument, pos: Vec2): NodeId {
  const id = crypto.randomUUID()
  doc.nodes[id] = { id, pos }
  return id
}

export function findNode(doc: SceneDocument, id: NodeId): Node | undefined {
  return doc.nodes[id]
}

/** Nearest existing node within maxDist (cm), or undefined; `except` is skipped. */
export function nodeAt(doc: SceneDocument, pos: Vec2, maxDist: number, except?: NodeId): Node | undefined {
  let best: Node | undefined
  let bestDist = maxDist
  for (const node of Object.values(doc.nodes)) {
    if (node.id === except) continue
    const dist = Math.hypot(node.pos.x - pos.x, node.pos.y - pos.y)
    if (dist <= bestDist) {
      best = node
      bestDist = dist
    }
  }
  return best
}

/** True when some wall connects the two nodes directly. */
export function nodesConnected(doc: SceneDocument, a: NodeId, b: NodeId): boolean {
  return doc.walls.some((wall) => (wall.a === a && wall.b === b) || (wall.a === b && wall.b === a))
}

export function moveNode(doc: SceneDocument, id: NodeId, pos: Vec2): void {
  const node = doc.nodes[id]
  if (node) node.pos = pos
}

export function wallsAtNode(doc: SceneDocument, nodeId: NodeId): Wall[] {
  return doc.walls.filter((wall) => wall.a === nodeId || wall.b === nodeId)
}

function reuseOrAddNode(doc: SceneDocument, pos: Vec2, snapDist: number): NodeId {
  return nodeAt(doc, pos, snapDist)?.id ?? addNode(doc, pos)
}

// --- walls ---

export function addWall(doc: SceneDocument, a: NodeId, b: NodeId, opts: WallOptions = {}): Wall {
  const wall: Wall = {
    id: crypto.randomUUID(),
    a,
    b,
    thickness: opts.thickness ?? WALL_THICKNESS,
    height: opts.height ?? WALL_HEIGHT,
    openings: [],
  }
  doc.walls.push(wall)
  return wall
}

/**
 * High-level constructor used by the wall tool: snaps each endpoint to a nearby
 * existing node (reusing it so corners connect) or creates one. Returns undefined
 * for a degenerate zero-length wall.
 */
export function addWallBetween(
  doc: SceneDocument,
  posA: Vec2,
  posB: Vec2,
  opts: WallOptions & { snapDist?: number } = {},
): Wall | undefined {
  const snapDist = opts.snapDist ?? 0
  const a = reuseOrAddNode(doc, posA, snapDist)
  const b = reuseOrAddNode(doc, posB, snapDist)
  if (a === b) return undefined
  return addWall(doc, a, b, opts)
}

export function findWall(doc: SceneDocument, id: string): Wall | undefined {
  return doc.walls.find((wall) => wall.id === id)
}

/**
 * The node moves that stretch a wall by `delta` cm at the given end (outward
 * positive), keeping every junction angle intact — so the wall's mitred face
 * lengths change by exactly `delta`, linearly, with no solve:
 *
 * - a free end slides its own node along the axis (its cap is a square butt);
 * - a two-wall corner translates the neighbouring wall whole — its far node
 *   follows the shared one, no direction changes, so the seam slides with it.
 *
 * Undefined at a junction of three or more walls: no single neighbour owns the
 * seam there, and moving one would kink the others — the edit has no
 * unambiguous linear form, so the caller should refuse it instead.
 */
export function stretchWallMoves(
  doc: SceneDocument,
  wall: Wall,
  end: 'a' | 'b',
  delta: number,
): { nodeId: NodeId; from: Vec2; to: Vec2 }[] | undefined {
  const nodeId = wall[end]
  const pos = doc.nodes[nodeId]?.pos
  const otherPos = doc.nodes[end === 'a' ? wall.b : wall.a]?.pos
  if (!pos || !otherPos) return undefined
  const len = Math.hypot(pos.x - otherPos.x, pos.y - otherPos.y)
  if (len === 0) return undefined
  const shift = {
    x: ((pos.x - otherPos.x) / len) * delta,
    y: ((pos.y - otherPos.y) / len) * delta,
  }
  const move = (id: NodeId) => {
    const from = doc.nodes[id]!.pos
    return { nodeId: id, from: { ...from }, to: { x: from.x + shift.x, y: from.y + shift.y } }
  }

  const junction = wallsAtNode(doc, nodeId).filter((other) => other.id !== wall.id)
  if (junction.length === 0) return [move(nodeId)]
  if (junction.length > 1) return undefined
  const neighbour = junction[0]!
  return [move(nodeId), move(neighbour.a === nodeId ? neighbour.b : neighbour.a)]
}

/** cm: a point within this of a wall's body counts as lying on it (a mid-wall point). */
export const ON_WALL_TOL = 0.001

/**
 * The wall the point sits deepest inside, within a pick tolerance (cm).
 *
 * This is the "what did the user click on" question: it ranks by depth into the
 * wall's *body*, so next to a seam a thick wall beats a thin neighbour whose
 * centerline happens to be closer. Contrast `wallAtPoint`, which measures to the
 * centerline and deliberately refuses hits near the ends — that one answers
 * "where would a new wall split this one", which is a different question.
 */
export function wallUnderPoint(doc: SceneDocument, point: Vec2, slop: number): Wall | undefined {
  let best: Wall | undefined
  let bestDepth = Infinity
  for (const wall of doc.walls) {
    const { a, b } = wallSegment(doc, wall)
    const depth = distToSegment(point, a, b) - wall.thickness / 2
    if (depth <= slop && depth < bestDepth) {
      best = wall
      bestDepth = depth
    }
  }
  return best
}

/**
 * The wall whose body the point lies on (nearest within `maxDist`), or undefined.
 * Hits at a wall's own endpoints are ignored — those are vertices, not a mid-wall
 * point — as are walls touching an excluded node. For click-picking a wall, use
 * `wallUnderPoint` instead.
 */
export function wallAtPoint(
  doc: SceneDocument,
  pos: Vec2,
  maxDist: number,
  exclude?: Set<NodeId>,
): Wall | undefined {
  let best: Wall | undefined
  let bestDist = maxDist
  for (const wall of doc.walls) {
    if (exclude && (exclude.has(wall.a) || exclude.has(wall.b))) continue
    const a = doc.nodes[wall.a]?.pos
    const b = doc.nodes[wall.b]?.pos
    if (!a || !b) continue
    const dist = distToSegment(pos, a, b)
    if (dist > bestDist) continue
    if (Math.hypot(pos.x - a.x, pos.y - a.y) <= maxDist) continue
    if (Math.hypot(pos.x - b.x, pos.y - b.y) <= maxDist) continue
    best = wall
    bestDist = dist
  }
  return best
}

export interface WallSplit {
  nodeId: NodeId
  removed: Wall
  added: [Wall, Wall]
}

/**
 * Splits a wall at `pos`, replacing it with two halves joined by a new node that
 * inherit its thickness, height and openings. The endpoints stay shared, so
 * nothing is GC'd. Returns the changeset, or undefined if the wall no longer
 * exists.
 */
export function splitWallAt(doc: SceneDocument, wallId: string, pos: Vec2): WallSplit | undefined {
  const wall = findWall(doc, wallId)
  if (!wall) return undefined
  const nodeId = addNode(doc, pos)
  const opts = { thickness: wall.thickness, height: wall.height }
  const added: [Wall, Wall] = [addWall(doc, wall.a, nodeId, opts), addWall(doc, nodeId, wall.b, opts)]
  distributeOpenings(doc, wall, pos, added)
  doc.walls = doc.walls.filter((w) => w.id !== wallId)
  return { nodeId, removed: wall, added }
}

/**
 * Hands each of the split wall's openings to the half it lands on. The B half
 * starts at the split point, so its openings rebase by the split offset.
 *
 * An opening the split runs straight through does not survive: you built a wall
 * through the door, so the door is gone. Undo restores it with the original wall.
 *
 * The originals are copied, never moved: `removed` is the very object the undo of
 * AddWallCommand pushes back, so its openings must stay intact. Copying also
 * keeps the ids, which is what lets redo replay the recorded halves and land on
 * the same openings without recording anything extra.
 */
function distributeOpenings(doc: SceneDocument, wall: Wall, pos: Vec2, added: [Wall, Wall]): void {
  if (wall.openings.length === 0) return
  const { a, b } = wallSegment(doc, wall)
  const splitOffset = projectOnSegment(pos, a, b).t * Math.hypot(b.x - a.x, b.y - a.y)
  for (const opening of wall.openings) {
    const start = opening.offset - opening.width / 2
    const end = opening.offset + opening.width / 2
    if (end <= splitOffset) {
      added[0].openings.push({ ...opening })
    } else if (start >= splitOffset) {
      added[1].openings.push({ ...opening, offset: opening.offset - splitOffset })
    }
  }
}

/** A stored opening together with where it lives, since openings hang off walls. */
export interface OpeningLocation {
  wall: Wall
  opening: Opening
  index: number
}

export function findOpening(doc: SceneDocument, id: string): OpeningLocation | undefined {
  for (const wall of doc.walls) {
    const index = wall.openings.findIndex((opening) => opening.id === id)
    if (index !== -1) return { wall, opening: wall.openings[index]!, index }
  }
  return undefined
}

/** Removes a wall and garbage-collects any endpoint left with no other walls. */
export function removeWall(doc: SceneDocument, id: string): void {
  const wall = findWall(doc, id)
  if (!wall) return

  doc.walls = doc.walls.filter((w) => w.id !== id)

  for (const nodeId of new Set([wall.a, wall.b])) {
    if (wallsAtNode(doc, nodeId).length === 0) delete doc.nodes[nodeId]
  }
}

/**
 * True if placing nodes at the given positions would give some wall zero
 * length. Used to refuse such moves (drag preview, inspector coordinate edits).
 */
export function collapsesAWall(doc: SceneDocument, moved: Record<NodeId, Vec2>): boolean {
  return doc.walls.some((wall) => {
    const a = moved[wall.a] ?? doc.nodes[wall.a]!.pos
    const b = moved[wall.b] ?? doc.nodes[wall.b]!.pos
    return a.x === b.x && a.y === b.y
  })
}

/** What mergeNodes changed — enough for a command to undo it. */
export interface MergeReport {
  /** wall endpoints that were rewired from the source to the target */
  rewired: { wallId: string; end: 'a' | 'b' }[]
  /** walls dropped because rewiring made them span the same pair as another wall */
  removedWalls: Wall[]
}

/**
 * Welds `source` into `target`: every wall at the source is rewired to the
 * target, rewired walls that now duplicate another wall are dropped, and the
 * source node is deleted. The two nodes must not share a wall — it would
 * collapse to zero length (callers guard against that).
 */
export function mergeNodes(doc: SceneDocument, sourceId: NodeId, targetId: NodeId): MergeReport {
  const rewired: MergeReport['rewired'] = []
  for (const wall of doc.walls) {
    if (wall.a === sourceId) {
      wall.a = targetId
      rewired.push({ wallId: wall.id, end: 'a' })
    }
    if (wall.b === sourceId) {
      wall.b = targetId
      rewired.push({ wallId: wall.id, end: 'b' })
    }
  }
  const pair = (wall: Wall) => (wall.a < wall.b ? `${wall.a}:${wall.b}` : `${wall.b}:${wall.a}`)
  const removedWalls: Wall[] = []
  for (const { wallId } of rewired) {
    const wall = findWall(doc, wallId)
    if (!wall) continue // already dropped as a duplicate
    if (doc.walls.some((other) => other !== wall && pair(other) === pair(wall))) {
      doc.walls = doc.walls.filter((w) => w !== wall)
      removedWalls.push(wall)
    }
  }
  delete doc.nodes[sourceId]
  return { rewired, removedWalls }
}

export interface Bounds {
  min: Vec2
  max: Vec2
}

/**
 * World-space bbox of everything drawn, or null for an empty scene. Wall ends
 * grow by half the thickness on both axes — an over-cover for slanted walls,
 * which is fine for framing. Orphan-node GC guarantees walls reach every node.
 */
export function docBounds(doc: SceneDocument): Bounds | null {
  let min = { x: Infinity, y: Infinity }
  let max = { x: -Infinity, y: -Infinity }
  function include(p: Vec2, ex: number, ey: number) {
    min = { x: Math.min(min.x, p.x - ex), y: Math.min(min.y, p.y - ey) }
    max = { x: Math.max(max.x, p.x + ex), y: Math.max(max.y, p.y + ey) }
  }
  for (const wall of doc.walls) {
    const { a, b } = wallSegment(doc, wall)
    const half = wall.thickness / 2
    include(a, half, half)
    include(b, half, half)
  }
  for (const item of doc.items) {
    const cos = Math.abs(Math.cos(item.rotation))
    const sin = Math.abs(Math.sin(item.rotation))
    include(
      item.pos,
      (cos * item.size.x + sin * item.size.y) / 2,
      (sin * item.size.x + cos * item.size.y) / 2,
    )
  }
  return min.x === Infinity ? null : { min, max }
}

/** Resolves a wall's node references to concrete points for rendering / hit-testing. */
export function wallSegment(doc: SceneDocument, wall: Wall): { a: Vec2; b: Vec2 } {
  const a = doc.nodes[wall.a]
  const b = doc.nodes[wall.b]
  if (!a || !b) throw new Error(`Wall ${wall.id} references a missing node`)
  return { a: a.pos, b: b.pos }
}

// --- items (not part of the wall graph) ---

export function addItem(doc: SceneDocument, item: Item): void {
  doc.items.push(item)
}

export function removeItem(doc: SceneDocument, id: string): void {
  doc.items = doc.items.filter((item) => item.id !== id)
}

export function findItem(doc: SceneDocument, id: string): Item | undefined {
  return doc.items.find((item) => item.id === id)
}

export function moveItem(doc: SceneDocument, id: string, pos: Vec2): void {
  const item = findItem(doc, id)
  if (item) item.pos = pos
}
