import { AddOpeningCommand } from '../domain/commands'
import { projectOnSegment } from '../domain/geometry'
import { offsetRange, openingSpan, overlapsAnotherOpening } from '../domain/openings'
import type { Guide } from '../domain/snapping'
import { wallSegment, wallUnderPoint } from '../domain/operations'
import type { Opening, OpeningKind, Vec2 } from '../domain/types'
import {
  DOOR_HEIGHT,
  DOOR_WIDTH,
  WALL_THICKNESS,
  WINDOW_HEIGHT,
  WINDOW_SILL,
  WINDOW_WIDTH,
} from '../domain/units'
import { computeWallGeometry } from '../domain/wallJoints'
import type { GhostOpening, PointerInput, Tool, ToolContext, ToolOverlay } from './types'

/** What a freshly placed opening of each kind starts out as. */
const DEFAULTS: Record<OpeningKind, Pick<Opening, 'width' | 'height' | 'sill'>> = {
  door: { width: DOOR_WIDTH, height: DOOR_HEIGHT, sill: 0 },
  window: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT, sill: WINDOW_SILL },
}

/**
 * The ghost under the cursor: what to draw, plus — only when it snapped onto a
 * wall that can hold it — the wall highlight and the placement a click commits.
 */
interface Hover {
  ghost: GhostOpening
  /** the target wall highlighted, so the snap onto it reads as such; null when free */
  guide: Guide | null
  /** what a click would add; null when floating free (a click then places nothing) */
  placement: { wallId: string; opening: Opening } | null
}

/**
 * Places a door or a window. A translucent ghost tracks the cursor the moment the
 * tool is active and the pointer is on the canvas: it floats free over empty space
 * and snaps onto a wall — aligned to it, pulled along it so a spot near a corner
 * shows as close as it will go, the wall lit up — whenever the pointer is over one
 * that can hold the opening. Only a snapped ghost is placeable: a click off every
 * wall, or on a wall too short or already occupied at that spot, adds nothing and
 * pushes no history entry.
 */
export function createOpeningTool(kind: OpeningKind): Tool {
  // the ghost under the cursor right now, mirrored into the preview
  let hover: Hover | null = null

  /** The ghost snapped onto a wall the pointer is over, or null when there is none
   *  it can be placed on (off every wall, or a wall too short/occupied here). */
  function snapToWall(world: Vec2, ctx: ToolContext): Hover | null {
    const wall = wallUnderPoint(ctx.doc, world, ctx.snapDist)
    if (!wall) return null

    const faces = computeWallGeometry(ctx.doc).faces.get(wall.id)
    if (!faces) return null
    const { a, b } = wallSegment(ctx.doc, wall)

    const defaults = DEFAULTS[kind]
    const range = offsetRange(faces, a, b, defaults.width)
    if (!range) return null // the wall cannot hold an opening this wide at all

    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const clicked = projectOnSegment(world, a, b).t * length
    const opening: Opening = {
      id: crypto.randomUUID(),
      kind,
      offset: Math.min(Math.max(clicked, range.min), range.max),
      ...defaults,
    }
    if (overlapsAnotherOpening(wall, opening)) return null

    const span = openingSpan(ctx.doc, wall, opening, faces)
    if (!span) return null

    return {
      ghost: { kind, span, thickness: wall.thickness },
      guide: { kind: 'edge', a: { ...a }, b: { ...b } },
      placement: { wallId: wall.id, opening },
    }
  }

  /** The ghost floating free at the cursor, at a default size and orientation —
   *  what the user sees before steering it onto a wall. Never placeable. */
  function freeGhost(world: Vec2): Hover {
    const { width } = DEFAULTS[kind]
    const axis: Vec2 = { x: 1, y: 0 } // arbitrary; the moment it meets a wall it takes the wall's
    const half = width / 2
    return {
      ghost: {
        kind,
        thickness: WALL_THICKNESS,
        span: {
          start: 0,
          end: width,
          jambA: { x: world.x - axis.x * half, y: world.y - axis.y * half },
          jambB: { x: world.x + axis.x * half, y: world.y + axis.y * half },
          axis,
        },
      },
      guide: null,
      placement: null,
    }
  }

  return {
    id: kind,

    get preview(): ToolOverlay | null {
      if (!hover) return null
      return {
        ghostOpening: hover.ghost,
        guides: hover.guide ? [hover.guide] : [],
      }
    },

    onPointerDown(input: PointerInput, ctx: ToolContext) {
      const hit = snapToWall(input.world, ctx)
      if (!hit?.placement) return
      ctx.apply(new AddOpeningCommand(hit.placement.wallId, hit.placement.opening))
    },

    onPointerMove(input: PointerInput, ctx: ToolContext) {
      hover = snapToWall(input.world, ctx) ?? freeGhost(input.world)
    },

    onPointerLeave() {
      hover = null
    },

    cancel() {
      hover = null
    },
  }
}
