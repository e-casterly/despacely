import {
  addItem,
  addWallBetween,
  findWall,
  mergeNodes,
  moveItem,
  moveNode,
  removeItem,
  removeWall,
  wallsAtNode,
  type MergeReport,
  type WallOptions,
} from './operations'
import { roomExclusiveWalls } from './rooms'
import type { Item, Node, NodeId, SceneDocument, Vec2, Wall } from './types'

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

/** Adds a wall between two points, snapping endpoints to nearby nodes. */
export class AddWallCommand implements Command {
  readonly label = 'Add wall'
  private wall?: Wall
  private createdNodes: Node[] = []

  constructor(
    private readonly posA: Vec2,
    private readonly posB: Vec2,
    private readonly opts: WallOptions & { snapDist?: number } = {},
  ) {}

  do(doc: SceneDocument): void {
    if (this.wall) {
      // redo: re-insert the exact entities created the first time
      for (const node of this.createdNodes) doc.nodes[node.id] = node
      doc.walls.push(this.wall)
      return
    }
    const before = new Set(Object.keys(doc.nodes))
    const wall = addWallBetween(doc, this.posA, this.posB, this.opts)
    if (!wall) return
    this.wall = wall
    this.createdNodes = Object.values(doc.nodes).filter((node) => !before.has(node.id))
  }

  undo(doc: SceneDocument): void {
    if (!this.wall) return
    const wallId = this.wall.id
    doc.walls = doc.walls.filter((w) => w.id !== wallId)
    for (const node of this.createdNodes) delete doc.nodes[node.id]
  }
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
