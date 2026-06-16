import { describe, expect, it, vi } from 'vitest'
import { createEmptyDocument, wallSegment } from '../../domain/operations'
import type { ToolContext } from '../types'
import { createWallTool } from '../wallTool'

function setup() {
  const doc = createEmptyDocument()
  const apply = vi.fn((command) => command.do(doc))
  const ctx: ToolContext = { doc, apply, snapDist: 5 }
  return { doc, ctx, apply }
}

function down(x: number, y: number) {
  return { input: { world: { x, y }, shift: false } }
}

describe('wallTool', () => {
  it('draws nothing on the first click, a wall on the second', () => {
    const tool = createWallTool()
    const { doc, ctx, apply } = setup()

    tool.onPointerDown!(down(3, 4).input, ctx) // snaps to (0,0)
    expect(apply).not.toHaveBeenCalled()
    expect(doc.walls).toHaveLength(0)

    tool.onPointerDown!(down(98, 3).input, ctx) // snaps to (100,0)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(doc.walls).toHaveLength(1)
    expect(wallSegment(doc, doc.walls[0]!)).toEqual({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } })
  })

  it('chains segments sharing the corner node', () => {
    const tool = createWallTool()
    const { doc } = setup()
    const ctx = { doc, apply: vi.fn((c) => c.do(doc)), snapDist: 5 }

    tool.onPointerDown!(down(0, 0).input, ctx)
    tool.onPointerDown!(down(100, 0).input, ctx)
    tool.onPointerDown!(down(100, 100).input, ctx)

    expect(doc.walls).toHaveLength(2)
    expect(Object.keys(doc.nodes)).toHaveLength(3) // shared corner, not 4
  })

  it('ignores a repeated click on the same grid point', () => {
    const tool = createWallTool()
    const { ctx, apply } = setup()

    tool.onPointerDown!(down(0, 0).input, ctx)
    tool.onPointerDown!(down(2, 2).input, ctx) // also snaps to (0,0)

    expect(apply).not.toHaveBeenCalled()
  })

  it('exposes a ghost segment only after the first point', () => {
    const tool = createWallTool()
    const { ctx } = setup()

    expect(tool.preview).toBeNull()

    tool.onPointerDown!(down(0, 0).input, ctx)
    tool.onPointerMove!(down(100, 20).input, ctx)
    expect(tool.preview).toEqual({ ghostWall: { a: { x: 0, y: 0 }, b: { x: 100, y: 20 } } })
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
