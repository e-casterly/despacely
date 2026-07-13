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

/** Vertices where the outline turns against its winding (concave corners). */
function reflexVertices(poly: Vec2[]): Vec2[] {
  const n = poly.length
  let area = 0
  for (let i = 0; i < n; i++) {
    const b = poly[i]!
    const c = poly[(i + 1) % n]!
    area += b.x * c.y - c.x * b.y
  }
  const winding = Math.sign(area)
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = poly[(i - 1 + n) % n]!
    const b = poly[i]!
    const c = poly[(i + 1) % n]!
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (cross * winding < -1e-9) out.push(b)
  }
  return out
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

describe('wall faces', () => {
  const faceLength = ([p, q]: [Vec2, Vec2]) => Math.hypot(q.x - p.x, q.y - p.y)

  it('keeps both faces full length on a free-standing wall', () => {
    const doc = makeDoc({ a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }, [
      { id: 'w', a: 'a', b: 'b', thickness: 10 },
    ])

    const faces = computeWallGeometry(doc).faces.get('w')!

    expect(faces.left).toEqual([
      { x: 0, y: 5 },
      { x: 200, y: 5 },
    ])
    expect(faces.right).toEqual([
      { x: 0, y: -5 },
      { x: 200, y: -5 },
    ])
  })

  it('shortens the inner face and lengthens the outer at an L-corner', () => {
    const doc = makeDoc(
      { a: { x: 0, y: 0 }, corner: { x: 200, y: 0 }, c: { x: 200, y: 200 } },
      [
        { id: 'h', a: 'a', b: 'corner', thickness: 10 },
        { id: 'v', a: 'corner', b: 'c', thickness: 10 },
      ],
    )

    const { faces } = computeWallGeometry(doc)

    // inner seam (195,5), outer seam (205,-5)
    expect(faces.get('h')!.left).toEqual([
      { x: 0, y: 5 },
      { x: 195, y: 5 },
    ])
    expect(faces.get('h')!.right).toEqual([
      { x: 0, y: -5 },
      { x: 205, y: -5 },
    ])
    expect(faceLength(faces.get('v')!.left)).toBeCloseTo(195)
    expect(faceLength(faces.get('v')!.right)).toBeCloseTo(205)
  })

  it('gives every wall of a closed square a 190 inner and 210 outer face', () => {
    const doc = makeDoc(
      {
        a: { x: 0, y: 0 },
        b: { x: 200, y: 0 },
        c: { x: 200, y: 200 },
        d: { x: 0, y: 200 },
      },
      [
        { id: 'w1', a: 'a', b: 'b', thickness: 10 },
        { id: 'w2', a: 'b', b: 'c', thickness: 10 },
        { id: 'w3', a: 'c', b: 'd', thickness: 10 },
        { id: 'w4', a: 'd', b: 'a', thickness: 10 },
      ],
    )

    const { faces } = computeWallGeometry(doc)

    for (const id of ['w1', 'w2', 'w3', 'w4']) {
      const wallFaces = faces.get(id)!
      const lengths = [faceLength(wallFaces.left), faceLength(wallFaces.right)].sort((p, q) => p - q)
      expect(lengths[0]).toBeCloseTo(190)
      expect(lengths[1]).toBeCloseTo(210)
    }
  })
})

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

  it('tapers a sharp pair along their true seam, with no spike past the node', () => {
    // A narrow wedge: two walls ~6° apart sharing the apex node. Their facing
    // edges cross ~100 out — that crossing is the real seam corner, so the pair
    // tapers into the node together. The outer crossing lands far behind the
    // node; that side becomes square butts, never a spike out the back.
    const doc = makeDoc({ o: { x: 0, y: 0 }, l: { x: -10, y: 200 }, r: { x: 10, y: 200 } }, [
      { id: 'L', a: 'o', b: 'l', thickness: 10 },
      { id: 'R', a: 'o', b: 'r', thickness: 10 },
    ])
    const { polygons } = computeWallGeometry(doc)
    const L = polygons.get('L')!
    const R = polygons.get('R')!
    // Nothing reaches behind the node — a square butt corner may dip under the
    // node line by its tilt (≈ 0.25 here), but never a spike.
    for (const poly of [L, R]) {
      for (const p of poly) expect(p.y).toBeGreaterThanOrEqual(-1)
    }
    // The walls tile the wedge along the bisector seam down to the node.
    expect(hasPoint(L, { x: 0, y: 0 })).toBe(true)
    expect(hasPoint(R, { x: 0, y: 0 })).toBe(true)
    const seamL = L.find((p) => Math.abs(p.x) < 1e-6 && p.y > 50)
    expect(seamL).toBeDefined()
    expect(hasPoint(R, seamL!)).toBe(true)
    expect(inside(L, { x: -1, y: 5 })).toBe(true)
    expect(inside(L, { x: 1, y: 5 })).toBe(false)
    expect(inside(R, { x: 1, y: 5 })).toBe(true)
    // Beyond the seam crossing each wall is full-width again. At 120 along L's
    // centreline both near-edge offsets are inside the polygon.
    const dirL = { x: -10 / Math.hypot(10, 200), y: 200 / Math.hypot(10, 200) }
    const mid = { x: dirL.x * 120, y: dirL.y * 120 }
    expect(inside(L, { x: mid.x - dirL.y * 4.4, y: mid.y + dirL.x * 4.4 })).toBe(true)
    expect(inside(L, { x: mid.x + dirL.y * 4.4, y: mid.y - dirL.x * 4.4 })).toBe(true)
    // Each wall still reaches its far end at full thickness — not collapsed.
    for (const poly of [L, R]) {
      expect(Math.max(...poly.map((p) => Math.hypot(p.x, p.y)))).toBeGreaterThan(190)
    }
  })

  it('shares the far seam corner with a very sharp neighbour', () => {
    // P is ~8° from N1 (very sharp) while its other side opens onto the wide gap.
    // Their facing edges cross far from the node; that crossing is still the
    // shared seam corner, so both walls keep full thickness up to it and taper
    // into the node together — no notch, no square-butt jog.
    const doc = makeDoc(
      {
        o: { x: 0, y: 0 },
        p: { x: -500, y: 80 },
        n1: { x: -500, y: 160 },
        n2: { x: -350, y: 350 },
        n3: { x: 60, y: 500 },
      },
      [
        { id: 'P', a: 'o', b: 'p', thickness: 28 },
        { id: 'N1', a: 'o', b: 'n1', thickness: 28 },
        { id: 'N2', a: 'o', b: 'n2', thickness: 28 },
        { id: 'N3', a: 'o', b: 'n3', thickness: 28 },
      ],
    )
    const { polygons } = computeWallGeometry(doc)
    const P = polygons.get('P')!
    // P fans out from the node and shares its far seam corner with N1.
    expect(hasPoint(P, { x: 0, y: 0 })).toBe(true)
    const seam = P.find((p) => Math.hypot(p.x, p.y) > 100 && Math.hypot(p.x, p.y) < 300)
    expect(seam).toBeDefined()
    expect(hasPoint(polygons.get('N1')!, seam!)).toBe(true)
    // With true seams everywhere the outline stays convex — no folded-in notch.
    expect(reflexVertices(P)).toHaveLength(0)
    // The junction centre is still covered — by a neighbour that does tip there.
    expect(inside(polygons.get('N2')!, { x: 0, y: 1 }) || inside(polygons.get('N3')!, { x: 0, y: 1 })).toBe(true)
  })
})
