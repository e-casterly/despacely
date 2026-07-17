import { AddDividerCommand } from '../domain/commands'
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
 * Zoning tool: draws zero-thickness dividers that subdivide a space into
 * measured zones (прихожая/кухня/зал in one open room). It is the wall tool's
 * twin — same chained clicks, same snapping and typed-length entry — but each
 * segment commits as an {@link AddDividerCommand}, so it carves no wall, only a
 * boundary the room detector reads as a new zone.
 *
 * Each point resolves through {@link resolveSnap} with edge snapping on, so a
 * click lands on the body of a contour wall; the command then splits that wall
 * at the point (a T-junction), which is what lets the divider close a zone. A
 * segment whose ends don't both reach the contour draws fine but forms no zone —
 * the dangling divider is pruned by room detection, exactly like a spur wall.
 */
export function createSplitTool(): Tool {
  let start: Vec2 | null = null
  // whether the anchor landed on a wall/vertex — only then does it earn a node
  let startAttached = false
  let cursor: Vec2 | null = null
  // whether the live cursor is currently snapped onto a wall or vertex
  let cursorAttached = false
  let guides: Guide[] = []
  // the length being typed (cm), or null when not entering one
  let typed: string | null = null

  /** Snaps a world point, reporting whether it attached to a wall body or vertex. */
  function snap(world: Vec2, ctx: ToolContext) {
    const result = resolveSnap(ctx.doc, world, { anchor: start, tol: ctx.snapDist, snapToEdges: true })
    return {
      point: result.point,
      guides: result.guides,
      attached: result.nodeId !== undefined || result.edgeWallId !== undefined,
    }
  }

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
      ctx.apply(new AddDividerCommand(start, target, { snapDist: ctx.snapDist }))
    }
    if (target) {
      // the new anchor inherits the cursor's attachment, unless a typed length
      // pulled the endpoint off the wall the cursor was on
      startAttached = typed === null && cursorAttached
      start = target
      cursor = target
    }
    typed = null
    guides = []
  }

  return {
    id: 'split',

    get preview(): ToolOverlay | null {
      const b = endpoint()
      const drawing = !!(start && b && !samePoint(start, b))
      const previewNodes: Vec2[] = []
      // the placed anchor keeps its node; the live end gets one while the cursor
      // is snapped to a wall (a typed length decouples it, so no node then)
      if (start && startAttached) previewNodes.push(start)
      if (cursorAttached && typed === null && cursor && !(start && samePoint(start, cursor))) {
        previewNodes.push(cursor)
      }
      if (!drawing && previewNodes.length === 0) return null
      const overlay: ToolOverlay = {}
      if (drawing) overlay.ghostDivider = { a: start!, b: b! }
      if (previewNodes.length > 0) overlay.previewNodes = previewNodes
      if (drawing && guides.length > 0) overlay.guides = guides
      return overlay
    },

    get textEntry() {
      return typed === null ? null : { value: typed }
    },

    onPointerDown(input: PointerInput, ctx: ToolContext) {
      const { point, attached } = snap(input.world, ctx)
      cursor = point
      cursorAttached = attached
      if (!start) {
        start = point // first click just drops the anchor
        startAttached = attached
        return
      }
      commit(ctx)
    },

    onPointerMove(input: PointerInput, ctx: ToolContext) {
      const result = snap(input.world, ctx)
      cursor = result.point
      cursorAttached = result.attached
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
      startAttached = false
      cursor = null
      cursorAttached = false
      guides = []
      typed = null
    },
  }
}
