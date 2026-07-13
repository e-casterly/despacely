import { describe, expect, it, vi } from 'vitest'
import type { Command } from '../../domain/commands'
import { addNode, addWall, createEmptyDocument } from '../../domain/operations'
import type { SceneDocument } from '../../domain/types'
import type { Selection, ToolContext } from '../types'
import { createSelectTool } from '../selectTool'

function docWithWall(): { doc: SceneDocument; wallId: string } {
  const doc = createEmptyDocument()
  const a = addNode(doc, { x: 0, y: 0 })
  const b = addNode(doc, { x: 200, y: 0 })
  const wall = addWall(doc, a, b, { thickness: 10 })
  return { doc, wallId: wall.id }
}

function ctxFor(doc: SceneDocument) {
  const select = vi.fn<(selection: Selection | null) => void>()
  const apply = vi.fn<(command: Command) => void>()
  const ctx: ToolContext = { doc, apply, select, snapDist: 5 }
  return { ctx, select, apply }
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

  it('prefers the wall the point is inside over a nearer thin centreline', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    const c = addNode(doc, { x: 0, y: 16 })
    const d = addNode(doc, { x: 200, y: 16 })
    const thick = addWall(doc, a, b, { thickness: 30 })
    addWall(doc, c, d, { thickness: 4 })
    const { ctx, select } = ctxFor(doc)

    // (100, 12) is inside the thick wall's body (12 < 15) but nearer to the
    // thin wall's axis (4cm) — raw-distance ranking would pick the thin wall.
    createSelectTool().onPointerDown!(at(100, 12), ctx)

    expect(select).toHaveBeenCalledWith({ kind: 'wall', id: thick.id })
  })

  it('has no ghost preview', () => {
    expect(createSelectTool().preview).toBeNull()
  })
})

describe('selectTool rooms', () => {
  function docWithRoom(): { doc: SceneDocument; key: string; ids: string[] } {
    const doc = createEmptyDocument()
    const corners = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ]
    const ids = corners.map((p) => addNode(doc, p))
    for (let i = 0; i < ids.length; i++) addWall(doc, ids[i]!, ids[(i + 1) % ids.length]!)
    return { doc, key: [...ids].sort().join('|'), ids }
  }

  it('selects the room when the click hits neither a vertex nor a wall', () => {
    const { doc, key } = docWithRoom()
    const { ctx, select } = ctxFor(doc)

    createSelectTool().onPointerDown!(at(100, 100), ctx)

    expect(select).toHaveBeenCalledWith({ kind: 'room', id: key })
  })

  it('still prefers a wall over the room around it', () => {
    const { doc } = docWithRoom()
    const { ctx, select } = ctxFor(doc)

    createSelectTool().onPointerDown!(at(100, 8), ctx) // inside the room, within wall slop

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ kind: 'wall' }))
  })

  it('drags the whole room: free delta with no other vertices, one command', () => {
    const { doc, ids } = docWithRoom()
    const { ctx, apply } = ctxFor(doc)
    const [a, b, c, d] = ids as [string, string, string, string]
    const tool = createSelectTool()

    tool.onPointerDown!(at(100, 100), ctx)
    tool.onPointerMove!(at(137, 112), ctx) // raw delta (37,12); nothing to align to

    expect(tool.preview).toEqual({
      movedNodes: {
        [a]: { x: 37, y: 12 },
        [b]: { x: 237, y: 12 },
        [c]: { x: 237, y: 212 },
        [d]: { x: 37, y: 212 },
      },
    })
    expect(doc.nodes[a]!.pos).toEqual({ x: 0, y: 0 }) // doc untouched until pointerup

    tool.onPointerUp!(at(137, 112), ctx)

    expect(apply).toHaveBeenCalledTimes(1)
    const command = apply.mock.calls[0]![0]
    expect(command.label).toBe('Move room')
    command.do(doc)
    expect(doc.nodes[a]!.pos).toEqual({ x: 37, y: 12 })
    expect(doc.nodes[c]!.pos).toEqual({ x: 237, y: 212 })
    command.undo(doc)
    expect(doc.nodes[a]!.pos).toEqual({ x: 0, y: 0 })
    expect(doc.nodes[c]!.pos).toEqual({ x: 200, y: 200 })
  })

  it('a room click under the drag threshold applies nothing', () => {
    const { doc } = docWithRoom()
    const { ctx, apply } = ctxFor(doc)
    const tool = createSelectTool()

    tool.onPointerDown!(at(100, 100), ctx)
    tool.onPointerMove!(at(102, 101), ctx) // within the pick radius of the grab
    tool.onPointerUp!(at(102, 101), ctx)

    expect(apply).not.toHaveBeenCalled()
  })

  it('refuses a delta that would collapse a wall hanging off the contour', () => {
    // spur from the (200,200) corner to (250,200): moving the room right by 50
    // would land the corner on the spur's far end, collapsing the spur
    const { doc, ids } = docWithRoom()
    const spurEnd = addNode(doc, { x: 250, y: 200 })
    addWall(doc, ids[2]!, spurEnd)
    const { ctx, apply } = ctxFor(doc)
    const tool = createSelectTool()

    tool.onPointerDown!(at(100, 100), ctx)
    tool.onPointerMove!(at(150, 100), ctx) // delta exactly (50,0)

    expect(tool.preview).toBeNull() // move refused, nothing shown

    tool.onPointerUp!(at(150, 100), ctx)
    expect(apply).not.toHaveBeenCalled()
  })
})

describe('selectTool node drag', () => {
  function nodeIds(doc: SceneDocument): string[] {
    return Object.keys(doc.nodes)
  }

  it('drags a vertex: free preview off any guide, one command on pointerup', () => {
    const { doc } = docWithWall()
    const { ctx, apply } = ctxFor(doc)
    const nodeA = nodeIds(doc)[0]!
    const tool = createSelectTool()

    tool.onPointerDown!(at(1, -2), ctx) // grab near the (0,0) vertex
    tool.onPointerMove!(at(48, 33), ctx) // far from the other vertex's row/column

    expect(tool.preview).toEqual({ movedNodes: { [nodeA]: { x: 48, y: 33 } } })
    expect(doc.nodes[nodeA]!.pos).toEqual({ x: 0, y: 0 }) // doc untouched until pointerup

    tool.onPointerUp!(at(48, 33), ctx)

    expect(apply).toHaveBeenCalledTimes(1)
    const command = apply.mock.calls[0]![0]
    command.do(doc)
    expect(doc.nodes[nodeA]!.pos).toEqual({ x: 48, y: 33 })
    command.undo(doc)
    expect(doc.nodes[nodeA]!.pos).toEqual({ x: 0, y: 0 })
    expect(tool.preview).toBeNull()
  })

  it('drags a vertex onto another vertex row, showing an alignment guide', () => {
    const { doc } = docWithWall() // vertices (0,0) and (200,0)
    const { ctx } = ctxFor(doc)
    const nodeA = nodeIds(doc)[0]!
    const tool = createSelectTool()

    tool.onPointerDown!(at(1, -2), ctx) // grab the (0,0) vertex
    tool.onPointerMove!(at(60, 3), ctx) // 3cm off the far vertex's y=0 row → snaps flat

    expect(tool.preview).toEqual({
      movedNodes: { [nodeA]: { x: 60, y: 0 } },
      guides: [{ kind: 'horizontal', y: 0 }],
    })
  })

  it('grabbing a vertex selects it', () => {
    const { doc } = docWithWall()
    const { ctx, select } = ctxFor(doc)
    const nodeA = Object.keys(doc.nodes)[0]!

    createSelectTool().onPointerDown!(at(1, -2), ctx)

    expect(select).toHaveBeenCalledWith({ kind: 'node', id: nodeA })
  })

  it('a click without movement applies nothing', () => {
    const { doc } = docWithWall()
    const { ctx, apply } = ctxFor(doc)
    const tool = createSelectTool()

    tool.onPointerDown!(at(1, -2), ctx)
    tool.onPointerMove!(at(2, -1), ctx) // within the pick radius of the grab
    tool.onPointerUp!(at(2, -1), ctx)

    expect(apply).not.toHaveBeenCalled()
  })

  it('refuses a position that would collapse a wall to zero length', () => {
    const { doc } = docWithWall()
    const { ctx, apply } = ctxFor(doc)
    const tool = createSelectTool()

    tool.onPointerDown!(at(1, -2), ctx)
    tool.onPointerMove!(at(199, 1), ctx) // snaps onto the other endpoint (200,0)

    expect(tool.preview).toBeNull() // stays at the last valid spot: the origin

    tool.onPointerUp!(at(199, 1), ctx)
    expect(apply).not.toHaveBeenCalled()
  })

  it('dropping a vertex near a foreign vertex merges them', () => {
    // second, unconnected wall; its near end is the merge target
    const { doc } = docWithWall()
    const { ctx, select, apply } = ctxFor(doc)
    const dragged = nodeIds(doc)[1]! // (200, 0)
    const target = addNode(doc, { x: 300, y: 0 })
    const far = addNode(doc, { x: 300, y: 100 })
    addWall(doc, target, far)
    const tool = createSelectTool()

    tool.onPointerDown!(at(199, 1), ctx)
    tool.onPointerMove!(at(299, 1), ctx) // within snapDist of (300, 0)

    // preview snaps to the target's exact position and highlights it
    expect(tool.preview).toEqual({
      movedNodes: { [dragged]: { x: 300, y: 0 } },
      mergeTarget: target,
    })

    // out of reach: back to free dragging (aligned to the y=0 row), highlight gone
    tool.onPointerMove!(at(249, 1), ctx)
    expect(tool.preview).toEqual({
      movedNodes: { [dragged]: { x: 249, y: 0 } },
      guides: [{ kind: 'horizontal', y: 0 }],
    })

    tool.onPointerMove!(at(299, 1), ctx)
    tool.onPointerUp!(at(299, 1), ctx)

    expect(apply).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenLastCalledWith({ kind: 'node', id: target })
    const command = apply.mock.calls[0]![0]
    command.do(doc)
    expect(doc.nodes[dragged]).toBeUndefined()
    expect(Object.keys(doc.nodes)).toHaveLength(3)
    command.undo(doc)
    expect(doc.nodes[dragged]!.pos).toEqual({ x: 200, y: 0 })
  })

  it('does not merge into a vertex sharing a wall', () => {
    // (200, 0) is the dragged vertex's direct neighbour: its row+column guides
    // intersect on it, but the collapse guard refuses the move instead of merging
    const { doc } = docWithWall()
    const { ctx, apply } = ctxFor(doc)
    const tool = createSelectTool()

    tool.onPointerDown!(at(1, -2), ctx)
    tool.onPointerMove!(at(198, 2), ctx) // in reach of the neighbour

    expect(tool.preview).toBeNull() // no merge preview, move refused

    tool.onPointerUp!(at(198, 2), ctx)
    expect(apply).not.toHaveBeenCalled()
  })

  it('cancel drops the drag without applying', () => {
    const { doc } = docWithWall()
    const { ctx, apply } = ctxFor(doc)
    const tool = createSelectTool()

    tool.onPointerDown!(at(1, -2), ctx)
    tool.onPointerMove!(at(50, 30), ctx)
    tool.cancel!()

    expect(tool.preview).toBeNull()
    tool.onPointerUp!(at(50, 30), ctx)
    expect(apply).not.toHaveBeenCalled()
  })
})

describe('selectTool wall drag', () => {
  it('drags the whole wall: free delta with no other vertices, both ends in one command', () => {
    const { doc, wallId } = docWithWall()
    const { ctx, select, apply } = ctxFor(doc)
    const [a, b] = Object.keys(doc.nodes) as [string, string]
    const tool = createSelectTool()

    tool.onPointerDown!(at(100, 3), ctx) // wall body, away from both vertices
    expect(select).toHaveBeenCalledWith({ kind: 'wall', id: wallId })

    tool.onPointerMove!(at(102, 51), ctx) // raw delta (2,48); nothing to align to
    expect(tool.preview).toEqual({
      movedNodes: { [a]: { x: 2, y: 48 }, [b]: { x: 202, y: 48 } },
    })
    expect(doc.nodes[a]!.pos).toEqual({ x: 0, y: 0 }) // doc untouched until pointerup

    tool.onPointerUp!(at(102, 51), ctx)

    expect(apply).toHaveBeenCalledTimes(1)
    const command = apply.mock.calls[0]![0]
    command.do(doc)
    expect(doc.nodes[a]!.pos).toEqual({ x: 2, y: 48 })
    expect(doc.nodes[b]!.pos).toEqual({ x: 202, y: 48 })
    command.undo(doc)
    expect(doc.nodes[a]!.pos).toEqual({ x: 0, y: 0 })
    expect(doc.nodes[b]!.pos).toEqual({ x: 200, y: 0 })
  })

  it('a click under the drag threshold applies nothing', () => {
    const { doc } = docWithWall()
    const { ctx, apply } = ctxFor(doc)
    const tool = createSelectTool()

    tool.onPointerDown!(at(100, 3), ctx)
    tool.onPointerMove!(at(102, 4), ctx) // within the pick radius of the grab
    tool.onPointerUp!(at(102, 4), ctx)

    expect(apply).not.toHaveBeenCalled()
  })

  it('refuses a delta that would collapse a neighbouring wall', () => {
    // chain a-(0,0) b-(50,0) c-(50,50): dragging wall a-b down by 50 would put
    // b onto c, collapsing wall b-c to zero length
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 50, y: 0 })
    const c = addNode(doc, { x: 50, y: 50 })
    addWall(doc, a, b, { thickness: 10 })
    addWall(doc, b, c, { thickness: 10 })
    const { ctx, apply } = ctxFor(doc)
    const tool = createSelectTool()

    tool.onPointerDown!(at(25, 2), ctx) // grab the horizontal wall
    tool.onPointerMove!(at(25, 52), ctx) // drag down by exactly 50

    expect(tool.preview).toBeNull() // move refused, nothing shown

    tool.onPointerUp!(at(25, 52), ctx)
    expect(apply).not.toHaveBeenCalled()
  })
})
