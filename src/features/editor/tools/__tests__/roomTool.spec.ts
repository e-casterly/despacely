import { describe, expect, it, vi } from 'vitest'
import { addNode, createEmptyDocument } from '../../domain/operations'
import { roomAt } from '../../domain/rooms'
import type { ToolContext } from '../types'
import { createRoomTool } from '../roomTool'

function setup() {
  const doc = createEmptyDocument()
  const apply = vi.fn((command) => command.do(doc))
  const ctx: ToolContext = { doc, apply, select: vi.fn(), snapDist: 5 }
  return { doc, ctx, apply }
}

function at(x: number, y: number) {
  return { world: { x, y }, shift: false }
}

describe('roomTool', () => {
  it('draws nothing on a click that does not drag', () => {
    const tool = createRoomTool()
    const { doc, ctx, apply } = setup()

    tool.onPointerDown!(at(0, 0), ctx)
    tool.onPointerUp!(at(0, 0), ctx)

    expect(apply).not.toHaveBeenCalled()
    expect(doc.walls).toHaveLength(0)
  })

  it('draws a four-wall room in one command on drag', () => {
    const tool = createRoomTool()
    const { doc, ctx, apply } = setup()

    tool.onPointerDown!(at(0, 0), ctx)
    tool.onPointerMove!(at(200, 100), ctx)
    tool.onPointerUp!(at(200, 100), ctx)

    expect(apply).toHaveBeenCalledTimes(1)
    expect(doc.walls).toHaveLength(4)
    expect(Object.keys(doc.nodes)).toHaveLength(4) // shared corners
    expect(roomAt(doc, { x: 100, y: 50 })).toBeDefined()
  })

  it('shows no preview until the pointer moves, then the full ghost once placeable', () => {
    const tool = createRoomTool()
    const { ctx } = setup()

    tool.onPointerDown!(at(0, 0), ctx)
    expect(tool.preview).toBeNull()

    tool.onPointerMove!(at(200, 100), ctx)
    expect(tool.preview).toEqual({
      ghostRoom: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 0, y: 100 },
      ],
      guides: [],
    })
  })

  it('shows a light draft from the first move, before the room is placeable', () => {
    const tool = createRoomTool()
    const { ctx } = setup() // snapDist 5

    tool.onPointerDown!(at(0, 0), ctx)
    tool.onPointerMove!(at(3, 3), ctx) // moved, but within the snap radius on both axes
    expect(tool.preview).toEqual({
      roomDraft: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
        { x: 0, y: 3 },
      ],
      guides: [],
    })
  })

  it('keeps a wide-but-shallow drag as a draft, and commits nothing', () => {
    const tool = createRoomTool()
    const { doc, ctx, apply } = setup()

    tool.onPointerDown!(at(0, 0), ctx)
    tool.onPointerMove!(at(200, 3), ctx) // dy within the snap radius → not placeable
    const overlay = tool.preview!
    expect(overlay.roomDraft).toBeDefined()
    expect(overlay.ghostRoom).toBeUndefined()

    tool.onPointerUp!(at(200, 3), ctx)
    expect(apply).not.toHaveBeenCalled()
    expect(doc.walls).toHaveLength(0)
  })

  it('snaps a corner onto an existing vertex', () => {
    const tool = createRoomTool()
    const { ctx } = setup()
    addNode(ctx.doc, { x: 200, y: 100 })

    tool.onPointerDown!(at(0, 0), ctx)
    tool.onPointerMove!(at(197, 98), ctx) // near the existing vertex → snaps to it

    const overlay = tool.preview!
    expect(overlay.ghostRoom![2]).toEqual({ x: 200, y: 100 })
  })

  it('clears the in-progress room on cancel', () => {
    const tool = createRoomTool()
    const { ctx } = setup()

    tool.onPointerDown!(at(0, 0), ctx)
    tool.onPointerMove!(at(200, 100), ctx)
    tool.cancel!()

    expect(tool.preview).toBeNull()
  })
})
