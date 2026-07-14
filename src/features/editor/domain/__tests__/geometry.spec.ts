import { describe, expect, it } from 'vitest'
import {
  clipPolygon,
  distToSegment,
  pointInPolygon,
  pointInRotatedRect,
  polygonCentroid,
  projectOnSegment,
} from '../geometry'

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

describe('polygonCentroid', () => {
  it('finds the middle of a square', () => {
    expect(
      polygonCentroid([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]),
    ).toEqual({ x: 50, y: 50 })
  })

  it('weights by area for an L-shape', () => {
    // 200x100 rect (area 20000, centre (100,50)) + 100x100 rect (10000, (50,150))
    const centroid = polygonCentroid([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ])
    expect(centroid.x).toBeCloseTo(250 / 3)
    expect(centroid.y).toBeCloseTo(250 / 3)
  })

  it('falls back to the vertex mean for a zero-area polygon', () => {
    expect(
      polygonCentroid([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
      ]),
    ).toEqual({ x: 100, y: 0 })
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

describe('projectOnSegment', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 100, y: 0 }

  it('reports where along the segment the foot of the perpendicular lands', () => {
    const { point, t, distance } = projectOnSegment({ x: 30, y: 12 }, a, b)

    expect(point).toEqual({ x: 30, y: 0 })
    expect(t).toBe(0.3)
    expect(distance).toBe(12)
  })

  it('clamps past either end, so t never leaves [0, 1]', () => {
    expect(projectOnSegment({ x: -50, y: 0 }, a, b).t).toBe(0)
    expect(projectOnSegment({ x: 500, y: 0 }, a, b).t).toBe(1)
  })

  it('collapses to the shared endpoint for a zero-length segment', () => {
    const { point, t, distance } = projectOnSegment({ x: 3, y: 4 }, a, a)

    expect(point).toEqual(a)
    expect(t).toBe(0)
    expect(distance).toBe(5)
  })
})

describe('clipPolygon', () => {
  /** A 100x100 square with its corner at the origin. */
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]
  const right = { x: 1, y: 0 } // normal pointing along +x: keeps everything left of the line

  it('keeps a polygon that lies wholly on the near side', () => {
    expect(clipPolygon(square, { x: 500, y: 0 }, right)).toEqual(square)
  })

  it('drops a polygon that lies wholly on the far side', () => {
    expect(clipPolygon(square, { x: -50, y: 0 }, right)).toEqual([])
  })

  it('cuts a polygon the line crosses, closing it off along the cut', () => {
    const clipped = clipPolygon(square, { x: 40, y: 0 }, right)

    const xs = clipped.map((p) => p.x)
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(40) // nothing past the cut survives
    expect(clipped).toHaveLength(4) // still a closed quad
  })

  it('keeps points lying exactly on the line', () => {
    // the cut runs along the square's own right edge: the whole square stays
    expect(clipPolygon(square, { x: 100, y: 0 }, right)).toEqual(square)
  })
})
