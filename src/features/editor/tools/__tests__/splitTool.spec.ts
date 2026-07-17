import { describe, expect, it, vi } from 'vitest'
import { addNode, addWall, createEmptyDocument } from '../../domain/operations'
import { detectRooms } from '../../domain/rooms'
import type { SceneDocument, Vec2 } from '../../domain/types'
import type { ToolContext } from '../types'
import { createSplitTool } from '../splitTool'

function setup(doc: SceneDocument = createEmptyDocument()) {
  const apply = vi.fn<ToolContext['apply']>((command) => command.do(doc))
  const ctx: ToolContext = { doc, apply, select: vi.fn<ToolContext['select']>(), snapDist: 5 }
  return { doc, ctx, apply }
}

function down(x: number, y: number) {
  return { world: { x, y }, shift: false }
}

/** A 200×100 rectangle room, its four corners returned in order. */
function rectRoom(doc: SceneDocument): Vec2[] {
  const corners: Vec2[] = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ]
  const ids = corners.map((p) => addNode(doc, p))
  for (let i = 0; i < ids.length; i++) addWall(doc, ids[i]!, ids[(i + 1) % ids.length]!)
  return corners
}

describe('splitTool', () => {
  it('draws nothing on the first click, a divider on the second — not a wall', () => {
    const tool = createSplitTool()
    const { doc, ctx, apply } = setup()

    tool.onPointerDown!(down(0, 0), ctx)
    expect(apply).not.toHaveBeenCalled()
    expect(doc.dividers).toHaveLength(0)

    tool.onPointerDown!(down(200, 0), ctx)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(doc.dividers).toHaveLength(1)
    expect(doc.walls).toHaveLength(0) // it carves no wall
  })

  it('zones a room by cutting from one contour wall to the opposite one', () => {
    const { doc, ctx } = setup()
    rectRoom(doc)
    expect(detectRooms(doc)).toHaveLength(1)
    const tool = createSplitTool()

    tool.onPointerDown!(down(100, 0), ctx) // lands on the top wall's body
    tool.onPointerDown!(down(100, 100), ctx) // lands on the bottom wall's body

    expect(doc.dividers).toHaveLength(1)
    expect(doc.walls).toHaveLength(6) // each crossed wall split into two halves
    const zones = detectRooms(doc)
    expect(zones).toHaveLength(2)
    expect(zones.map((z) => z.area)).toEqual([100 * 100, 100 * 100])
  })

  it('drops a preview node where the pointer snaps to a wall, before any click', () => {
    const { doc, ctx } = setup()
    rectRoom(doc)
    const tool = createSplitTool()

    tool.onPointerMove!(down(100, 0), ctx) // hover over the top wall's body

    // a node marks the attraction point; no ghost yet (no anchor placed)
    expect(tool.preview).toEqual({ previewNodes: [{ x: 100, y: 0 }] })
  })

  it('shows no preview node when the pointer is out over empty space', () => {
    const { doc, ctx } = setup()
    rectRoom(doc)
    const tool = createSplitTool()

    tool.onPointerMove!(down(100, 50), ctx) // inside the room, not near a wall

    expect(tool.preview).toBeNull()
  })

  it('marks both endpoints with preview nodes while cutting wall to wall', () => {
    const { doc, ctx } = setup()
    rectRoom(doc)
    const tool = createSplitTool()

    tool.onPointerDown!(down(100, 0), ctx) // anchor on the top wall
    tool.onPointerMove!(down(100, 100), ctx) // endpoint on the bottom wall

    expect(tool.preview).toMatchObject({
      ghostDivider: { a: { x: 100, y: 0 }, b: { x: 100, y: 100 } },
      previewNodes: [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    })
  })

  it('exposes the ghost divider and its guides only after the first point', () => {
    const tool = createSplitTool()
    const { ctx } = setup()

    expect(tool.preview).toBeNull()

    tool.onPointerDown!(down(0, 0), ctx)
    tool.onPointerMove!(down(300, 4), ctx) // near-horizontal → axis lock

    expect(tool.preview).toEqual({
      ghostDivider: { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } },
      guides: [{ kind: 'axis', from: { x: 0, y: 0 }, angle: 0 }],
    })
  })

  it('chains dividers sharing the corner node', () => {
    const tool = createSplitTool()
    const { doc, ctx } = setup()

    tool.onPointerDown!(down(0, 0), ctx)
    tool.onPointerDown!(down(200, 2), ctx) // → (200,0)
    tool.onPointerDown!(down(198, 200), ctx) // vertical off the corner → (200,200)

    expect(doc.dividers).toHaveLength(2)
    expect(Object.keys(doc.nodes)).toHaveLength(3) // shared corner, not 4
  })

  it('commits at the typed length on Enter and advances the chain', () => {
    const tool = createSplitTool()
    const { doc, ctx, apply } = setup()

    tool.onPointerDown!(down(0, 0), ctx)
    tool.onPointerMove!(down(200, 0), ctx)
    tool.onKey!('1', ctx)
    tool.onKey!('5', ctx)
    tool.onKey!('0', ctx)
    tool.onKey!('Enter', ctx)

    expect(apply).toHaveBeenCalledTimes(1)
    expect(doc.dividers).toHaveLength(1)
    // the divider was committed at exactly the typed length along the cursor axis
    const divider = doc.dividers[0]!
    const ends = [doc.nodes[divider.a]!.pos, doc.nodes[divider.b]!.pos]
    expect(ends).toContainEqual({ x: 0, y: 0 })
    expect(ends).toContainEqual({ x: 150, y: 0 })
    expect(tool.textEntry).toBeNull() // buffer cleared, chain continues from (150,0)
  })

  it('clears the chain on cancel', () => {
    const tool = createSplitTool()
    const { ctx } = setup()

    tool.onPointerDown!(down(0, 0), ctx)
    tool.onPointerMove!(down(100, 0), ctx)
    tool.cancel!()

    expect(tool.preview).toBeNull()
  })
})
