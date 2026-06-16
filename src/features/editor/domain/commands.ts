import {
  addItem,
  addWallBetween,
  findWall,
  moveItem,
  moveNode,
  removeItem,
  removeWall,
  type WallOptions,
} from './operations'
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
