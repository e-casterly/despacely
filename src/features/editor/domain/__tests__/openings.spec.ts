import { describe, expect, it } from 'vitest'
import {
  fittingOpenings,
  offsetRange,
  openingAtPoint,
  openingRect,
  openingSpan,
  overlapsAnotherOpening,
  wallClearRange,
} from '../openings'
import { addNode, addWall, createEmptyDocument, wallSegment } from '../operations'
import type { Opening, SceneDocument, Wall } from '../types'
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
