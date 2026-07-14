import { MergeNodesCommand, MoveNodeCommand, MoveNodesCommand } from '../domain/commands'
import { collapsesAWall, nodeAt, nodesConnected, wallUnderPoint } from '../domain/operations'
import { roomAt, roomKey } from '../domain/rooms'
import { resolveSnap, type Guide } from '../domain/snapping'
import type { NodeId, SceneDocument, Vec2 } from '../domain/types'
import type { PointerInput, Tool, ToolContext, ToolOverlay } from './types'

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y
}

interface DragEnd {
  nodeId: NodeId
  from: Vec2
}

type Drag =
  | { kind: 'node'; nodeId: NodeId; grab: Vec2; from: Vec2; to: Vec2; mergeInto: NodeId | null; guides: Guide[] }
  // a wall body and a room contour drag the same way: one delta over a node set
  | { kind: 'wall' | 'room'; grab: Vec2; ends: DragEnd[]; delta: Vec2; guides: Guide[] }

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
 * Snaps a rigid translation to alignment guides: each moved node tries to line
 * up (x and y independently) with a stationary vertex; the smallest nudge on
 * each axis wins, and the guides it rode are returned for the overlay.
 */
function snapTranslation(
  doc: SceneDocument,
  ends: DragEnd[],
  raw: Vec2,
  tol: number,
): { delta: Vec2; guides: Guide[] } {
  const exclude = ends.map((end) => end.nodeId)
  let bestX: { adj: number; guide: Guide } | null = null
  let bestY: { adj: number; guide: Guide } | null = null
  for (const end of ends) {
    const landed = { x: end.from.x + raw.x, y: end.from.y + raw.y }
    const { guides } = resolveSnap(doc, landed, { anchor: null, tol, exclude, snapToNodes: false })
    for (const guide of guides) {
      if (guide.kind === 'vertical') {
        const adj = guide.x - landed.x
        if (!bestX || Math.abs(adj) < Math.abs(bestX.adj)) bestX = { adj, guide }
      } else if (guide.kind === 'horizontal') {
        const adj = guide.y - landed.y
        if (!bestY || Math.abs(adj) < Math.abs(bestY.adj)) bestY = { adj, guide }
      }
    }
  }
  const delta = { x: raw.x + (bestX?.adj ?? 0), y: raw.y + (bestY?.adj ?? 0) }
  const guides: Guide[] = []
  if (bestX) guides.push(bestX.guide)
  if (bestY) guides.push(bestY.guide)
  return { delta, guides }
}

/**
 * Default mode: click a wall, a vertex dot or a room to select it, click
 * empty space to clear. Dragging moves things with the same guide snapping as
 * the wall tool — vertices and whole contours align to other vertices, no fixed
 * grid; shared corners follow in every case. A pointer must travel past the
 * pick radius before a click becomes a drag (there is no grid to round jitter
 * away). The document is only touched on pointerup, as a single undoable command.
 */
export function createSelectTool(): Tool {
  let drag: Drag | null = null

  return {
    id: 'select',

    get preview(): ToolOverlay | null {
      if (!drag) return null
      const overlay: ToolOverlay = {}
      const moved = draggedNodes(drag)
      const moving = Object.keys(moved).length > 0
      if (moving) overlay.movedNodes = moved
      if (drag.kind === 'node' && drag.mergeInto) overlay.mergeTarget = drag.mergeInto
      if (moving && drag.guides.length > 0) overlay.guides = drag.guides
      return Object.keys(overlay).length > 0 ? overlay : null
    },

    onPointerDown(input: PointerInput, ctx: ToolContext) {
      // Vertex dots sit on top of walls, so they win the pick
      const node = nodeAt(ctx.doc, input.world, ctx.snapDist)
      if (node) {
        ctx.select({ kind: 'node', id: node.id })
        drag = {
          kind: 'node',
          nodeId: node.id,
          grab: input.world,
          from: node.pos,
          to: node.pos,
          mergeInto: null,
          guides: [],
        }
        return
      }
      const wall = wallUnderPoint(ctx.doc, input.world, ctx.snapDist)
      if (wall) {
        ctx.select({ kind: 'wall', id: wall.id })
        drag = {
          kind: 'wall',
          grab: input.world,
          ends: [wall.a, wall.b].map((id) => ({ nodeId: id, from: ctx.doc.nodes[id]!.pos })),
          delta: { x: 0, y: 0 },
          guides: [],
        }
        return
      }
      // nothing solid under the pointer: the room the click landed in, if any.
      // Dragging moves the whole contour; nested loops and spur walls keep
      // their own nodes and follow only where they share a contour vertex.
      const room = roomAt(ctx.doc, input.world)
      ctx.select(room ? { kind: 'room', id: roomKey(room) } : null)
      if (room) {
        drag = {
          kind: 'room',
          grab: input.world,
          ends: room.nodeIds.map((id) => ({ nodeId: id, from: ctx.doc.nodes[id]!.pos })),
          delta: { x: 0, y: 0 },
          guides: [],
        }
      }
    },

    onPointerMove(input: PointerInput, ctx: ToolContext) {
      if (!drag) return
      // a click needs a dead zone before it becomes a drag — without a grid to
      // round into, sub-pixel jitter would otherwise nudge the target
      if (Math.hypot(input.world.x - drag.grab.x, input.world.y - drag.grab.y) < ctx.snapDist) {
        if (drag.kind === 'node') {
          drag.to = drag.from
          drag.mergeInto = null
        } else {
          drag.delta = { x: 0, y: 0 }
        }
        drag.guides = []
        return
      }
      if (drag.kind === 'node') {
        // a foreign vertex in reach beats snapping: dropping there welds the two.
        // Direct neighbours are skipped (merging collapses the shared wall), and
        // the collapse check covers a neighbour coinciding with the target.
        const target = nodeAt(ctx.doc, input.world, ctx.snapDist, drag.nodeId)
        if (
          target &&
          !nodesConnected(ctx.doc, drag.nodeId, target.id) &&
          !collapsesAWall(ctx.doc, { [drag.nodeId]: target.pos })
        ) {
          drag.to = target.pos
          drag.mergeInto = target.id
          drag.guides = []
          return
        }
        drag.mergeInto = null
        // snap to guides off other vertices; a vertex landing on a vertex is the
        // merge case above, so node-coincidence snapping stays off here
        const { point, guides } = resolveSnap(ctx.doc, input.world, {
          anchor: null,
          tol: ctx.snapDist,
          exclude: [drag.nodeId],
          snapToNodes: false,
        })
        // refuse positions that would collapse a wall to zero length
        if (!collapsesAWall(ctx.doc, { [drag.nodeId]: point })) {
          drag.to = point
          drag.guides = guides
        } else {
          drag.guides = []
        }
        return
      }
      const raw = { x: input.world.x - drag.grab.x, y: input.world.y - drag.grab.y }
      const { delta, guides } = snapTranslation(ctx.doc, drag.ends, raw, ctx.snapDist)
      // a neighbour sharing a corner may collapse when the wall lands on it
      if (!collapsesAWall(ctx.doc, draggedNodes({ ...drag, delta }))) {
        drag.delta = delta
        drag.guides = guides
      } else {
        drag.guides = []
      }
    },

    onPointerUp(_input: PointerInput, ctx: ToolContext) {
      if (!drag) return
      if (drag.kind === 'node') {
        if (drag.mergeInto) {
          ctx.apply(new MergeNodesCommand(drag.nodeId, drag.mergeInto))
          // the dragged vertex is gone; keep the selection on the survivor
          ctx.select({ kind: 'node', id: drag.mergeInto })
        } else if (!samePoint(drag.from, drag.to)) {
          ctx.apply(new MoveNodeCommand(drag.nodeId, drag.from, drag.to))
        }
      } else if (drag.delta.x !== 0 || drag.delta.y !== 0) {
        const moved = draggedNodes(drag)
        ctx.apply(
          new MoveNodesCommand(
            drag.ends.map((end) => ({ nodeId: end.nodeId, from: end.from, to: moved[end.nodeId]! })),
            drag.kind === 'room' ? 'Move room' : 'Move wall',
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
