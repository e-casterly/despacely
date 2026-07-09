import { distToSegment } from '../domain/geometry'
import { wallSegment } from '../domain/operations'
import type { SceneDocument, Vec2, Wall } from '../domain/types'
import type { PointerInput, Tool, ToolContext } from './types'

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

/** Default mode: click a wall to select it, click empty space to clear. */
export function createSelectTool(): Tool {
  return {
    id: 'select',
    preview: null,

    onPointerDown(input: PointerInput, ctx: ToolContext) {
      const wall = pickWall(ctx.doc, input.world, ctx.snapDist)
      ctx.select(wall ? { kind: 'wall', id: wall.id } : null)
    },
  }
}
