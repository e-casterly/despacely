import type { Vec2 } from '../domain/types'

/**
 * The 2D camera. The only place where world centimeters meet screen pixels;
 * everything else works in one space or the other, never both.
 */
export interface Viewport {
  /** world point (cm) shown at the screen center */
  pan: Vec2
  /** px per cm */
  zoom: number
  /** canvas size in CSS px */
  width: number
  height: number
}

// floor kept high enough that the 1m grid never collapses into mush
export const MIN_ZOOM = 0.12
export const MAX_ZOOM = 10

export function createViewport(width = 0, height = 0): Viewport {
  return { pan: { x: 0, y: 0 }, zoom: 1, width, height }
}

export function worldToScreen(vp: Viewport, p: Vec2): Vec2 {
  return {
    x: (p.x - vp.pan.x) * vp.zoom + vp.width / 2,
    y: (p.y - vp.pan.y) * vp.zoom + vp.height / 2,
  }
}

export function screenToWorld(vp: Viewport, p: Vec2): Vec2 {
  return {
    x: (p.x - vp.width / 2) / vp.zoom + vp.pan.x,
    y: (p.y - vp.height / 2) / vp.zoom + vp.pan.y,
  }
}

/** Pans so the content follows a cursor dragged by delta (screen px). */
export function panBy(vp: Viewport, delta: Vec2): void {
  vp.pan = { x: vp.pan.x - delta.x / vp.zoom, y: vp.pan.y - delta.y / vp.zoom }
}

/** Centers the given world bounds and zooms so they fit with a screen-px margin. */
export function zoomToFit(vp: Viewport, bounds: { min: Vec2; max: Vec2 }, padding = 40): void {
  // a canvas smaller than the padding leaves no room; treat it as 1px and let the clamp decide
  const fit = Math.min(
    Math.max(1, vp.width - 2 * padding) / (bounds.max.x - bounds.min.x),
    Math.max(1, vp.height - 2 * padding) / (bounds.max.y - bounds.min.y),
  )
  vp.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit))
  vp.pan = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 }
}

/** Zooms by factor, keeping the world point under the given screen point fixed. */
export function zoomAt(vp: Viewport, screenPoint: Vec2, factor: number): void {
  const anchor = screenToWorld(vp, screenPoint)
  vp.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * factor))
  vp.pan = {
    x: anchor.x - (screenPoint.x - vp.width / 2) / vp.zoom,
    y: anchor.y - (screenPoint.y - vp.height / 2) / vp.zoom,
  }
}
