import { AddWallCommand } from '../domain/commands'
import { resolveSnap, type Guide } from '../domain/snapping'
import type { Vec2 } from '../domain/types'
import type { PointerInput, Tool, ToolContext, ToolOverlay } from './types'

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y
}

/** Parses a typed length buffer to a positive number of cm, or null. */
function parseLength(typed: string | null): number | null {
  if (typed === null) return null
  const n = Number(typed.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Chained wall drawing: each click drops a point; the segment from the previous
 * point is committed as its own command, and the point becomes the next start.
 * A ghost segment follows the cursor. Esc / switching tools ends the chain.
 *
 * Each point is resolved through {@link resolveSnap}: it snaps to existing
 * vertices, to alignment guides off other vertices, to the body of a wall, and
 * softly to 45° axes off the previous point — no fixed grid. The guides that
 * shaped the point are surfaced in the preview so the canvas can draw them.
 *
 * Typing digits while a segment is in progress locks its length: the snapped
 * cursor gives the direction, the typed number gives the distance from the last
 * point. Enter commits at that length, Backspace edits it, the first Esc clears
 * it (a second Esc then ends the chain).
 */
export function createWallTool(): Tool {
  let start: Vec2 | null = null
  let cursor: Vec2 | null = null
  let guides: Guide[] = []
  // the length being typed (cm), or null when not entering one
  let typed: string | null = null

  /** The segment endpoint: the typed length along the cursor direction, else the cursor. */
  function endpoint(): Vec2 | null {
    if (!start || !cursor) return null
    const len = parseLength(typed)
    if (len === null) return cursor
    const dx = cursor.x - start.x
    const dy = cursor.y - start.y
    const d = Math.hypot(dx, dy)
    if (d === 0) return cursor // no direction yet
    return { x: start.x + (dx / d) * len, y: start.y + (dy / d) * len }
  }

  /** Commits the current segment (if any) and advances the chain to its end. */
  function commit(ctx: ToolContext) {
    const target = endpoint()
    if (start && target && !samePoint(start, target)) {
      ctx.apply(new AddWallCommand(start, target, { snapDist: ctx.snapDist }))
    }
    if (target) {
      start = target
      cursor = target
    }
    typed = null
    guides = []
  }

  return {
    id: 'wall',

    get preview(): ToolOverlay | null {
      if (!start) return null
      const b = endpoint()
      if (!b || samePoint(start, b)) return null
      return { ghostWall: { a: start, b }, guides }
    },

    get textEntry() {
      return typed === null ? null : { value: typed }
    },

    onPointerDown(input: PointerInput, ctx: ToolContext) {
      const { point } = resolveSnap(ctx.doc, input.world, {
        anchor: start,
        tol: ctx.snapDist,
        snapToEdges: true,
      })
      cursor = point
      if (!start) {
        start = point // first click just drops the anchor
        return
      }
      commit(ctx)
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

    onKey(key: string, ctx: ToolContext): boolean {
      if (!start) return false // length entry only makes sense mid-chain
      if (/^[0-9]$/.test(key)) {
        typed = (typed ?? '') + key
        return true
      }
      if (key === '.' || key === ',') {
        if (typed === null) typed = '0.'
        else if (!typed.includes('.')) typed += '.'
        return true
      }
      if (key === 'Backspace') {
        if (typed === null) return false
        typed = typed.length <= 1 ? null : typed.slice(0, -1)
        return true
      }
      if (key === 'Enter') {
        if (typed === null) return false
        commit(ctx)
        return true
      }
      if (key === 'Escape') {
        if (typed === null) return false // let a bare Esc end the chain
        typed = null // first Esc just clears the number
        return true
      }
      return false
    },

    cancel() {
      start = null
      cursor = null
      guides = []
      typed = null
    },
  }
}
