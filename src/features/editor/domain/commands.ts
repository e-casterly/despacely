import {
  addItem,
  addWallBetween,
  findOpening,
  findWall,
  mergeNodes,
  moveItem,
  moveNode,
  nodeAt,
  ON_WALL_TOL,
  removeItem,
  removeWall,
  splitWallAt,
  wallAtPoint,
  wallsAtNode,
  type MergeReport,
  type WallOptions,
} from './operations'
import { roomExclusiveWalls } from './rooms'
import type { Item, Node, NodeId, Opening, SceneDocument, Vec2, Wall } from './types'

/**
 * A reversible edit. Every document mutation goes through a command so the
 * history can undo/redo it; `do` must be repeatable (redo) and restore the same
 * entities it created the first time.
 */
export interface Command {
  do(doc: SceneDocument): void
  undo(doc: SceneDocument): void
  readonly label: string
}

/**
 * Adds a wall between two points, snapping endpoints to nearby nodes. An
 * endpoint that lands on the body of an existing wall splits that wall into two
 * halves joined by the new vertex, so the drawn wall connects into a real
 * T-junction (which rooms can form around) instead of just crossing it. The
 * split(s) and the new wall are one history entry; the whole net change is
 * recorded so undo/redo restore the exact same graph.
 */
export class AddWallCommand implements Command {
  readonly label = 'Add wall'
  private applied = false
  private addedNodes: Node[] = []
  private addedWalls: Wall[] = []
  private removedWalls: Wall[] = []

  constructor(
    private readonly posA: Vec2,
    private readonly posB: Vec2,
    private readonly opts: WallOptions & { snapDist?: number } = {},
  ) {}

  do(doc: SceneDocument): void {
    if (this.applied) {
      // redo: replay the recorded net changeset (drop the split originals, then
      // re-insert every node and wall created the first time)
      const removed = new Set(this.removedWalls.map((w) => w.id))
      doc.walls = doc.walls.filter((w) => !removed.has(w.id))
      for (const node of this.addedNodes) doc.nodes[node.id] = node
      doc.walls.push(...this.addedWalls)
      return
    }
    const beforeNodes = new Set(Object.keys(doc.nodes))
    const beforeWalls = new Map(doc.walls.map((w) => [w.id, w]))
    const snapDist = this.opts.snapDist ?? 0
    splitUnderPoint(doc, this.posA, snapDist)
    splitUnderPoint(doc, this.posB, snapDist)
    addWallBetween(doc, this.posA, this.posB, this.opts)
    this.addedNodes = Object.values(doc.nodes).filter((node) => !beforeNodes.has(node.id))
    const afterWalls = new Set(doc.walls.map((w) => w.id))
    this.addedWalls = doc.walls.filter((w) => !beforeWalls.has(w.id))
    this.removedWalls = [...beforeWalls.values()].filter((w) => !afterWalls.has(w.id))
    this.applied = true
  }

  undo(doc: SceneDocument): void {
    const added = new Set(this.addedWalls.map((w) => w.id))
    doc.walls = doc.walls.filter((w) => !added.has(w.id))
    for (const node of this.addedNodes) delete doc.nodes[node.id]
    doc.walls.push(...this.removedWalls)
  }
}

/**
 * Splits the wall under `pos` (if any) so a drawn endpoint there becomes a
 * vertex. Skipped when the point already sits on a node — a snapped corner, or
 * one a prior split just made — so a chained or repeated point never re-splits;
 * a vertex beating an edge here mirrors the snap resolver's own priority.
 */
function splitUnderPoint(doc: SceneDocument, pos: Vec2, snapDist: number): void {
  if (nodeAt(doc, pos, snapDist)) return
  const wall = wallAtPoint(doc, pos, ON_WALL_TOL)
  if (wall) splitWallAt(doc, wall.id, pos)
}

/**
 * Adds a closed loop of walls through the given corners (the last corner
 * connects back to the first) as one history entry. The wall tool builds these
 * one segment per command; a room is drawn in a single gesture, so it undoes as
 * a whole. Endpoints snap to nearby nodes exactly like {@link AddWallCommand},
 * so consecutive corners share their joint and the loop can weld onto existing
 * geometry; a degenerate edge (coincident corners) is skipped.
 */
export class AddRoomCommand implements Command {
  readonly label = 'Add room'
  private walls: Wall[] = []
  private createdNodes: Node[] = []

  constructor(
    private readonly corners: Vec2[],
    private readonly opts: WallOptions & { snapDist?: number } = {},
  ) {}

  do(doc: SceneDocument): void {
    if (this.walls.length > 0) {
      // redo: re-insert the exact entities created the first time
      for (const node of this.createdNodes) doc.nodes[node.id] = node
      doc.walls.push(...this.walls)
      return
    }
    const before = new Set(Object.keys(doc.nodes))
    for (let i = 0; i < this.corners.length; i++) {
      const from = this.corners[i]!
      const to = this.corners[(i + 1) % this.corners.length]!
      const wall = addWallBetween(doc, from, to, this.opts)
      if (wall) this.walls.push(wall)
    }
    this.createdNodes = Object.values(doc.nodes).filter((node) => !before.has(node.id))
  }

  undo(doc: SceneDocument): void {
    const wallIds = new Set(this.walls.map((w) => w.id))
    doc.walls = doc.walls.filter((w) => !wallIds.has(w.id))
    for (const node of this.createdNodes) delete doc.nodes[node.id]
  }
}

/** Deletes a wall, restoring it (and any GC'd endpoints) on undo. */
export class RemoveWallCommand implements Command {
  readonly label = 'Delete wall'
  private wall?: Wall
  private removedNodes: Node[] = []

  constructor(private readonly wallId: string) {}

  do(doc: SceneDocument): void {
    const wall = findWall(doc, this.wallId)
    if (!wall) return
    this.wall = wall
    const before = { ...doc.nodes }
    removeWall(doc, this.wallId)
    this.removedNodes = Object.keys(before)
      .filter((id) => !(id in doc.nodes))
      .map((id) => before[id] as Node)
  }

  undo(doc: SceneDocument): void {
    if (!this.wall) return
    for (const node of this.removedNodes) doc.nodes[node.id] = node
    doc.walls.push(this.wall)
  }
}

/** Edits a wall's scalar properties as one history entry; a partial patch. */
export class SetWallPropsCommand implements Command {
  readonly label = 'Edit wall'
  private before: WallOptions = {}

  constructor(
    private readonly wallId: string,
    private readonly props: WallOptions,
  ) {}

  do(doc: SceneDocument): void {
    const wall = findWall(doc, this.wallId)
    if (!wall) return
    this.before = { thickness: wall.thickness, height: wall.height }
    if (this.props.thickness !== undefined) wall.thickness = this.props.thickness
    if (this.props.height !== undefined) wall.height = this.props.height
  }

  undo(doc: SceneDocument): void {
    const wall = findWall(doc, this.wallId)
    if (wall) Object.assign(wall, this.before)
  }
}

/**
 * Deletes a vertex by deleting every wall that meets at it (a vertex cannot
 * exist without walls); far endpoints left wall-less are GC'd along the way.
 * Undo restores all removed walls and nodes.
 */
export class RemoveNodeCommand implements Command {
  readonly label = 'Delete vertex'
  private removedWalls: Wall[] = []
  private removedNodes: Node[] = []

  constructor(private readonly nodeId: NodeId) {}

  do(doc: SceneDocument): void {
    const before = { ...doc.nodes }
    this.removedWalls = wallsAtNode(doc, this.nodeId)
    for (const wall of this.removedWalls) removeWall(doc, wall.id)
    this.removedNodes = Object.keys(before)
      .filter((id) => !(id in doc.nodes))
      .map((id) => before[id] as Node)
  }

  undo(doc: SceneDocument): void {
    for (const node of this.removedNodes) doc.nodes[node.id] = node
    doc.walls.push(...this.removedWalls)
  }
}

/**
 * Deletes a room by removing the contour walls it doesn't share with a
 * neighbouring room (shared walls stay — the neighbour owns them too);
 * endpoints left wall-less are GC'd. Undo restores the walls and nodes; redo
 * recomputes them, which lands on the same set because detection is
 * deterministic over the restored graph.
 */
export class RemoveRoomCommand implements Command {
  readonly label = 'Delete room'
  private removedWalls: Wall[] = []
  private removedNodes: Node[] = []

  constructor(private readonly roomId: string) {}

  do(doc: SceneDocument): void {
    const before = { ...doc.nodes }
    this.removedWalls = roomExclusiveWalls(doc, this.roomId)
    for (const wall of this.removedWalls) removeWall(doc, wall.id)
    this.removedNodes = Object.keys(before)
      .filter((id) => !(id in doc.nodes))
      .map((id) => before[id] as Node)
  }

  undo(doc: SceneDocument): void {
    for (const node of this.removedNodes) doc.nodes[node.id] = node
    doc.walls.push(...this.removedWalls)
  }
}

/**
 * Welds a dragged vertex into a stationary target: walls at the source are
 * rewired to the target, walls that become duplicates are dropped, the source
 * vertex disappears. The two vertices must not share a wall — it would
 * collapse to zero length (the select tool guards against that).
 */
export class MergeNodesCommand implements Command {
  readonly label = 'Merge vertices'
  private sourceNode?: Node
  private report: MergeReport = { rewired: [], removedWalls: [] }

  constructor(
    private readonly sourceId: NodeId,
    private readonly targetId: NodeId,
  ) {}

  do(doc: SceneDocument): void {
    const source = doc.nodes[this.sourceId]
    if (!source || !doc.nodes[this.targetId]) return
    this.sourceNode = source
    this.report = mergeNodes(doc, this.sourceId, this.targetId)
  }

  undo(doc: SceneDocument): void {
    if (!this.sourceNode) return
    doc.nodes[this.sourceNode.id] = this.sourceNode
    // dropped duplicates return first so the rewiring below reaches them too
    doc.walls.push(...this.report.removedWalls)
    for (const { wallId, end } of this.report.rewired) {
      const wall = findWall(doc, wallId)
      if (wall) wall[end] = this.sourceId
    }
  }
}

/** Moves a wall-graph vertex; connected walls follow automatically. */
export class MoveNodeCommand implements Command {
  readonly label = 'Move vertex'

  constructor(
    private readonly nodeId: NodeId,
    private readonly from: Vec2,
    private readonly to: Vec2,
  ) {}

  do(doc: SceneDocument): void {
    moveNode(doc, this.nodeId, this.to)
  }

  undo(doc: SceneDocument): void {
    moveNode(doc, this.nodeId, this.from)
  }
}

/** One vertex relocation, used to batch several into a single history entry. */
export interface NodeMove {
  nodeId: NodeId
  from: Vec2
  to: Vec2
}

/**
 * Moves a set of vertices as one history entry — a wall body ('Move wall') or
 * a whole room contour ('Move room'); shared corners follow either way.
 */
export class MoveNodesCommand implements Command {
  constructor(
    private readonly moves: NodeMove[],
    readonly label: string,
  ) {}

  do(doc: SceneDocument): void {
    for (const move of this.moves) moveNode(doc, move.nodeId, move.to)
  }

  undo(doc: SceneDocument): void {
    for (const move of this.moves) moveNode(doc, move.nodeId, move.from)
  }
}

/** Adds a furniture item. */
export class AddItemCommand implements Command {
  readonly label = 'Add item'

  constructor(private readonly item: Item) {}

  do(doc: SceneDocument): void {
    addItem(doc, this.item)
  }

  undo(doc: SceneDocument): void {
    removeItem(doc, this.item.id)
  }
}

/** Deletes a furniture item, restoring it on undo. */
export class RemoveItemCommand implements Command {
  readonly label = 'Delete item'
  private item?: Item

  constructor(private readonly itemId: string) {}

  do(doc: SceneDocument): void {
    this.item = doc.items.find((item) => item.id === this.itemId) ?? this.item
    removeItem(doc, this.itemId)
  }

  undo(doc: SceneDocument): void {
    if (this.item) doc.items.push(this.item)
  }
}

/** Moves a furniture item from one position to another. */
export class MoveItemCommand implements Command {
  readonly label = 'Move item'

  constructor(
    private readonly itemId: string,
    private readonly from: Vec2,
    private readonly to: Vec2,
  ) {}

  do(doc: SceneDocument): void {
    moveItem(doc, this.itemId, this.to)
  }

  undo(doc: SceneDocument): void {
    moveItem(doc, this.itemId, this.from)
  }
}

/**
 * Adds a door or window to a wall. The opening arrives fully formed (id included)
 * from the tool, so redo re-adds the very same one — the AddItemCommand idiom.
 */
export class AddOpeningCommand implements Command {
  readonly label = 'Add opening'

  constructor(
    private readonly wallId: string,
    private readonly opening: Opening,
  ) {}

  do(doc: SceneDocument): void {
    findWall(doc, this.wallId)?.openings.push(this.opening)
  }

  undo(doc: SceneDocument): void {
    const wall = findWall(doc, this.wallId)
    if (!wall) return
    wall.openings = wall.openings.filter((opening) => opening.id !== this.opening.id)
  }
}

/** Deletes a door or window, putting it back where it was on undo. */
export class RemoveOpeningCommand implements Command {
  readonly label = 'Delete opening'
  private removed?: { wallId: string; index: number; opening: Opening }

  constructor(private readonly openingId: string) {}

  do(doc: SceneDocument): void {
    const found = findOpening(doc, this.openingId)
    if (!found) return
    this.removed = { wallId: found.wall.id, index: found.index, opening: found.opening }
    found.wall.openings.splice(found.index, 1)
  }

  undo(doc: SceneDocument): void {
    if (!this.removed) return
    const wall = findWall(doc, this.removed.wallId)
    // back at its old index, so the wall's openings come out exactly as they were
    wall?.openings.splice(this.removed.index, 0, this.removed.opening)
  }
}

/** The editable scalars of an opening; `kind` is not among them (see below). */
export interface OpeningProps {
  offset?: number
  width?: number
  height?: number
  sill?: number
}

/**
 * Edits an opening's dimensions or its position along the wall as one history
 * entry — a partial patch, so the inspector and a drag both commit through it.
 *
 * `kind` is deliberately not patchable: turning a window into a door is a delete
 * plus an add, and pretending otherwise would only add a branch nobody asked for.
 */
export class SetOpeningPropsCommand implements Command {
  readonly label = 'Edit opening'
  private before: OpeningProps = {}

  constructor(
    private readonly openingId: string,
    private readonly props: OpeningProps,
  ) {}

  do(doc: SceneDocument): void {
    const found = findOpening(doc, this.openingId)
    if (!found) return
    const { opening } = found
    // re-captured on every do, so redo after an undo still restores the right values
    this.before = {
      offset: opening.offset,
      width: opening.width,
      height: opening.height,
      sill: opening.sill,
    }
    Object.assign(opening, this.props)
  }

  undo(doc: SceneDocument): void {
    const found = findOpening(doc, this.openingId)
    if (found) Object.assign(found.opening, this.before)
  }
}
