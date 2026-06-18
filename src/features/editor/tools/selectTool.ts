import { distToSegment } from '../domain/geometry'
import { wallSegment } from '../domain/operations'
import type { SceneDocument, Vec2, Wall } from '../domain/types'
import type { PointerInput, Tool, ToolContext } from './types'

/** Nearest wall whose body is under the point, within a pick tolerance (cm). */
function pickWall(doc: SceneDocument, point: Vec2, slop: number): Wall | undefined {
  let best: Wall | undefined
  let bestDist = Infinity
  for (const wall of doc.walls) {
    const { a, b } = wallSegment(doc, wall)
    const dist = distToSegment(point, a, b)
    if (dist <= wall.thickness / 2 + slop && dist < bestDist) {
      best = wall
      bestDist = dist
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
