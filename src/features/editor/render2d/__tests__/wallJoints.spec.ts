import { describe, expect, it } from 'vitest'
import { computeWallGeometry } from '../wallJoints'
import type { SceneDocument, Vec2, Wall } from '../../domain/types'

/** Builds a doc from named node positions and walls referencing them. */
function makeDoc(nodes: Record<string, Vec2>, walls: Array<Omit<Wall, 'height'>>): SceneDocument {
  return {
    nodes: Object.fromEntries(Object.entries(nodes).map(([id, pos]) => [id, { id, pos }])),
    walls: walls.map((w) => ({ height: 270, ...w })),
    items: [],
  }
}

function hasPoint(poly: Vec2[], p: Vec2): boolean {
  return poly.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6)
}

/** Standard even-odd ray cast; boundary counts as inside for our purposes. */
function inside(poly: Vec2[], p: Vec2): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    const straddles = a.y > p.y !== b.y > p.y
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

describe('computeWallGeometry', () => {
  it('keeps a free-ended wall a full rectangle', () => {
    const doc = makeDoc({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, [
      { id: 'w', a: 'a', b: 'b', thickness: 10 },
    ])
    const poly = computeWallGeometry(doc).polygons.get('w')!
    expect(poly).toHaveLength(4)
    for (const corner of [
      { x: 0, y: 5 },
      { x: 0, y: -5 },
      { x: 100, y: 5 },
      { x: 100, y: -5 },
    ]) {
      expect(hasPoint(poly, corner)).toBe(true)
    }
  })

  it('miters both sides of a corner on a shared seam, no overlap', () => {
    const doc = makeDoc({ o: { x: 0, y: 0 }, r: { x: 100, y: 0 }, u: { x: 0, y: -100 } }, [
      { id: 'A', a: 'o', b: 'r', thickness: 10 },
      { id: 'B', a: 'o', b: 'u', thickness: 10 },
    ])
    const { polygons } = computeWallGeometry(doc)
    const A = polygons.get('A')!
    const B = polygons.get('B')!
    // Each wall is a clean quad: the two free-end corners plus the two miters.
    expect(A).toHaveLength(4)
    expect(B).toHaveLength(4)
    // The node end is no longer a square butt — its corners are the miter points,
    // shared by both walls so they tile along the seam (-5,5)..(5,-5).
    for (const seam of [
      { x: -5, y: 5 }, // outer (convex) miter
      { x: 5, y: -5 }, // inner (concave) miter
    ]) {
      expect(hasPoint(A, seam)).toBe(true)
      expect(hasPoint(B, seam)).toBe(true)
    }
    // The old full-thickness butt corners at the node are gone.
    expect(hasPoint(A, { x: 0, y: 5 })).toBe(false)
    expect(hasPoint(A, { x: 0, y: -5 })).toBe(false)
  })

  it('partitions a fan: middle wall tips at the node, outer walls own the apex', () => {
    const doc = makeDoc(
      {
        o: { x: 0, y: 0 },
        dl: { x: -100, y: 80 },
        dm: { x: 0, y: 100 },
        dr: { x: 100, y: 80 },
      },
      [
        { id: 'L', a: 'o', b: 'dl', thickness: 10 },
        { id: 'M', a: 'o', b: 'dm', thickness: 10 },
        { id: 'R', a: 'o', b: 'dr', thickness: 10 },
      ],
    )
    const { polygons } = computeWallGeometry(doc)
    const M = polygons.get('M')!
    const L = polygons.get('L')!
    const R = polygons.get('R')!
    // M comes to a point at the node and stays at or below it; the apex above the
    // node belongs to the two outer walls, who share that single point — not M.
    expect(hasPoint(M, { x: 0, y: 0 })).toBe(true)
    expect(M.every((p) => p.y > -1e-6)).toBe(true)
    const apex = L.find((p) => p.y < -1)!
    expect(apex).toBeDefined()
    expect(hasPoint(R, apex)).toBe(true)
    expect(hasPoint(M, apex)).toBe(false)
    // No void: just below the node is solid M, just above it is the outer walls.
    expect(inside(M, { x: 0, y: 3 })).toBe(true)
    expect(inside(M, { x: 0, y: -3 })).toBe(false)
  })

  it('does not carve a void out of the middle wall of a 3-wall junction', () => {
    // Three walls fanning down from one node, ~37° apart — close enough that the
    // pairwise inner miters land within the limit, which once trimmed the middle
    // wall back past the node and left an unrendered notch at its top.
    const doc = makeDoc(
      {
        o: { x: 0, y: 0 },
        l: { x: -120, y: 160 },
        m: { x: 0, y: 180 },
        r: { x: 120, y: 160 },
      },
      [
        { id: 'L', a: 'o', b: 'l', thickness: 12 },
        { id: 'M', a: 'o', b: 'm', thickness: 12 },
        { id: 'R', a: 'o', b: 'r', thickness: 12 },
      ],
    )
    const M = computeWallGeometry(doc).polygons.get('M')!
    // The node is M's tip, so the centre just under it stays solid — no notch.
    expect(hasPoint(M, { x: 0, y: 0 })).toBe(true)
    expect(inside(M, { x: 0, y: 3 })).toBe(true)
  })

  it('falls back to overlapping butts on a too-sharp corner, still covering the node', () => {
    // A narrow wedge: two walls ~6° apart sharing the apex node. The miters run
    // far past the node, so each wall keeps its square butt and they overlap.
    const doc = makeDoc({ o: { x: 0, y: 0 }, l: { x: -10, y: 200 }, r: { x: 10, y: 200 } }, [
      { id: 'L', a: 'o', b: 'l', thickness: 10 },
      { id: 'R', a: 'o', b: 'r', thickness: 10 },
    ])
    const { polygons } = computeWallGeometry(doc)
    const L = polygons.get('L')!
    const R = polygons.get('R')!
    // The apex node is covered by the overlapping strips — no gap.
    expect(inside(L, { x: 0, y: 1 }) || inside(R, { x: 0, y: 1 })).toBe(true)
    // No miter spike past the node: every node-side vertex hugs the apex, well
    // inside the miter limit (4 × hw = 20).
    for (const poly of [L, R]) {
      const nodeSide = poly.filter((p) => p.y < 100)
      expect(nodeSide.length).toBeGreaterThan(0)
      for (const p of nodeSide) expect(Math.hypot(p.x, p.y)).toBeLessThan(20)
    }
    // Each wall still reaches its far end at full thickness — not collapsed.
    for (const poly of [L, R]) {
      expect(Math.max(...poly.map((p) => Math.hypot(p.x, p.y)))).toBeGreaterThan(190)
    }
  })
})
