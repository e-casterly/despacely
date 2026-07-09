import { MoveNodeCommand, MoveWallCommand } from '../domain/commands'
import { distToSegment } from '../domain/geometry'
import { nodeAt, wallSegment } from '../domain/operations'
import { snap } from '../domain/units'
import type { NodeId, SceneDocument, Vec2, Wall } from '../domain/types'
import type { PointerInput, Tool, ToolContext, ToolOverlay } from './types'
import { WALL_SNAP } from './wallTool'

/** The wall the point sits deepest inside, within a pick tolerance (cm). */
function pickWall(doc: SceneDocument, point: Vec2, slop: number): Wall | undefined {
  let best: Wall | undefined
  let bestDepth = Infinity
  for (const wall of doc.walls) {
    const { a, b } = wallSegment(doc, wall)
    // Depth relative to the wall's surface (negative inside the body). Ranking
    // by depth, not by raw distance to the axis, so that next to a seam a thick
    // wall's body beats a thin neighbour whose axis happens to be closer.
    const depth = distToSegment(point, a, b) - wall.thickness / 2
    if (depth <= slop && depth < bestDepth) {
      best = wall
      bestDepth = depth
    }
  }
  return best
}

function snapPoint(p: Vec2): Vec2 {
  return { x: snap(p.x, WALL_SNAP), y: snap(p.y, WALL_SNAP) }
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y
}

/** True if rendering nodes at the moved positions would give some wall zero length. */
function collapsesAWall(doc: SceneDocument, moved: Record<NodeId, Vec2>): boolean {
  return doc.walls.some((wall) => {
    const a = moved[wall.a] ?? doc.nodes[wall.a]!.pos
    const b = moved[wall.b] ?? doc.nodes[wall.b]!.pos
    return samePoint(a, b)
  })
}

type Drag =
  | { kind: 'node'; nodeId: NodeId; from: Vec2; to: Vec2 }
  | { kind: 'wall'; grab: Vec2; ends: { nodeId: NodeId; from: Vec2 }[]; delta: Vec2 }

/** The dragged nodes at their preview positions (empty when nothing moved yet). */
function draggedNodes(drag: Drag): Record<NodeId, Vec2> {
  if (drag.kind === 'node') {
    return samePoint(drag.from, drag.to) ? {} : { [drag.nodeId]: drag.to }
  }
  if (drag.delta.x === 0 && drag.delta.y === 0) return {}
  return Object.fromEntries(
    drag.ends.map((end) => [
      end.nodeId,
      { x: end.from.x + drag.delta.x, y: end.from.y + drag.delta.y },
    ]),
  )
}

/**
 * Default mode: click a wall to select it, click empty space to clear.
 * Dragging moves things (grid-snapped): a vertex dot moves that vertex, a wall
 * body moves the whole wall; shared corners follow either way. The document is
 * only touched on pointerup, as a single undoable command.
 */
export function createSelectTool(): Tool {
  let drag: Drag | null = null

  return {
    id: 'select',

    get preview(): ToolOverlay | null {
      if (!drag) return null
      const moved = draggedNodes(drag)
      return Object.keys(moved).length > 0 ? { movedNodes: moved } : null
    },

    onPointerDown(input: PointerInput, ctx: ToolContext) {
      // Vertex dots sit on top of walls, so they win the pick; grabbing one
      // does not change the selection (a node may be shared by many walls).
      const node = nodeAt(ctx.doc, input.world, ctx.snapDist)
      if (node) {
        drag = { kind: 'node', nodeId: node.id, from: node.pos, to: node.pos }
        return
      }
      const wall = pickWall(ctx.doc, input.world, ctx.snapDist)
      ctx.select(wall ? { kind: 'wall', id: wall.id } : null)
      if (wall) {
        drag = {
          kind: 'wall',
          grab: input.world,
          ends: [wall.a, wall.b].map((id) => ({ nodeId: id, from: ctx.doc.nodes[id]!.pos })),
          delta: { x: 0, y: 0 },
        }
      }
    },

    onPointerMove(input: PointerInput, ctx: ToolContext) {
      if (!drag) return
      if (drag.kind === 'node') {
        const to = snapPoint(input.world)
        // refuse positions that would collapse a wall to zero length
        if (!collapsesAWall(ctx.doc, { [drag.nodeId]: to })) drag.to = to
        return
      }
      const delta = {
        x: snap(input.world.x - drag.grab.x, WALL_SNAP),
        y: snap(input.world.y - drag.grab.y, WALL_SNAP),
      }
      const next: Drag = { ...drag, delta }
      // a neighbour sharing a corner may collapse when the wall lands on it
      if (!collapsesAWall(ctx.doc, draggedNodes(next))) drag.delta = delta
    },

    onPointerUp(_input: PointerInput, ctx: ToolContext) {
      if (!drag) return
      if (drag.kind === 'node') {
        if (!samePoint(drag.from, drag.to)) {
          ctx.apply(new MoveNodeCommand(drag.nodeId, drag.from, drag.to))
        }
      } else if (drag.delta.x !== 0 || drag.delta.y !== 0) {
        const moved = draggedNodes(drag)
        ctx.apply(
          new MoveWallCommand(
            drag.ends.map((end) => ({ nodeId: end.nodeId, from: end.from, to: moved[end.nodeId]! })),
          ),
        )
      }
      drag = null
    },

    cancel() {
      drag = null
    },
  }
}
