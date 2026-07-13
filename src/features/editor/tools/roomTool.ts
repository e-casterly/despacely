import { AddRoomCommand } from '../domain/commands'
import { resolveSnap, type Guide } from '../domain/snapping'
import type { Vec2 } from '../domain/types'
import type { PointerInput, Tool, ToolContext, ToolOverlay } from './types'

/** The four corners, in order, of the axis-aligned rectangle across two opposite corners. */
function rectCorners(a: Vec2, c: Vec2): Vec2[] {
  return [a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }]
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y
}

/**
 * Rectangle room drawing: press at one corner, drag to the opposite corner,
 * release. Both corners resolve through {@link resolveSnap} — snapping to
 * existing vertices and to alignment guides off other vertices, but with no 45°
 * axis ray (the far corner of a box isn't a direction off the first). The four
 * edges commit as a single {@link AddRoomCommand}, which detectRooms then reads
 * as a room, so the whole room draws and undoes in one step.
 *
 * A gesture that stays within the snap radius on either side is a stray click,
 * not a room: it previews nothing and commits nothing.
 */
export function createRoomTool(): Tool {
  let start: Vec2 | null = null
  let corner: Vec2 | null = null
  let guides: Guide[] = []
  // captured from the pointer context so the preview getter can gate on it
  let snapDist = 0

  /** Both sides must clear the snap radius for the rectangle to count as a room. */
  function bigEnough(): boolean {
    if (!start || !corner) return false
    return Math.abs(corner.x - start.x) > snapDist && Math.abs(corner.y - start.y) > snapDist
  }

  return {
    id: 'room',

    get preview(): ToolOverlay | null {
      if (!start || !corner || samePoint(start, corner)) return null
      const corners = rectCorners(start, corner)
      // below the placement threshold the room can't commit yet: show a light
      // outline (not the full ghost) so the gesture still reads from its first
      // move — it solidifies into the ghost once it becomes placeable
      return bigEnough() ? { ghostRoom: corners, guides } : { roomDraft: corners, guides }
    },

    onPointerDown(input: PointerInput, ctx: ToolContext) {
      snapDist = ctx.snapDist
      const { point } = resolveSnap(ctx.doc, input.world, { anchor: null, tol: ctx.snapDist })
      start = point
      corner = point
      guides = []
    },

    onPointerMove(input: PointerInput, ctx: ToolContext) {
      snapDist = ctx.snapDist
      if (!start) return
      const result = resolveSnap(ctx.doc, input.world, { anchor: null, tol: ctx.snapDist })
      corner = result.point
      guides = result.guides
    },

    onPointerUp(_input: PointerInput, ctx: ToolContext) {
      if (bigEnough()) {
        ctx.apply(new AddRoomCommand(rectCorners(start!, corner!), { snapDist: ctx.snapDist }))
      }
      start = null
      corner = null
      guides = []
    },

    cancel() {
      start = null
      corner = null
      guides = []
    },
  }
}
