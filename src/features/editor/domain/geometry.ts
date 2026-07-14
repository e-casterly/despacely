import type { Vec2 } from './types'

/** Where a point lands when dropped perpendicularly onto a segment. */
export interface Projection {
  /** the nearest point on the segment itself */
  point: Vec2
  /** how far along a→b that point sits, clamped to [0, 1] */
  t: number
  distance: number
}

/**
 * Projects a point onto segment a→b, clamped to the segment's ends. `t` is what
 * callers positioning something *along* a wall need (an opening's offset, a split
 * point); `distToSegment` is the same math when only the distance matters.
 */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): Projection {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lengthSq = abx * abx + aby * aby
  if (lengthSq === 0) return { point: { ...a }, t: 0, distance: Math.hypot(p.x - a.x, p.y - a.y) }

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq))
  const point = { x: a.x + t * abx, y: a.y + t * aby }
  return { point, t, distance: Math.hypot(p.x - point.x, p.y - point.y) }
}

/** Distance from a point to a line segment; used for wall hit-testing. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return projectOnSegment(p, a, b).distance
}

/** Area-weighted centroid of a simple polygon; vertex mean when the area is zero. */
export function polygonCentroid(polygon: Vec2[]): Vec2 {
  let area2 = 0 // twice the signed area
  let cx = 0
  let cy = 0
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!
    const q = polygon[(i + 1) % polygon.length]!
    const cross = p.x * q.y - q.x * p.y
    area2 += cross
    cx += (p.x + q.x) * cross
    cy += (p.y + q.y) * cross
  }
  if (area2 === 0) {
    let sx = 0
    let sy = 0
    for (const p of polygon) {
      sx += p.x
      sy += p.y
    }
    return { x: sx / polygon.length, y: sy / polygon.length }
  }
  return { x: cx / (3 * area2), y: cy / (3 * area2) }
}

/** Whether a point lies inside a simple polygon (ray casting); used for room hit-testing. */
export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    const crosses = a.y > p.y !== b.y > p.y
    if (crosses && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside
  }
  return inside
}

/** Whether a point lies inside a rectangle rotated around its center; used for item hit-testing. */
export function pointInRotatedRect(p: Vec2, center: Vec2, size: Vec2, rotation: number): boolean {
  const dx = p.x - center.x
  const dy = p.y - center.y
  const cos = Math.cos(-rotation)
  const sin = Math.sin(-rotation)
  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos
  return Math.abs(localX) <= size.x / 2 && Math.abs(localY) <= size.y / 2
}
