import { describe, expect, it, vi } from 'vitest'
import { createEmptyDocument, wallSegment } from '../../domain/operations'
import type { ToolContext } from '../types'
import { createWallTool } from '../wallTool'

function setup() {
  const doc = createEmptyDocument()
  const apply = vi.fn((command) => command.do(doc))
  const ctx: ToolContext = { doc, apply, select: vi.fn(), snapDist: 5 }
  return { doc, ctx, apply }
}

function down(x: number, y: number) {
  return { input: { world: { x, y }, shift: false } }
}

describe('wallTool', () => {
  it('draws nothing on the first click, a wall on the second', () => {
    const tool = createWallTool()
    const { doc, ctx, apply } = setup()

    tool.onPointerDown!(down(0, 0).input, ctx)
    expect(apply).not.toHaveBeenCalled()
    expect(doc.walls).toHaveLength(0)

    tool.onPointerDown!(down(200, 0).input, ctx)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(doc.walls).toHaveLength(1)
  })

  it('angle-snaps a near-horizontal drag square to the previous point', () => {
    const tool = createWallTool()
    const { doc, ctx } = setup()

    tool.onPointerDown!(down(0, 0).input, ctx)
    tool.onPointerDown!(down(200, 3).input, ctx) // 3cm off axis, within tol → (200,0)

    expect(wallSegment(doc, doc.walls[0]!)).toEqual({ a: { x: 0, y: 0 }, b: { x: 200, y: 0 } })
  })

  it('chains segments sharing the corner node', () => {
    const tool = createWallTool()
    const { doc, ctx } = setup()

    tool.onPointerDown!(down(0, 0).input, ctx)
    tool.onPointerDown!(down(200, 2).input, ctx) // → (200,0)
    tool.onPointerDown!(down(198, 200).input, ctx) // vertical off the corner → (200,200)

    expect(doc.walls).toHaveLength(2)
    expect(Object.keys(doc.nodes)).toHaveLength(3) // shared corner, not 4
  })

  it('snaps onto an existing vertex, closing back onto it', () => {
    const tool = createWallTool()
    const { doc, ctx } = setup()

    tool.onPointerDown!(down(0, 0).input, ctx)
    tool.onPointerDown!(down(0, 200).input, ctx) // vertical wall, node at (0,200)
    tool.onPointerDown!(down(200, 200).input, ctx) // node at (200,200)
    // cursor drifts near the (0,0) origin vertex — snaps exactly onto it
    tool.onPointerMove!(down(3, 3).input, ctx)
    expect(tool.preview).toEqual({
      ghostWall: { a: { x: 200, y: 200 }, b: { x: 0, y: 0 } },
      guides: [], // a vertex snap shows no guide
    })
  })

  it('exposes the ghost and its guides only after the first point', () => {
    const tool = createWallTool()
    const { ctx } = setup()

    expect(tool.preview).toBeNull()

    tool.onPointerDown!(down(0, 0).input, ctx)
    tool.onPointerMove!(down(300, 4).input, ctx) // near-horizontal → axis lock

    expect(tool.preview).toEqual({
      ghostWall: { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } },
      guides: [{ kind: 'axis', from: { x: 0, y: 0 }, angle: 0 }],
    })
  })

  it('lets a far-off-axis drag stay free, with no guides', () => {
    const tool = createWallTool()
    const { ctx } = setup()

    tool.onPointerDown!(down(0, 0).input, ctx)
    tool.onPointerMove!(down(100, 40).input, ctx) // well off any axis

    expect(tool.preview).toEqual({
      ghostWall: { a: { x: 0, y: 0 }, b: { x: 100, y: 40 } },
      guides: [],
    })
  })

  it('clears the chain on cancel', () => {
    const tool = createWallTool()
    const { ctx } = setup()

    tool.onPointerDown!(down(0, 0).input, ctx)
    tool.onPointerMove!(down(100, 0).input, ctx)
    tool.cancel!()

    expect(tool.preview).toBeNull()
  })
})
