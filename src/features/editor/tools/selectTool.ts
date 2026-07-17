import {
  MergeNodesCommand,
  MoveNodeCommand,
  MoveNodesCommand,
  SetOpeningPropsCommand,
  type OpeningProps,
} from '../domain/commands'
import { projectOnSegment } from '../domain/geometry'
import { offsetRange, openingAtPoint, overlapsAnotherOpening, sideOfWall } from '../domain/openings'
import {
  collapsesAnEdge,
  dividerUnderPoint,
  findWall,
  nodeAt,
  nodesConnected,
  wallSegment,
  wallsAtNode,
  wallUnderPoint,
} from '../domain/operations'
import { roomAt, roomKey } from '../domain/rooms'
import { resolveSnap, type Guide } from '../domain/snapping'
import type { NodeId, SceneDocument, SwingSide, Vec2, Wall } from '../domain/types'
import { computeWallGeometry } from '../domain/wallJoints'
import type { PointerInput, Tool, ToolContext, ToolOverlay } from './types'

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y
}

interface DragEnd {
  nodeId: NodeId
  from: Vec2
}

/** One end of a divider being dragged: it slides along `line` (its host wall's
 *  axis), or is pinned (`line === null`) when the end isn't a clean 2-wall split. */
interface DividerEnd {
  nodeId: NodeId
  from: Vec2
  line: { a: Vec2; b: Vec2 } | null
}

type Drag =
  | { kind: 'node'; nodeId: NodeId; grab: Vec2; from: Vec2; to: Vec2; mergeInto: NodeId | null; guides: Guide[] }
  // a wall body and a room contour drag the same way: one delta over a node set
  | { kind: 'wall' | 'room'; grab: Vec2; ends: DragEnd[]; delta: Vec2; guides: Guide[] }
  // a divider translates by sliding each end along its host wall — moving the
  // split point keeps the two collinear halves straight, so the wall never kinks
  | {
      kind: 'divider'
      dividerId: string
      grab: Vec2
      ends: DividerEnd[]
      moved: Record<NodeId, Vec2>
      guides: Guide[]
    }
  // an opening only ever slides along its own wall, so the whole drag is one
  // number: its offset from node A. The wall itself holds still throughout, so
  // its centerline and the offsets it will accept are settled once, at the grab.
  | {
      kind: 'opening'
      openingId: string
      wallId: string
      grab: Vec2
      a: Vec2
      b: Vec2
      /** where along the wall the pointer grabbed it — so it doesn't jump to centre */
      grabOffset: number
      range: { min: number; max: number }
      from: number
      to: number
      /** a door's swing side follows the pointer's face of the wall, like placement
       *  does; `fromSide` is where it started, so a commit fires when either changes */
      fromSide: SwingSide | undefined
      side: SwingSide | undefined
    }

/** How far along the wall's centerline (cm from node A) a point sits. */
function offsetAlong(point: Vec2, a: Vec2, b: Vec2): number {
  return projectOnSegment(point, a, b).t * Math.hypot(b.x - a.x, b.y - a.y)
}

/** A drag that moves vertices around — everything except sliding an opening. */
type NodeDrag = Exclude<Drag, { kind: 'opening' }>

/** The dragged nodes at their preview positions (empty when nothing moved yet). */
function draggedNodes(drag: NodeDrag): Record<NodeId, Vec2> {
  if (drag.kind === 'node') {
    return samePoint(drag.from, drag.to) ? {} : { [drag.nodeId]: drag.to }
  }
  if (drag.kind === 'divider') return drag.moved
  if (drag.delta.x === 0 && drag.delta.y === 0) return {}
  return Object.fromEntries(
    drag.ends.map((end) => [
      end.nodeId,
      { x: end.from.x + drag.delta.x, y: end.from.y + drag.delta.y },
    ]),
  )
}

/**
 * The segment a divider endpoint may slide along without kinking its host wall:
 * the two collinear wall-halves meeting at the node span it corner to corner, so
 * sliding the split point along that line keeps them straight. Null when the node
 * isn't a clean two-collinear-wall split (a room corner, a 3+ junction, or a
 * divider-only end) — such an end stays pinned.
 */
function dividerSlideLine(doc: SceneDocument, nodeId: NodeId): { a: Vec2; b: Vec2 } | null {
  const walls = wallsAtNode(doc, nodeId)
  if (walls.length !== 2) return null
  const here = doc.nodes[nodeId]!.pos
  const far = (wall: Wall): Vec2 => doc.nodes[wall.a === nodeId ? wall.b : wall.a]!.pos
  const a = far(walls[0]!)
  const b = far(walls[1]!)
  // collinear when the two halves leave the node in opposite directions
  const l1 = Math.hypot(a.x - here.x, a.y - here.y)
  const l2 = Math.hypot(b.x - here.x, b.y - here.y)
  if (l1 === 0 || l2 === 0) return null
  const dot = ((a.x - here.x) * (b.x - here.x) + (a.y - here.y) * (b.y - here.y)) / (l1 * l2)
  return dot < -0.999 ? { a, b } : null
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
      if (drag.kind === 'opening') {
        const changed = drag.to !== drag.from || drag.side !== drag.fromSide
        return changed
          ? { movedOpening: { id: drag.openingId, offset: drag.to, side: drag.side } }
          : null
      }
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
      // An opening lives inside a wall's body, so it has to be offered the point
      // before the wall is — otherwise the wall pick would always swallow it.
      const hit = openingAtPoint(ctx.doc, input.world)
      if (hit) {
        ctx.select({ kind: 'opening', id: hit.opening.id })
        const faces = computeWallGeometry(ctx.doc).faces.get(hit.wall.id)
        const { a, b } = wallSegment(ctx.doc, hit.wall)
        const range = faces ? offsetRange(faces, a, b, hit.opening.width) : null
        // no room to slide it (the wall barely holds it): selecting is all we do
        if (!range) return
        drag = {
          kind: 'opening',
          openingId: hit.opening.id,
          wallId: hit.wall.id,
          grab: input.world,
          a,
          b,
          grabOffset: offsetAlong(input.world, a, b),
          range,
          from: hit.opening.offset,
          to: hit.opening.offset,
          fromSide: hit.opening.side,
          side: hit.opening.side,
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
      // a zoning divider crossing the room interior: select it, and set up a drag
      // that slides each end along its host wall (see the 'divider' Drag variant)
      const divider = dividerUnderPoint(ctx.doc, input.world, ctx.snapDist)
      if (divider) {
        ctx.select({ kind: 'divider', id: divider.id })
        drag = {
          kind: 'divider',
          dividerId: divider.id,
          grab: input.world,
          ends: [divider.a, divider.b].map((nodeId) => ({
            nodeId,
            from: { ...ctx.doc.nodes[nodeId]!.pos },
            line: dividerSlideLine(ctx.doc, nodeId),
          })),
          moved: {},
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
          drag.guides = []
        } else if (drag.kind === 'opening') {
          drag.to = drag.from
          drag.side = drag.fromSide
        } else if (drag.kind === 'divider') {
          drag.moved = {}
        } else {
          drag.delta = { x: 0, y: 0 }
          drag.guides = []
        }
        return
      }
      if (drag.kind === 'divider') {
        const delta = { x: input.world.x - drag.grab.x, y: input.world.y - drag.grab.y }
        const moved: Record<NodeId, Vec2> = {}
        for (const end of drag.ends) {
          if (!end.line) continue // a pinned end stays put; the divider pivots on it
          // slide along the host wall by the drag's component along that line
          const t = projectOnSegment(
            { x: end.from.x + delta.x, y: end.from.y + delta.y },
            end.line.a,
            end.line.b,
          ).t
          const pos = {
            x: end.line.a.x + (end.line.b.x - end.line.a.x) * t,
            y: end.line.a.y + (end.line.b.y - end.line.a.y) * t,
          }
          if (!samePoint(pos, end.from)) moved[end.nodeId] = pos
        }
        // hold at the last good slide if a wall half (or the divider) would collapse
        if (!collapsesAnEdge(ctx.doc, moved)) drag.moved = moved
        return
      }
      if (drag.kind === 'opening') {
        const sliding = drag
        // slide along the wall by however far the pointer travelled along it,
        // keeping the grip: the opening does not jump its centre to the cursor
        const travelled = offsetAlong(input.world, sliding.a, sliding.b) - sliding.grabOffset
        const next = Math.min(
          Math.max(sliding.from + travelled, sliding.range.min),
          sliding.range.max,
        )
        const wall = findWall(ctx.doc, sliding.wallId)
        if (!wall) return
        const moved = wall.openings.find((opening) => opening.id === sliding.openingId)
        if (!moved) return
        // a neighbouring opening blocks the way: hold at the last good offset
        // rather than sliding through it (the collapsesAnEdge refusal idiom)
        if (!overlapsAnotherOpening(wall, { ...moved, offset: next })) drag.to = next
        // a door also re-picks its swing side from the pointer's face of the wall,
        // so a perpendicular drag flips it even when it slides nowhere; windows are
        // symmetric, so theirs is left as-is
        drag.side = moved.kind === 'door' ? sideOfWall(input.world, sliding.a, sliding.b) : moved.side
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
          !collapsesAnEdge(ctx.doc, { [drag.nodeId]: target.pos })
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
        if (!collapsesAnEdge(ctx.doc, { [drag.nodeId]: point })) {
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
      if (!collapsesAnEdge(ctx.doc, draggedNodes({ ...drag, delta }))) {
        drag.delta = delta
        drag.guides = guides
      } else {
        drag.guides = []
      }
    },

    onPointerUp(_input: PointerInput, ctx: ToolContext) {
      if (!drag) return
      if (drag.kind === 'opening') {
        const props: OpeningProps = {}
        if (drag.to !== drag.from) props.offset = drag.to
        if (drag.side !== drag.fromSide && drag.side !== undefined) props.side = drag.side
        if (Object.keys(props).length > 0) {
          ctx.apply(new SetOpeningPropsCommand(drag.openingId, props))
        }
        drag = null
        return
      }
      if (drag.kind === 'divider') {
        const sliding = drag
        const moves = sliding.ends
          .filter((end) => sliding.moved[end.nodeId])
          .map((end) => ({ nodeId: end.nodeId, from: end.from, to: sliding.moved[end.nodeId]! }))
        if (moves.length > 0) ctx.apply(new MoveNodesCommand(moves, 'Move divider'))
        drag = null
        return
      }
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
