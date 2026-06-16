import type { Item, Node, NodeId, SceneDocument, Vec2, Wall } from './types'
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

/** Nearest existing node within maxDist (cm), or undefined. */
export function nodeAt(doc: SceneDocument, pos: Vec2, maxDist: number): Node | undefined {
  let best: Node | undefined
  let bestDist = maxDist
  for (const node of Object.values(doc.nodes)) {
    const dist = Math.hypot(node.pos.x - pos.x, node.pos.y - pos.y)
    if (dist <= bestDist) {
      best = node
      bestDist = dist
    }
  }
  return best
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

/** Removes a wall and garbage-collects any endpoint left with no other walls. */
export function removeWall(doc: SceneDocument, id: string): void {
  const wall = findWall(doc, id)
  if (!wall) return

  doc.walls = doc.walls.filter((w) => w.id !== id)

  for (const nodeId of new Set([wall.a, wall.b])) {
    if (wallsAtNode(doc, nodeId).length === 0) delete doc.nodes[nodeId]
  }
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
