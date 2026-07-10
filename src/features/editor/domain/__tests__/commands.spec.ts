import { describe, expect, it } from 'vitest'
import {
  AddItemCommand,
  AddWallCommand,
  MoveItemCommand,
  MoveNodeCommand,
  MoveWallCommand,
  RemoveItemCommand,
  RemoveNodeCommand,
  RemoveWallCommand,
  SetWallPropsCommand,
} from '../commands'
import { addNode, addWall, createEmptyDocument } from '../operations'
import type { Item } from '../types'

function makeItem(id = 'i1'): Item {
  return {
    id,
    kind: 'box',
    pos: { x: 0, y: 0 },
    size: { x: 60, y: 60 },
    height: 75,
    rotation: 0,
    color: '#94a3b8',
  }
}

describe('AddWallCommand', () => {
  it('adds on do, removes wall and created nodes on undo', () => {
    const doc = createEmptyDocument()
    const cmd = new AddWallCommand({ x: 0, y: 0 }, { x: 100, y: 0 }, { snapDist: 5 })

    cmd.do(doc)
    expect(doc.walls).toHaveLength(1)
    expect(Object.keys(doc.nodes)).toHaveLength(2)

    cmd.undo(doc)
    expect(doc.walls).toHaveLength(0)
    expect(doc.nodes).toEqual({})
  })

  it('redoes with the same wall and node ids', () => {
    const doc = createEmptyDocument()
    const cmd = new AddWallCommand({ x: 0, y: 0 }, { x: 100, y: 0 }, { snapDist: 5 })

    cmd.do(doc)
    const wallId = doc.walls[0]!.id
    const nodeIds = Object.keys(doc.nodes).sort()

    cmd.undo(doc)
    cmd.do(doc) // redo

    expect(doc.walls[0]!.id).toBe(wallId)
    expect(Object.keys(doc.nodes).sort()).toEqual(nodeIds)
  })

  it('keeps a node that is still referenced by another wall on undo', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const shared = addNode(doc, { x: 100, y: 0 })
    addWall(doc, a, shared)

    // second wall snaps its start onto the shared node, then undo
    const cmd = new AddWallCommand({ x: 100, y: 0 }, { x: 100, y: 100 }, { snapDist: 5 })
    cmd.do(doc)
    cmd.undo(doc)

    expect(doc.nodes[shared]).toBeDefined() // reused, not created -> not deleted
    expect(doc.walls).toHaveLength(1)
  })
})

describe('RemoveWallCommand', () => {
  it('restores the wall and GC-collected endpoints on undo', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const wall = addWall(doc, a, b)

    const cmd = new RemoveWallCommand(wall.id)
    cmd.do(doc)
    expect(doc.walls).toHaveLength(0)
    expect(doc.nodes).toEqual({})

    cmd.undo(doc)
    expect(doc.walls).toHaveLength(1)
    expect(Object.keys(doc.nodes)).toHaveLength(2)
  })
})

describe('SetWallPropsCommand', () => {
  it('patches only the given props and restores them on undo', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const wall = addWall(doc, a, b) // defaults: thickness 10, height 270

    const cmd = new SetWallPropsCommand(wall.id, { thickness: 30 })
    cmd.do(doc)
    expect(wall.thickness).toBe(30)
    expect(wall.height).toBe(270) // untouched by the partial patch

    cmd.undo(doc)
    expect(wall.thickness).toBe(10)
    expect(wall.height).toBe(270)
  })

  it('redoes with the same values', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const wall = addWall(doc, a, b)

    const cmd = new SetWallPropsCommand(wall.id, { thickness: 30, height: 300 })
    cmd.do(doc)
    cmd.undo(doc)
    cmd.do(doc) // redo

    expect(wall.thickness).toBe(30)
    expect(wall.height).toBe(300)
  })

  it('does nothing for a missing wall', () => {
    const doc = createEmptyDocument()
    const cmd = new SetWallPropsCommand('nope', { thickness: 30 })

    cmd.do(doc)
    cmd.undo(doc)

    expect(doc.walls).toHaveLength(0)
  })
})

describe('RemoveNodeCommand', () => {
  it('deletes the vertex with every wall meeting at it and restores all on undo', () => {
    // L-shape a-b, b-c: deleting corner b clears the whole document
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 100, y: 100 })
    addWall(doc, a, b)
    addWall(doc, b, c)

    const cmd = new RemoveNodeCommand(b)
    cmd.do(doc)
    expect(doc.walls).toHaveLength(0)
    expect(doc.nodes).toEqual({})

    cmd.undo(doc)
    expect(doc.walls).toHaveLength(2)
    expect(Object.keys(doc.nodes)).toHaveLength(3)
  })

  it('keeps far endpoints that other walls still use', () => {
    // chain a-b-c-d: deleting b removes walls a-b and b-c; c survives via c-d
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 200, y: 0 })
    const d = addNode(doc, { x: 300, y: 0 })
    addWall(doc, a, b)
    addWall(doc, b, c)
    const survivor = addWall(doc, c, d)

    const cmd = new RemoveNodeCommand(b)
    cmd.do(doc)

    expect(doc.walls).toEqual([survivor])
    expect(Object.keys(doc.nodes).sort()).toEqual([c, d].sort())

    cmd.undo(doc)
    expect(doc.walls).toHaveLength(3)
    expect(Object.keys(doc.nodes)).toHaveLength(4)
  })
})

describe('MoveNodeCommand', () => {
  it('moves a vertex and reverts it', () => {
    const doc = createEmptyDocument()
    const n = addNode(doc, { x: 0, y: 0 })
    const cmd = new MoveNodeCommand(n, { x: 0, y: 0 }, { x: 50, y: 50 })

    cmd.do(doc)
    expect(doc.nodes[n]!.pos).toEqual({ x: 50, y: 50 })
    cmd.undo(doc)
    expect(doc.nodes[n]!.pos).toEqual({ x: 0, y: 0 })
  })
})

describe('MoveWallCommand', () => {
  it('moves both endpoints as one entry and reverts them together', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    addWall(doc, a, b)
    const cmd = new MoveWallCommand([
      { nodeId: a, from: { x: 0, y: 0 }, to: { x: 0, y: 50 } },
      { nodeId: b, from: { x: 100, y: 0 }, to: { x: 100, y: 50 } },
    ])

    cmd.do(doc)
    expect(doc.nodes[a]!.pos).toEqual({ x: 0, y: 50 })
    expect(doc.nodes[b]!.pos).toEqual({ x: 100, y: 50 })
    cmd.undo(doc)
    expect(doc.nodes[a]!.pos).toEqual({ x: 0, y: 0 })
    expect(doc.nodes[b]!.pos).toEqual({ x: 100, y: 0 })
  })
})

describe('item commands', () => {
  it('adds and removes an item', () => {
    const doc = createEmptyDocument()
    const cmd = new AddItemCommand(makeItem())

    cmd.do(doc)
    expect(doc.items).toHaveLength(1)
    cmd.undo(doc)
    expect(doc.items).toHaveLength(0)
  })

  it('removes and restores an item', () => {
    const doc = createEmptyDocument()
    doc.items.push(makeItem())
    const cmd = new RemoveItemCommand('i1')

    cmd.do(doc)
    expect(doc.items).toHaveLength(0)
    cmd.undo(doc)
    expect(doc.items).toHaveLength(1)
  })

  it('moves an item and reverts it', () => {
    const doc = createEmptyDocument()
    doc.items.push(makeItem())
    const cmd = new MoveItemCommand('i1', { x: 0, y: 0 }, { x: 200, y: 100 })

    cmd.do(doc)
    expect(doc.items[0]!.pos).toEqual({ x: 200, y: 100 })
    cmd.undo(doc)
    expect(doc.items[0]!.pos).toEqual({ x: 0, y: 0 })
  })
})
