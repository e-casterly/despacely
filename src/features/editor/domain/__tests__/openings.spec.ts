import { describe, expect, it } from 'vitest'
import {
  fittingOpenings,
  offsetRange,
  openingAtPoint,
  openingRect,
  openingSpan,
  overlapsAnotherOpening,
  sliceWallFootprint,
  wallBlocks,
  wallClearRange,
  type FittedOpening,
} from '../openings'
import { addNode, addWall, createEmptyDocument, wallSegment } from '../operations'
import type { Opening, SceneDocument, Vec2, Wall } from '../types'
import { computeWallGeometry } from '../wallJoints'

function makeOpening(id: string, overrides: Partial<Opening> = {}): Opening {
  return { id, kind: 'door', offset: 100, width: 20, height: 210, sill: 0, ...overrides }
}

/** A lone 200cm wall: both ends are free, so neither is mitred. */
function straightWall(length = 200, thickness = 20) {
  const doc = createEmptyDocument()
  const a = addNode(doc, { x: 0, y: 0 })
  const b = addNode(doc, { x: length, y: 0 })
  const wall = addWall(doc, a, b, { thickness })
  return { doc, wall, a, b }
}

/**
 * An L: a 200cm wall east, then 200cm south off its far end. Both are 20cm thick,
 * so the corner mitres the horizontal wall's inner face back to x=190 and pushes
 * its outer face out to x=210.
 */
function lCorner() {
  const doc = createEmptyDocument()
  const a = addNode(doc, { x: 0, y: 0 })
  const corner = addNode(doc, { x: 200, y: 0 })
  const south = addNode(doc, { x: 200, y: 200 })
  const wall = addWall(doc, a, corner, { thickness: 20 })
  addWall(doc, corner, south, { thickness: 20 })
  return { doc, wall }
}

function facesOf(doc: SceneDocument, wall: Wall) {
  return computeWallGeometry(doc).faces.get(wall.id)!
}

describe('wallClearRange', () => {
  it('is the whole centerline when both ends are free', () => {
    const { doc, wall } = straightWall()

    const { a, b } = wallSegment(doc, wall)
    expect(wallClearRange(facesOf(doc, wall), a, b)).toEqual({ from: 0, to: 200 })
  })

  it('stops at the mitre, and it is the INNER face that limits it', () => {
    const { doc, wall } = lCorner()

    const { a, b } = wallSegment(doc, wall)
    const range = wallClearRange(facesOf(doc, wall), a, b)

    // the centerline runs to 200, but the inner face is cut back to 190 and the
    // outer one runs on to 210 — a full-thickness section only exists up to 190
    expect(range).toEqual({ from: 0, to: 190 })
  })

  it('comes back empty when the two caps have eaten the wall whole', () => {
    // a 30cm wall bridging two 40cm-thick walls: each corner mitres 20cm off it,
    // so there is no full-thickness cross-section left anywhere along it
    const doc = createEmptyDocument()
    const n1 = addNode(doc, { x: 0, y: 100 })
    const n2 = addNode(doc, { x: 0, y: 0 })
    const n3 = addNode(doc, { x: 30, y: 0 })
    const n4 = addNode(doc, { x: 30, y: 100 })
    addWall(doc, n1, n2, { thickness: 40 })
    const bridge = addWall(doc, n2, n3, { thickness: 40 })
    addWall(doc, n3, n4, { thickness: 40 })

    const { a, b } = wallSegment(doc, bridge)
    const faces = facesOf(doc, bridge)

    expect(wallClearRange(faces, a, b)).toEqual({ from: 20, to: 10 }) // from > to
    expect(offsetRange(faces, a, b, 20)).toBeNull()
    expect(openingSpan(doc, bridge, makeOpening('o1', { offset: 15, width: 10 }), faces)).toBeNull()
  })
})

describe('openingSpan', () => {
  it('resolves the stored offset and width into jambs on the centerline', () => {
    const { doc, wall } = straightWall()
    wall.openings = [makeOpening('o1', { offset: 100, width: 40 })]

    const span = openingSpan(doc, wall, wall.openings[0]!, facesOf(doc, wall))!

    expect(span.start).toBe(80)
    expect(span.end).toBe(120)
    expect(span.jambA).toEqual({ x: 80, y: 0 })
    expect(span.jambB).toEqual({ x: 120, y: 0 })
    expect(span.axis).toEqual({ x: 1, y: 0 })
  })

  it('refuses an opening whose jamb would fall inside a mitred cap', () => {
    const { doc, wall } = lCorner()
    // [175, 195] — the far jamb runs past the inner face's 190 cut-back
    const opening = makeOpening('o1', { offset: 185, width: 20 })

    expect(openingSpan(doc, wall, opening, facesOf(doc, wall))).toBeNull()
  })

  it('fits the same opening once it is clear of the cap', () => {
    const { doc, wall } = lCorner()
    const opening = makeOpening('o1', { offset: 175, width: 20 }) // [165, 185]

    expect(openingSpan(doc, wall, opening, facesOf(doc, wall))).not.toBeNull()
  })

  it('refuses an opening wider than the wall', () => {
    const { doc, wall } = straightWall()

    expect(
      openingSpan(doc, wall, makeOpening('o1', { offset: 100, width: 400 }), facesOf(doc, wall)),
    ).toBeNull()
  })

  it('drops the opening when the wall shrinks under it, and brings it back unchanged', () => {
    const { doc, wall, b } = straightWall()
    const opening = makeOpening('o1', { offset: 150, width: 40 }) // [130, 170]
    wall.openings = [opening]
    expect(openingSpan(doc, wall, opening, facesOf(doc, wall))).not.toBeNull()

    doc.nodes[b]!.pos = { x: 150, y: 0 } // wall now ends at 150, under the far jamb
    expect(openingSpan(doc, wall, opening, facesOf(doc, wall))).toBeNull()

    doc.nodes[b]!.pos = { x: 200, y: 0 } // stretched back out
    const span = openingSpan(doc, wall, opening, facesOf(doc, wall))!

    // the stored offset was never rewritten, so the door returns exactly where it was
    expect([span.start, span.end]).toEqual([130, 170])
  })
})

describe('openingRect', () => {
  it('spans jamb to jamb and face to face', () => {
    const { doc, wall } = straightWall(200, 20)
    const span = openingSpan(doc, wall, makeOpening('o1', { width: 40 }), facesOf(doc, wall))!

    // wall runs along +x, so its left side (-dy, dx) is +y
    expect(openingRect(span, 20)).toEqual([
      { x: 80, y: 10 },
      { x: 120, y: 10 },
      { x: 120, y: -10 },
      { x: 80, y: -10 },
    ])
  })
})

describe('offsetRange', () => {
  it('keeps the whole opening inside the clear stretch', () => {
    const { doc, wall } = straightWall()

    const { a, b } = wallSegment(doc, wall)
    expect(offsetRange(facesOf(doc, wall), a, b, 40)).toEqual({ min: 20, max: 180 })
  })

  it('shrinks against the mitred end', () => {
    const { doc, wall } = lCorner()

    const { a, b } = wallSegment(doc, wall)
    // clear stretch is [0, 190], so a 40-wide opening centres between 20 and 170
    expect(offsetRange(facesOf(doc, wall), a, b, 40)).toEqual({ min: 20, max: 170 })
  })

  it('is null when the opening cannot fit at all', () => {
    const { doc, wall } = straightWall(100)

    const { a, b } = wallSegment(doc, wall)
    expect(offsetRange(facesOf(doc, wall), a, b, 200)).toBeNull()
  })
})

describe('overlapsAnotherOpening', () => {
  const wallWith = (...openings: Opening[]) => ({ openings }) as Wall

  it('allows two openings that merely touch at a jamb', () => {
    const wall = wallWith(makeOpening('o1', { offset: 50, width: 20 })) // [40, 60]

    expect(overlapsAnotherOpening(wall, makeOpening('o2', { offset: 70, width: 20 }))).toBe(false)
  })

  it('refuses an opening that intrudes by even 1cm', () => {
    const wall = wallWith(makeOpening('o1', { offset: 50, width: 20 })) // [40, 60]

    expect(overlapsAnotherOpening(wall, makeOpening('o2', { offset: 69, width: 20 }))).toBe(true)
  })

  it('ignores the candidate itself, so an opening may be moved or widened', () => {
    const wall = wallWith(makeOpening('o1', { offset: 50, width: 20 }))

    expect(overlapsAnotherOpening(wall, makeOpening('o1', { offset: 55, width: 40 }))).toBe(false)
  })
})

describe('openingAtPoint', () => {
  /** A 20cm-thick wall east along y=0 with a 40cm opening centred on x=100. */
  function docWithOpening() {
    const { doc, wall } = straightWall(200, 20)
    wall.openings = [makeOpening('o1', { offset: 100, width: 40 })] // [80, 120]
    return { doc, wall }
  }

  it('finds the opening the point lands in', () => {
    const { doc, wall } = docWithOpening()

    const hit = openingAtPoint(doc, { x: 100, y: 5 })!

    expect(hit.opening.id).toBe('o1')
    expect(hit.wall.id).toBe(wall.id)
  })

  it('misses a point on the wall beside the opening', () => {
    const { doc } = docWithOpening()

    expect(openingAtPoint(doc, { x: 50, y: 5 })).toBeUndefined()
  })

  it('misses a point beyond the wall faces, level with the opening', () => {
    const { doc } = docWithOpening()

    // the wall is 20 thick, so ±10 is its face; 15 is outside it
    expect(openingAtPoint(doc, { x: 100, y: 15 })).toBeUndefined()
  })

  it('cannot hit an opening that does not currently fit', () => {
    const { doc, wall } = docWithOpening()
    // an opening wider than its wall is never drawn — so it must not be clickable
    wall.openings = [makeOpening('o1', { offset: 100, width: 400 })]

    expect(openingAtPoint(doc, { x: 100, y: 0 })).toBeUndefined()
  })
})

describe('sliceWallFootprint', () => {
  /** Area of a ring (unsigned) — enough to identify a rectangle's size. */
  function area(ring: Vec2[]): number {
    let twice = 0
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!
      const q = ring[(i + 1) % ring.length]!
      twice += p.x * q.y - q.x * p.y
    }
    return Math.abs(twice) / 2
  }

  /** Extent of a ring along the wall's x axis. */
  function xRange(ring: Vec2[]): [number, number] {
    const xs = ring.map((p) => p.x)
    return [Math.min(...xs), Math.max(...xs)]
  }

  /** A 200x10 wall footprint along the x axis, centred on y=0. */
  const footprint: Vec2[] = [
    { x: 0, y: -5 },
    { x: 200, y: -5 },
    { x: 200, y: 5 },
    { x: 0, y: 5 },
  ]
  const origin: Vec2 = { x: 0, y: 0 }
  const axis: Vec2 = { x: 1, y: 0 }

  function fittedAt(id: string, offset: number, width: number): FittedOpening {
    const start = offset - width / 2
    const end = offset + width / 2
    return {
      opening: makeOpening(id, { offset, width }),
      span: {
        start,
        end,
        jambA: { x: start, y: 0 },
        jambB: { x: end, y: 0 },
        axis,
      },
    }
  }

  it('gives back the untouched polygon when the wall has no openings', () => {
    const { piers, openings } = sliceWallFootprint(footprint, origin, axis, [])

    expect(piers).toEqual([footprint])
    expect(openings).toEqual([])
  })

  it('cuts one opening into two piers and a band', () => {
    const fitted = [fittedAt('o1', 100, 80)] // spans [60, 140]

    const { piers, openings } = sliceWallFootprint(footprint, origin, axis, fitted)

    expect(piers).toHaveLength(2)
    expect(xRange(piers[0]!)).toEqual([0, 60])
    expect(xRange(piers[1]!)).toEqual([140, 200])
    expect(piers.map(area)).toEqual([600, 600]) // 60 x 10 each

    expect(openings).toHaveLength(1)
    expect(openings[0]!.opening.id).toBe('o1')
    expect(xRange(openings[0]!.ring)).toEqual([60, 140])
    expect(area(openings[0]!.ring)).toBe(800) // 80 x 10
  })

  it('keeps the full thickness of the wall in every slice', () => {
    const { piers, openings } = sliceWallFootprint(footprint, origin, axis, [
      fittedAt('o1', 100, 80),
    ])

    for (const ring of [...piers, openings[0]!.ring]) {
      const ys = ring.map((p) => p.y)
      expect([Math.min(...ys), Math.max(...ys)]).toEqual([-5, 5])
    }
  })

  it('handles several openings, in wall order however they were listed', () => {
    // handed over back to front, to prove the slicing sorts them itself
    const fitted = [fittedAt('right', 160, 40), fittedAt('left', 50, 40)]

    const { piers, openings } = sliceWallFootprint(footprint, origin, axis, fitted)

    expect(openings.map((o) => o.opening.id)).toEqual(['left', 'right'])
    // pier | left [30,70] | pier | right [140,180] | pier
    expect(piers.map(xRange)).toEqual([
      [0, 30],
      [70, 140],
      [180, 200],
    ])
  })

  it('drops the pier when an opening runs right up to the wall end', () => {
    const fitted = [fittedAt('o1', 180, 40)] // spans [160, 200] — flush with the end

    const { piers } = sliceWallFootprint(footprint, origin, axis, fitted)

    expect(piers.map(xRange)).toEqual([[0, 160]]) // no zero-width pier past it
  })

  it('slices a mitred footprint from a real T-junction without losing it', () => {
    // the concave case the convexity caveat warns about: a wall in a T
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    const stem = addNode(doc, { x: 100, y: 100 })
    const wall = addWall(doc, a, b, { thickness: 20 })
    addWall(doc, addNode(doc, { x: 100, y: 0 }), stem, { thickness: 20 })
    const ring = computeWallGeometry(doc).polygons.get(wall.id)!

    const { piers, openings } = sliceWallFootprint(ring, { x: 0, y: 0 }, axis, [
      fittedAt('o1', 50, 40),
    ])

    expect(openings).toHaveLength(1)
    expect(area(openings[0]!.ring)).toBeCloseTo(800, 6) // 40 x 20, no sliver
    // the whole footprint is accounted for: nothing was dropped by the cut
    const total = piers.reduce((sum, p) => sum + area(p), 0) + area(openings[0]!.ring)
    expect(total).toBeCloseTo(area(ring), 6)
  })
})

describe('wallBlocks', () => {
  const ring: Vec2[] = [
    { x: 0, y: -5 },
    { x: 10, y: -5 },
    { x: 10, y: 5 },
    { x: 0, y: 5 },
  ]
  const wallOf = (height: number) => ({ height }) as Wall
  /** Just the vertical extents, which is all this function decides. */
  const spans = (blocks: { baseY: number; height: number }[]) =>
    blocks.map((b) => [b.baseY, b.baseY + b.height])

  it('stands every pier at full height', () => {
    const blocks = wallBlocks(wallOf(270), { piers: [ring, ring], openings: [] })

    expect(spans(blocks)).toEqual([
      [0, 270],
      [0, 270],
    ])
  })

  it('gives a door a lintel and no sill', () => {
    const door = makeOpening('d', { kind: 'door', height: 210, sill: 0 })

    const blocks = wallBlocks(wallOf(270), { piers: [], openings: [{ opening: door, ring }] })

    // nothing under the door; wall resumes above it, 210 up to 270
    expect(spans(blocks)).toEqual([[210, 270]])
  })

  it('gives a window both a sill and a lintel', () => {
    const window = makeOpening('w', { kind: 'window', height: 120, sill: 90 })

    const blocks = wallBlocks(wallOf(270), { piers: [], openings: [{ opening: window, ring }] })

    // sill 0–90, glass 90–210, lintel 210–270
    expect(spans(blocks)).toEqual([
      [0, 90],
      [210, 270],
    ])
  })

  it('drops the lintel rather than extruding it backwards when the opening is too tall', () => {
    // the wall was shortened below the door's head; a naive lintel would be -30 tall
    const door = makeOpening('d', { kind: 'door', height: 210, sill: 0 })

    const blocks = wallBlocks(wallOf(180), { piers: [], openings: [{ opening: door, ring }] })

    expect(blocks).toEqual([])
  })

  it('clamps a sill that stands taller than its wall', () => {
    const window = makeOpening('w', { kind: 'window', height: 120, sill: 300 })

    const blocks = wallBlocks(wallOf(270), { piers: [], openings: [{ opening: window, ring }] })

    expect(spans(blocks)).toEqual([[0, 270]]) // solid: the wall never reaches the sill
  })
})

describe('fittingOpenings', () => {
  it('reports only the openings that currently fit, keyed by wall', () => {
    const { doc, wall } = lCorner()
    wall.openings = [
      makeOpening('fits', { offset: 100, width: 40 }),
      makeOpening('runs-into-the-corner', { offset: 185, width: 20 }),
    ]

    const fitted = fittingOpenings(doc, computeWallGeometry(doc))

    expect(fitted.get(wall.id)!.map((f) => f.opening.id)).toEqual(['fits'])
  })

  it('leaves out walls with no openings entirely', () => {
    const { doc } = straightWall()

    expect(fittingOpenings(doc, computeWallGeometry(doc)).size).toBe(0)
  })
})
