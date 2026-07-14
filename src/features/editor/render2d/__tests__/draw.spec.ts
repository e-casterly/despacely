import { describe, expect, it } from 'vitest'
import { doorSwing, doorSwingSide, uprightAngle, windowPanes } from '../draw'
import { detectRooms } from '../../domain/rooms'
import { addNode, addWall, createEmptyDocument } from '../../domain/operations'
import type { OpeningSpan } from '../../domain/openings'

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
