import { AddWallCommand } from '../domain/commands'
import { resolveSnap, type Guide } from '../domain/snapping'
import type { Vec2 } from '../domain/types'
import type { PointerInput, Tool, ToolContext, ToolOverlay } from './types'

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y
}

/**
 * Chained wall drawing: each click drops a point; the segment from the previous
 * point is committed as its own command, and the point becomes the next start.
 * A ghost segment follows the cursor. Esc / switching tools ends the chain.
 *
 * Each point is resolved through {@link resolveSnap}: it snaps to existing
 * vertices, to alignment guides off other vertices, and softly to 45° axes off
 * the previous point — no fixed grid. The guides that shaped the point are
 * surfaced in the preview so the canvas can draw them.
 */
export function createWallTool(): Tool {
  let start: Vec2 | null = null
  let cursor: Vec2 | null = null
  let guides: Guide[] = []

  return {
    id: 'wall',

    get preview(): ToolOverlay | null {
      if (!start || !cursor || samePoint(start, cursor)) return null
      return { ghostWall: { a: start, b: cursor }, guides }
    },

    onPointerDown(input: PointerInput, ctx: ToolContext) {
      const { point } = resolveSnap(ctx.doc, input.world, {
        anchor: start,
        tol: ctx.snapDist,
        snapToEdges: true,
      })
      if (start && !samePoint(start, point)) {
        ctx.apply(new AddWallCommand(start, point, { snapDist: ctx.snapDist }))
      }
      start = point
      cursor = point
      guides = []
    },

    onPointerMove(input: PointerInput, ctx: ToolContext) {
      const result = resolveSnap(ctx.doc, input.world, {
        anchor: start,
        tol: ctx.snapDist,
        snapToEdges: true,
      })
      cursor = result.point
      guides = result.guides
    },

    cancel() {
      start = null
      cursor = null
      guides = []
    },
  }
}
