import { describe, expect, it, vi } from 'vitest'
import { AddOpeningCommand } from '../../domain/commands'
import { addNode, addWall, createEmptyDocument } from '../../domain/operations'
import { DOOR_WIDTH, WINDOW_SILL, WINDOW_WIDTH } from '../../domain/units'
import type { SceneDocument } from '../../domain/types'
import { createOpeningTool } from '../openingTool'
import type { ToolContext } from '../types'

/** A lone 400cm wall along the x axis, long enough for a default door. */
function setup(length = 400) {
  const doc = createEmptyDocument()
  const a = addNode(doc, { x: 0, y: 0 })
  const b = addNode(doc, { x: length, y: 0 })
  const wall = addWall(doc, a, b, { thickness: 20 })
  const apply = vi.fn<ToolContext['apply']>((command) => command.do(doc))
  const ctx: ToolContext = { doc, apply, select: vi.fn<ToolContext['select']>(), snapDist: 5 }
  return { doc, wall, ctx, apply }
}

const at = (x: number, y: number) => ({ world: { x, y }, shift: false })

function openingsOf(doc: SceneDocument) {
  return doc.walls.flatMap((wall) => wall.openings)
}

describe('openingTool', () => {
  it('places a door of the default size where the wall was clicked', () => {
    const { doc, ctx, apply } = setup()

    createOpeningTool('door').onPointerDown!(at(150, 0), ctx)

    expect(apply).toHaveBeenCalledOnce()
    expect(apply.mock.calls[0]![0]).toBeInstanceOf(AddOpeningCommand)
    expect(openingsOf(doc)).toEqual([
      { id: expect.any(String), kind: 'door', offset: 150, width: DOOR_WIDTH, height: 210, sill: 0 },
    ])
  })

  it('places a window with a sill, unlike a door', () => {
    const { doc, ctx } = setup()

    createOpeningTool('window').onPointerDown!(at(200, 0), ctx)

    expect(openingsOf(doc)[0]).toMatchObject({
      kind: 'window',
      width: WINDOW_WIDTH,
      sill: WINDOW_SILL,
    })
  })

  it('projects a click off the centerline onto the wall', () => {
    const { doc, ctx } = setup()

    // inside the wall body (thickness 20) but 8cm off its axis
    createOpeningTool('door').onPointerDown!(at(150, 8), ctx)

    expect(openingsOf(doc)[0]!.offset).toBe(150)
  })

  it('pulls a click near the end back to the closest offset that fits', () => {
    const { doc, ctx } = setup()

    // clicking at the very start would put half the door off the wall
    createOpeningTool('door').onPointerDown!(at(0, 0), ctx)

    // so it lands as close as it can: half a door in from the end
    expect(openingsOf(doc)[0]!.offset).toBe(DOOR_WIDTH / 2)
  })

  it('places nothing when the click misses every wall', () => {
    const { doc, ctx, apply } = setup()

    createOpeningTool('door').onPointerDown!(at(150, 300), ctx)

    expect(apply).not.toHaveBeenCalled()
    expect(openingsOf(doc)).toEqual([])
  })

  it('refuses a wall too short to hold the opening, without touching history', () => {
    const { doc, ctx, apply } = setup(50) // shorter than a 90cm door

    createOpeningTool('door').onPointerDown!(at(25, 0), ctx)

    expect(apply).not.toHaveBeenCalled()
    expect(openingsOf(doc)).toEqual([])
  })

  it('refuses an opening that would run into one already there', () => {
    const { wall, ctx, apply } = setup()
    createOpeningTool('door').onPointerDown!(at(150, 0), ctx) // occupies [105, 195]
    apply.mockClear()

    createOpeningTool('door').onPointerDown!(at(160, 0), ctx) // would be [115, 205]

    expect(apply).not.toHaveBeenCalled()
    expect(wall.openings).toHaveLength(1)
  })

  it('allows a second opening clear of the first', () => {
    const { wall, ctx } = setup()
    createOpeningTool('door').onPointerDown!(at(100, 0), ctx) // [55, 145]

    createOpeningTool('window').onPointerDown!(at(300, 0), ctx) // [240, 360]

    expect(wall.openings).toHaveLength(2)
  })
})
