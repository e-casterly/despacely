import { describe, expect, it, vi } from 'vitest'
import { addNode, addWall, createEmptyDocument } from '../../domain/operations'
import type { SceneDocument } from '../../domain/types'
import type { ToolContext } from '../types'
import { createSelectTool } from '../selectTool'

function docWithWall(): { doc: SceneDocument; wallId: string } {
  const doc = createEmptyDocument()
  const a = addNode(doc, { x: 0, y: 0 })
  const b = addNode(doc, { x: 200, y: 0 })
  const wall = addWall(doc, a, b, { thickness: 10 })
  return { doc, wallId: wall.id }
}

function ctxFor(doc: SceneDocument) {
  const select = vi.fn()
  const ctx: ToolContext = { doc, apply: vi.fn(), select, snapDist: 5 }
  return { ctx, select }
}

const at = (x: number, y: number) => ({ world: { x, y }, shift: false })

describe('selectTool', () => {
  it('selects a wall clicked on its body', () => {
    const { doc, wallId } = docWithWall()
    const { ctx, select } = ctxFor(doc)

    createSelectTool().onPointerDown!(at(100, 3), ctx) // within thickness/2 + slop

    expect(select).toHaveBeenCalledWith({ kind: 'wall', id: wallId })
  })

  it('clears selection when clicking empty space', () => {
    const { doc } = docWithWall()
    const { ctx, select } = ctxFor(doc)

    createSelectTool().onPointerDown!(at(100, 80), ctx)

    expect(select).toHaveBeenCalledWith(null)
  })

  it('picks the nearer of two walls', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    const c = addNode(doc, { x: 0, y: 50 })
    const d = addNode(doc, { x: 200, y: 50 })
    const top = addWall(doc, a, b, { thickness: 10 })
    addWall(doc, c, d, { thickness: 10 })
    const { ctx, select } = ctxFor(doc)

    createSelectTool().onPointerDown!(at(100, 5), ctx) // closer to the top wall (y=0)

    expect(select).toHaveBeenCalledWith({ kind: 'wall', id: top.id })
  })

  it('has no ghost preview', () => {
    expect(createSelectTool().preview).toBeNull()
  })
})
