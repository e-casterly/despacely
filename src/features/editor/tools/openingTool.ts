import { AddOpeningCommand } from '../domain/commands'
import { projectOnSegment } from '../domain/geometry'
import { offsetRange, overlapsAnotherOpening } from '../domain/openings'
import { wallSegment, wallUnderPoint } from '../domain/operations'
import type { Opening, OpeningKind } from '../domain/types'
import {
  DOOR_HEIGHT,
  DOOR_WIDTH,
  WINDOW_HEIGHT,
  WINDOW_SILL,
  WINDOW_WIDTH,
} from '../domain/units'
import { computeWallGeometry } from '../domain/wallJoints'
import type { PointerInput, Tool, ToolContext } from './types'

/** What a freshly placed opening of each kind starts out as. */
const DEFAULTS: Record<OpeningKind, Pick<Opening, 'width' | 'height' | 'sill'>> = {
  door: { width: DOOR_WIDTH, height: DOOR_HEIGHT, sill: 0 },
  window: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT, sill: WINDOW_SILL },
}

/**
 * Places a door or a window: click the body of a wall and one appears there at a
 * default size, which the inspector then edits.
 *
 * The click only chooses *where along the wall* — it is projected onto the
 * centerline, then pulled into the offsets the wall can actually accept, so a
 * click near a corner places the opening as close as it will go instead of
 * refusing outright. What it will not do is force one in: a wall with no room
 * left for the opening (too short, or already occupied at that spot) simply
 * takes no opening, and no history entry is pushed.
 */
export function createOpeningTool(kind: OpeningKind): Tool {
  return {
    id: kind,
    preview: null,

    onPointerDown(input: PointerInput, ctx: ToolContext) {
      const wall = wallUnderPoint(ctx.doc, input.world, ctx.snapDist)
      if (!wall) return

      const faces = computeWallGeometry(ctx.doc).faces.get(wall.id)
      if (!faces) return
      const { a, b } = wallSegment(ctx.doc, wall)

      const defaults = DEFAULTS[kind]
      const range = offsetRange(faces, a, b, defaults.width)
      if (!range) return // the wall cannot hold an opening this wide at all

      const length = Math.hypot(b.x - a.x, b.y - a.y)
      const clicked = projectOnSegment(input.world, a, b).t * length
      const opening: Opening = {
        id: crypto.randomUUID(),
        kind,
        offset: Math.min(Math.max(clicked, range.min), range.max),
        ...defaults,
      }
      if (overlapsAnotherOpening(wall, opening)) return

      ctx.apply(new AddOpeningCommand(wall.id, opening))
    },
  }
}
