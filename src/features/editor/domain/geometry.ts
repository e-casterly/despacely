import type { Vec2 } from './types'

/** Distance from a point to a line segment; used for wall hit-testing. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lengthSq = abx * abx + aby * aby
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq))
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby))
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
