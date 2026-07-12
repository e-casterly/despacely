import { describe, expect, it } from 'vitest'
import { distToSegment, pointInPolygon, pointInRotatedRect } from '../geometry'

describe('distToSegment', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 100, y: 0 }

  it('is zero for a point on the segment', () => {
    expect(distToSegment({ x: 50, y: 0 }, a, b)).toBe(0)
  })

  it('measures perpendicular distance inside the segment span', () => {
    expect(distToSegment({ x: 50, y: 30 }, a, b)).toBe(30)
  })

  it('clamps to the nearest endpoint beyond the span', () => {
    expect(distToSegment({ x: -30, y: 40 }, a, b)).toBe(50)
    expect(distToSegment({ x: 130, y: 40 }, a, b)).toBe(50)
  })

  it('handles a zero-length segment as a point', () => {
    expect(distToSegment({ x: 3, y: 4 }, a, a)).toBe(5)
  })
})

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]

  it('detects points inside and outside a square', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false)
    expect(pointInPolygon({ x: -1, y: 50 }, square)).toBe(false)
  })

  it('excludes the notch of a concave (L-shaped) polygon', () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ]
    expect(pointInPolygon({ x: 50, y: 150 }, lShape)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 150 }, lShape)).toBe(false)
  })
})

describe('pointInRotatedRect', () => {
  const center = { x: 100, y: 100 }
  const size = { x: 60, y: 20 }

  it('detects points inside and outside an unrotated rect', () => {
    expect(pointInRotatedRect({ x: 120, y: 105 }, center, size, 0)).toBe(true)
    expect(pointInRotatedRect({ x: 135, y: 100 }, center, size, 0)).toBe(false)
    expect(pointInRotatedRect({ x: 100, y: 115 }, center, size, 0)).toBe(false)
  })

  it('treats the edge as inside', () => {
    expect(pointInRotatedRect({ x: 130, y: 110 }, center, size, 0)).toBe(true)
  })

  it('swaps axes at 90 degrees', () => {
    const rot = Math.PI / 2
    expect(pointInRotatedRect({ x: 100, y: 125 }, center, size, rot)).toBe(true)
    expect(pointInRotatedRect({ x: 125, y: 100 }, center, size, rot)).toBe(false)
  })

  it('follows the corner at 45 degrees', () => {
    const rot = Math.PI / 4
    expect(pointInRotatedRect({ x: 118, y: 118 }, center, size, rot)).toBe(true)
    expect(pointInRotatedRect({ x: 125, y: 100 }, center, size, rot)).toBe(false)
  })
})
