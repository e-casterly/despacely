import { describe, expect, it } from 'vitest'
import { doorSwing, doorSwingSide, faceLabelAt, uprightAngle, wallFaceLabels, windowPanes } from '../draw'
import { detectRooms } from '../../domain/rooms'
import { addNode, addWall, createEmptyDocument } from '../../domain/operations'
import type { OpeningSpan } from '../../domain/openings'
import type { WallFaces } from '../../domain/wallJoints'
import { createViewport } from '../viewport'

/** A 90cm opening on a wall running east along y=0, from x=100 to x=190. */
const eastward: OpeningSpan = {
  start: 100,
  end: 190,
  jambA: { x: 100, y: 0 },
  jambB: { x: 190, y: 0 },
  axis: { x: 1, y: 0 },
}

describe('doorSwing', () => {
  it('hangs the leaf on the jamb nearer node A and swings it square to the wall', () => {
    const swing = doorSwing(eastward, 1)

    expect(swing.hinge).toEqual({ x: 100, y: 0 })
    expect(swing.latch).toEqual({ x: 190, y: 0 })
    expect(swing.radius).toBe(90) // the door's own width
    // side +1 is the wall's left, (-dy, dx) — here that is +y
    expect(swing.leafTip).toEqual({ x: 100, y: 90 })
  })

  it('mirrors the leaf when it swings the other way', () => {
    expect(doorSwing(eastward, -1).leafTip).toEqual({ x: 100, y: -90 })
  })

  it('sweeps the quarter turn from the open leaf back to the far jamb', () => {
    const swing = doorSwing(eastward, 1)

    // leaf at +y is angle +pi/2; the shut door lies along the axis, angle 0
    expect(swing.startAngle).toBeCloseTo(Math.PI / 2)
    expect(swing.endAngle).toBeCloseTo(0)
    expect(swing.counterclockwise).toBe(true) // the short way round, not 270 degrees

    // and the other side sweeps back the other way
    expect(doorSwing(eastward, -1).counterclockwise).toBe(false)
  })
})

describe('windowPanes', () => {
  it('runs two glazing lines jamb to jamb, one either side of the centerline', () => {
    // wall thickness 12 -> the panes sit 2cm off the axis (a sixth of it)
    expect(windowPanes(eastward, 12)).toEqual([
      [
        { x: 100, y: 2 },
        { x: 190, y: 2 },
      ],
      [
        { x: 100, y: -2 },
        { x: 190, y: -2 },
      ],
    ])
  })
})

describe('doorSwingSide', () => {
  /** A 400x300 room; its top wall runs west→east, so the room lies on that wall's left. */
  function roomWithTopWall() {
    const doc = createEmptyDocument()
    const tl = addNode(doc, { x: 0, y: 0 })
    const tr = addNode(doc, { x: 400, y: 0 })
    const br = addNode(doc, { x: 400, y: 300 })
    const bl = addNode(doc, { x: 0, y: 300 })
    for (const [p, q] of [[tl, tr], [tr, br], [br, bl], [bl, tl]] as const) addWall(doc, p, q)
    return detectRooms(doc)
  }

  it('opens into the room when only one side of the door is one', () => {
    // the wall runs +x, so its left (-dy, dx) is +y — which is into the room
    expect(doorSwingSide(roomWithTopWall(), eastward, 10)).toBe(1)
  })

  it('opens into the room when the room is on the wall’s right instead', () => {
    // same wall walked the other way: now the room lies on its right
    const westward: OpeningSpan = {
      start: 100,
      end: 190,
      jambA: { x: 300, y: 0 },
      jambB: { x: 210, y: 0 },
      axis: { x: -1, y: 0 },
    }

    expect(doorSwingSide(roomWithTopWall(), westward, 10)).toBe(-1)
  })

  it('falls back to the wall’s left when neither side is a room', () => {
    expect(doorSwingSide([], eastward, 10)).toBe(1)
  })
})

describe('uprightAngle', () => {
  it('keeps horizontal text left-to-right for both segment directions', () => {
    expect(uprightAngle(1, 0)).toBe(0)
    expect(uprightAngle(-1, 0)).toBe(0)
  })

  it('turns vertical text bottom-to-top for both segment directions', () => {
    expect(uprightAngle(0, 1)).toBe(-Math.PI / 2)
    expect(uprightAngle(0, -1)).toBe(-Math.PI / 2)
  })

  it('flips only the diagonals that would read upside down', () => {
    expect(uprightAngle(1, 1)).toBeCloseTo(Math.PI / 4)
    expect(uprightAngle(-1, -1)).toBeCloseTo(Math.PI / 4)
    expect(uprightAngle(-1, 1)).toBeCloseTo(-Math.PI / 4)
    expect(uprightAngle(1, -1)).toBeCloseTo(-Math.PI / 4)
  })
})

/** Horizontal 200cm wall of thickness 10 with square butts: both faces read 200. */
const equalFaces = (): WallFaces => ({
  left: [
    { x: 0, y: 5 },
    { x: 200, y: 5 },
  ],
  right: [
    { x: 0, y: -5 },
    { x: 200, y: -5 },
  ],
})

/** Same wall with the right face mitred back to 180. */
const unequalFaces = (): WallFaces => ({
  left: [
    { x: 0, y: 5 },
    { x: 200, y: 5 },
  ],
  right: [
    { x: 10, y: -5 },
    { x: 190, y: -5 },
  ],
})

function stubCtx(textWidth: number): CanvasRenderingContext2D {
  return {
    font: '',
    save() {},
    restore() {},
    measureText: () => ({ width: textWidth }),
  } as unknown as CanvasRenderingContext2D
}

describe('wallFaceLabels', () => {
  it('collapses equal faces into a single left label', () => {
    const labels = wallFaceLabels(equalFaces())

    expect(labels).toHaveLength(1)
    expect(labels[0]!.side).toBe('left')
    expect(labels[0]!.value).toBe(200)
  })

  it('keeps both labels when the faces read differently, right one reversed', () => {
    const labels = wallFaceLabels(unequalFaces())

    expect(labels).toHaveLength(2)
    expect(labels[1]!).toMatchObject({ side: 'right', value: 180 })
    // reversed so the (-dy, dx) normal points away from the wall body
    expect(labels[1]!.seg[0]).toEqual({ x: 190, y: -5 })
  })
})

describe('faceLabelAt', () => {
  const vp = createViewport()

  it('hits the left label at its rendered position', () => {
    // label centre = face midpoint + (gap 6 + font 11/2) along the outward normal
    const hit = faceLabelAt(stubCtx(40), vp, equalFaces(), { x: 100, y: 16.5 })

    expect(hit).toMatchObject({ side: 'left', value: 200 })
    expect(hit!.center).toEqual({ x: 100, y: 16.5 })
  })

  it('misses away from the label box', () => {
    expect(faceLabelAt(stubCtx(40), vp, equalFaces(), { x: 100, y: 40 })).toBeUndefined()
  })

  it('offers no right label when the faces read the same (dedup)', () => {
    expect(faceLabelAt(stubCtx(40), vp, equalFaces(), { x: 100, y: -16.5 })).toBeUndefined()
  })

  it('hits the right label when the faces differ', () => {
    const hit = faceLabelAt(stubCtx(40), vp, unequalFaces(), { x: 100, y: -16.5 })

    expect(hit).toMatchObject({ side: 'right', value: 180 })
  })

  it('ignores a label the fit rule hides', () => {
    // text wider than 0.9 × face: the renderer skips it, so the click must too
    expect(faceLabelAt(stubCtx(190), vp, equalFaces(), { x: 100, y: 16.5 })).toBeUndefined()
  })
})
