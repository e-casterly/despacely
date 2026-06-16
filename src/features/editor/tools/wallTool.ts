import { AddWallCommand } from '../domain/commands'
import { snap } from '../domain/units'
import type { Vec2 } from '../domain/types'
import type { PointerInput, Tool, ToolContext, ToolOverlay } from './types'

/** Grid step (cm) wall points snap to while drawing. */
export const WALL_SNAP = 10

function snapPoint(p: Vec2): Vec2 {
  return { x: snap(p.x, WALL_SNAP), y: snap(p.y, WALL_SNAP) }
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y
}

/**
 * Chained wall drawing: each click drops a point; the segment from the previous
 * point is committed as its own command, and the point becomes the next start.
 * A ghost segment follows the cursor. Esc / switching tools ends the chain.
 */
export function createWallTool(): Tool {
  let start: Vec2 | null = null
  let cursor: Vec2 | null = null

  return {
    id: 'wall',

    get preview(): ToolOverlay | null {
      if (!start || !cursor || samePoint(start, cursor)) return null
      return { ghostWall: { a: start, b: cursor } }
    },

    onPointerDown(input: PointerInput, ctx: ToolContext) {
      const point = snapPoint(input.world)
      if (start && !samePoint(start, point)) {
        ctx.apply(new AddWallCommand(start, point, { snapDist: ctx.snapDist }))
      }
      start = point
      cursor = point
    },

    onPointerMove(input: PointerInput) {
      cursor = snapPoint(input.world)
    },

    cancel() {
      start = null
      cursor = null
    },
  }
}
