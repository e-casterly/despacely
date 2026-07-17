import { describe, expect, it } from 'vitest'
import {
  AddDividerCommand,
  AddItemCommand,
  AddOpeningCommand,
  AddRoomCommand,
  AddWallCommand,
  MergeNodesCommand,
  MoveItemCommand,
  MoveNodeCommand,
  MoveNodesCommand,
  RemoveItemCommand,
  RemoveNodeCommand,
  RemoveOpeningCommand,
  RemoveRoomCommand,
  RemoveWallCommand,
  SetOpeningPropsCommand,
  SetWallPropsCommand,
} from '../commands'
import {
  addDivider,
  addNode,
  addWall,
  createEmptyDocument,
  findOpening,
  findWall,
  wallsAtNode,
} from '../operations'
import { detectRooms, roomAt, roomKey } from '../rooms'
import type { Item, Opening, SceneDocument } from '../types'

function makeOpening(id: string, overrides: Partial<Opening> = {}): Opening {
  return { id, kind: 'door', offset: 50, width: 20, height: 210, sill: 0, ...overrides }
}

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

/** Two 100x100 rooms sharing a wall; returns the left room's key. */
function docWithTwoRooms(doc: SceneDocument): string {
  const a = addNode(doc, { x: 0, y: 0 })
  const b = addNode(doc, { x: 100, y: 0 })
  const c = addNode(doc, { x: 100, y: 100 })
  const d = addNode(doc, { x: 0, y: 100 })
  const e = addNode(doc, { x: 200, y: 0 })
  const f = addNode(doc, { x: 200, y: 100 })
  const edges = [[a, b], [b, c], [c, d], [d, a], [b, e], [e, f], [f, c]] as const
  for (const [p, q] of edges) addWall(doc, p, q)
  return [a, b, c, d].sort().join('|')
}

describe('RemoveRoomCommand', () => {
  it('removes only the walls the room does not share, GCing loose nodes', () => {
    const doc = createEmptyDocument()
    const leftKey = docWithTwoRooms(doc)

    new RemoveRoomCommand(leftKey).do(doc)

    // the shared wall (b-c) and the right room survive
    expect(doc.walls).toHaveLength(4)
    expect(Object.keys(doc.nodes)).toHaveLength(4)
    expect(roomAt(doc, { x: 150, y: 50 })).toBeDefined()
    expect(roomAt(doc, { x: 50, y: 50 })).toBeUndefined()
  })

  it('restores walls and nodes on undo and repeats on redo', () => {
    const doc = createEmptyDocument()
    const leftKey = docWithTwoRooms(doc)
    const cmd = new RemoveRoomCommand(leftKey)

    cmd.do(doc)
    cmd.undo(doc)

    expect(doc.walls).toHaveLength(7)
    expect(Object.keys(doc.nodes)).toHaveLength(6)
    const left = roomAt(doc, { x: 50, y: 50 })!
    expect(roomKey(left)).toBe(leftKey)

    cmd.do(doc) // redo
    expect(doc.walls).toHaveLength(4)
    expect(roomAt(doc, { x: 50, y: 50 })).toBeUndefined()
  })
})

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

  it('splits the wall an endpoint lands on into two halves at a T-junction', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    const wall = addWall(doc, a, b)

    // the drawn wall ends on the middle of the existing wall's body
    new AddWallCommand({ x: 100, y: 100 }, { x: 100, y: 0 }, { snapDist: 5 }).do(doc)

    expect(doc.walls).toHaveLength(3) // two halves + the new wall
    expect(findWall(doc, wall.id)).toBeUndefined() // the original is gone
    const junction = Object.values(doc.nodes).find((n) => n.pos.x === 100 && n.pos.y === 0)!
    expect(wallsAtNode(doc, junction.id)).toHaveLength(3) // T-junction
  })

  it('undoes the split, restoring the exact original wall', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    const wall = addWall(doc, a, b)
    const cmd = new AddWallCommand({ x: 100, y: 100 }, { x: 100, y: 0 }, { snapDist: 5 })

    cmd.do(doc)
    cmd.undo(doc)

    expect(doc.walls).toHaveLength(1)
    expect(doc.walls[0]!.id).toBe(wall.id)
    expect(Object.keys(doc.nodes)).toHaveLength(2) // split node + drawn node gone
  })

  it('redoes the split with the same wall and node ids', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    addWall(doc, a, b)
    const cmd = new AddWallCommand({ x: 100, y: 100 }, { x: 100, y: 0 }, { snapDist: 5 })

    cmd.do(doc)
    const wallIds = doc.walls.map((w) => w.id).sort()
    const nodeIds = Object.keys(doc.nodes).sort()

    cmd.undo(doc)
    cmd.do(doc) // redo

    expect(doc.walls.map((w) => w.id).sort()).toEqual(wallIds)
    expect(Object.keys(doc.nodes).sort()).toEqual(nodeIds)
  })

  it('subdivides a room by drawing a partition onto two opposite walls', () => {
    const doc = createEmptyDocument()
    const tl = addNode(doc, { x: 0, y: 0 })
    const tr = addNode(doc, { x: 200, y: 0 })
    const br = addNode(doc, { x: 200, y: 100 })
    const bl = addNode(doc, { x: 0, y: 100 })
    for (const [p, q] of [[tl, tr], [tr, br], [br, bl], [bl, tl]] as const) addWall(doc, p, q)
    expect(detectRooms(doc)).toHaveLength(1)

    // a partition from the middle of the top wall to the middle of the bottom wall
    new AddWallCommand({ x: 100, y: 0 }, { x: 100, y: 100 }, { snapDist: 5 }).do(doc)

    expect(detectRooms(doc)).toHaveLength(2)
  })
})

describe('AddDividerCommand', () => {
  it('adds a divider on do, removes it and created nodes on undo', () => {
    const doc = createEmptyDocument()
    const cmd = new AddDividerCommand({ x: 0, y: 0 }, { x: 100, y: 0 }, { snapDist: 5 })

    cmd.do(doc)
    expect(doc.dividers).toHaveLength(1)
    expect(Object.keys(doc.nodes)).toHaveLength(2)

    cmd.undo(doc)
    expect(doc.dividers).toHaveLength(0)
    expect(doc.nodes).toEqual({})
  })

  it('redoes with the same divider and node ids', () => {
    const doc = createEmptyDocument()
    const cmd = new AddDividerCommand({ x: 0, y: 0 }, { x: 100, y: 0 }, { snapDist: 5 })

    cmd.do(doc)
    const dividerId = doc.dividers[0]!.id
    const nodeIds = Object.keys(doc.nodes).sort()

    cmd.undo(doc)
    cmd.do(doc) // redo

    expect(doc.dividers[0]!.id).toBe(dividerId)
    expect(Object.keys(doc.nodes).sort()).toEqual(nodeIds)
  })

  it('zones a room by splitting the two walls its endpoints land on', () => {
    const doc = createEmptyDocument()
    const tl = addNode(doc, { x: 0, y: 0 })
    const tr = addNode(doc, { x: 200, y: 0 })
    const br = addNode(doc, { x: 200, y: 100 })
    const bl = addNode(doc, { x: 0, y: 100 })
    for (const [p, q] of [[tl, tr], [tr, br], [br, bl], [bl, tl]] as const) addWall(doc, p, q)
    expect(detectRooms(doc)).toHaveLength(1)

    // a zero-thickness divider from the middle of the top wall to the bottom wall
    new AddDividerCommand({ x: 100, y: 0 }, { x: 100, y: 100 }, { snapDist: 5 }).do(doc)

    expect(doc.walls).toHaveLength(6) // each crossed wall split into two halves
    expect(doc.dividers).toHaveLength(1)
    const zones = detectRooms(doc)
    expect(zones).toHaveLength(2)
    expect(zones.map((z) => z.area)).toEqual([100 * 100, 100 * 100])
  })

  it('undoes the zoning, restoring the single room and the original walls', () => {
    const doc = createEmptyDocument()
    const tl = addNode(doc, { x: 0, y: 0 })
    const tr = addNode(doc, { x: 200, y: 0 })
    const br = addNode(doc, { x: 200, y: 100 })
    const bl = addNode(doc, { x: 0, y: 100 })
    const walls = [
      [tl, tr],
      [tr, br],
      [br, bl],
      [bl, tl],
    ].map(([p, q]) => addWall(doc, p!, q!))
    const cmd = new AddDividerCommand({ x: 100, y: 0 }, { x: 100, y: 100 }, { snapDist: 5 })

    cmd.do(doc)
    cmd.undo(doc)

    expect(doc.dividers).toHaveLength(0)
    expect(doc.walls.map((w) => w.id).sort()).toEqual(walls.map((w) => w.id).sort())
    expect(Object.keys(doc.nodes)).toHaveLength(4) // the two split nodes are gone
    expect(detectRooms(doc)).toHaveLength(1)
  })
})

describe('AddRoomCommand', () => {
  // a 200x100 rectangle, corners in order
  const rect = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ]

  it('adds four walls sharing four corner nodes, forming one room', () => {
    const doc = createEmptyDocument()

    new AddRoomCommand(rect, { snapDist: 5 }).do(doc)

    expect(doc.walls).toHaveLength(4)
    expect(Object.keys(doc.nodes)).toHaveLength(4) // shared corners, not 8
    expect(roomAt(doc, { x: 100, y: 50 })).toBeDefined()
  })

  it('removes every wall and created node on undo', () => {
    const doc = createEmptyDocument()
    const cmd = new AddRoomCommand(rect, { snapDist: 5 })

    cmd.do(doc)
    cmd.undo(doc)

    expect(doc.walls).toHaveLength(0)
    expect(doc.nodes).toEqual({})
  })

  it('redoes with the same wall and node ids', () => {
    const doc = createEmptyDocument()
    const cmd = new AddRoomCommand(rect, { snapDist: 5 })

    cmd.do(doc)
    const wallIds = doc.walls.map((w) => w.id).sort()
    const nodeIds = Object.keys(doc.nodes).sort()

    cmd.undo(doc)
    cmd.do(doc) // redo

    expect(doc.walls.map((w) => w.id).sort()).toEqual(wallIds)
    expect(Object.keys(doc.nodes).sort()).toEqual(nodeIds)
  })

  it('welds onto an existing vertex and keeps it on undo', () => {
    const doc = createEmptyDocument()
    const shared = addNode(doc, { x: 0, y: 0 })
    const other = addNode(doc, { x: 0, y: -100 })
    addWall(doc, shared, other)

    const cmd = new AddRoomCommand(rect, { snapDist: 5 })
    cmd.do(doc)
    // the room's first corner reused the existing node instead of making a new one
    expect(Object.keys(doc.nodes)).toHaveLength(5) // 2 existing + 3 new corners
    expect(doc.walls).toHaveLength(5)

    cmd.undo(doc)
    expect(doc.nodes[shared]).toBeDefined() // reused, not created -> survives undo
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

  it('also deletes zoning dividers meeting at the vertex and restores them on undo', () => {
    // a wall a-b and a divider b-c both meet at b; deleting b clears both
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 100, y: 100 })
    addWall(doc, a, b)
    addDivider(doc, b, c)

    const cmd = new RemoveNodeCommand(b)
    cmd.do(doc)
    expect(doc.walls).toHaveLength(0)
    expect(doc.dividers).toHaveLength(0)
    expect(doc.nodes).toEqual({})

    cmd.undo(doc)
    expect(doc.walls).toHaveLength(1)
    expect(doc.dividers).toHaveLength(1)
    expect(Object.keys(doc.nodes)).toHaveLength(3)
  })
})

describe('MergeNodesCommand', () => {
  it('welds two separate walls into a junction and takes it apart on undo', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 100, y: 100 })
    const d = addNode(doc, { x: 200, y: 100 })
    const wall = addWall(doc, a, b)
    addWall(doc, c, d)

    const cmd = new MergeNodesCommand(b, c)
    cmd.do(doc)
    expect(Object.keys(doc.nodes)).toHaveLength(3)
    expect(wall.b).toBe(c)

    cmd.undo(doc)
    expect(Object.keys(doc.nodes)).toHaveLength(4)
    expect(doc.nodes[b]!.pos).toEqual({ x: 100, y: 0 })
    expect(wall.b).toBe(b)
  })

  it('restores a dropped duplicate with its original endpoints on undo', () => {
    // chain a-b-c folded shut: wall a-b becomes a duplicate of b-c and is dropped
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 200, y: 0 })
    const folded = addWall(doc, a, b)
    addWall(doc, b, c)

    const cmd = new MergeNodesCommand(a, c)
    cmd.do(doc)
    expect(doc.walls).toHaveLength(1)

    cmd.undo(doc)
    expect(doc.walls).toHaveLength(2)
    expect(folded.a).toBe(a) // not left pointing at the merge target
    expect(folded.b).toBe(b)

    cmd.do(doc) // redo arrives at the same result
    expect(doc.walls).toHaveLength(1)
    expect(doc.nodes[a]).toBeUndefined()
  })

  it('rewires a divider onto the merge target and rolls it back on undo', () => {
    // divider c-d welds its end d onto wall vertex b
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    const c = addNode(doc, { x: 50, y: 100 })
    const d = addNode(doc, { x: 100, y: 50 })
    addWall(doc, a, b)
    const divider = addDivider(doc, c, d)

    const cmd = new MergeNodesCommand(d, b)
    cmd.do(doc)
    expect(doc.nodes[d]).toBeUndefined()
    expect(divider.b).toBe(b) // now hangs off the welded vertex

    cmd.undo(doc)
    expect(divider.b).toBe(d)
    expect(doc.nodes[d]!.pos).toEqual({ x: 100, y: 50 })
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

describe('MoveNodesCommand', () => {
  it('moves the node set as one entry and reverts it together', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 100, y: 0 })
    addWall(doc, a, b)
    const cmd = new MoveNodesCommand(
      [
        { nodeId: a, from: { x: 0, y: 0 }, to: { x: 0, y: 50 } },
        { nodeId: b, from: { x: 100, y: 0 }, to: { x: 100, y: 50 } },
      ],
      'Move wall',
    )
    expect(cmd.label).toBe('Move wall')

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

/** A single 200cm wall, ready to take openings. */
function docWithWall() {
  const doc = createEmptyDocument()
  const a = addNode(doc, { x: 0, y: 0 })
  const b = addNode(doc, { x: 200, y: 0 })
  return { doc, wall: addWall(doc, a, b), a, b }
}

describe('AddOpeningCommand', () => {
  it('adds the opening to its wall', () => {
    const { doc, wall } = docWithWall()
    const opening = makeOpening('o1')

    new AddOpeningCommand(wall.id, opening).do(doc)

    expect(findWall(doc, wall.id)!.openings).toEqual([opening])
  })

  it('undo takes it back off', () => {
    const { doc, wall } = docWithWall()
    const cmd = new AddOpeningCommand(wall.id, makeOpening('o1'))

    cmd.do(doc)
    cmd.undo(doc)

    expect(findWall(doc, wall.id)!.openings).toEqual([])
  })

  it('redo re-adds the same opening, id and all', () => {
    const { doc, wall } = docWithWall()
    const cmd = new AddOpeningCommand(wall.id, makeOpening('o1', { offset: 70 }))

    cmd.do(doc)
    cmd.undo(doc)
    cmd.do(doc)

    expect(findWall(doc, wall.id)!.openings).toEqual([makeOpening('o1', { offset: 70 })])
  })
})

describe('RemoveOpeningCommand', () => {
  it('removes the opening', () => {
    const { doc, wall } = docWithWall()
    wall.openings = [makeOpening('o1'), makeOpening('o2', { offset: 150 })]

    new RemoveOpeningCommand('o1').do(doc)

    expect(wall.openings.map((o) => o.id)).toEqual(['o2'])
  })

  it('undo puts it back at its old index, not on the end', () => {
    const { doc, wall } = docWithWall()
    const first = makeOpening('o1')
    const second = makeOpening('o2', { offset: 150 })
    wall.openings = [first, second]
    const cmd = new RemoveOpeningCommand('o1')

    cmd.do(doc)
    cmd.undo(doc)

    expect(wall.openings).toEqual([first, second])
  })

  it('does nothing for an opening that is already gone', () => {
    const { doc, wall } = docWithWall()
    const cmd = new RemoveOpeningCommand('ghost')

    cmd.do(doc)
    cmd.undo(doc)

    expect(wall.openings).toEqual([])
  })
})

describe('SetOpeningPropsCommand', () => {
  it('applies a partial patch, leaving the other props alone', () => {
    const { doc, wall } = docWithWall()
    wall.openings = [makeOpening('o1', { offset: 50, width: 20 })]

    new SetOpeningPropsCommand('o1', { width: 90 }).do(doc)

    expect(findOpening(doc, 'o1')!.opening).toEqual(makeOpening('o1', { offset: 50, width: 90 }))
  })

  it('undo restores every prop it touched', () => {
    const { doc, wall } = docWithWall()
    const before = makeOpening('o1', { offset: 50, width: 20, height: 210, sill: 0 })
    wall.openings = [{ ...before }]
    const cmd = new SetOpeningPropsCommand('o1', { offset: 120, width: 90, sill: 40 })

    cmd.do(doc)
    cmd.undo(doc)

    expect(findOpening(doc, 'o1')!.opening).toEqual(before)
  })

  it('redo re-applies the patch after an undo', () => {
    const { doc, wall } = docWithWall()
    wall.openings = [makeOpening('o1', { offset: 50 })]
    const cmd = new SetOpeningPropsCommand('o1', { offset: 120 })

    cmd.do(doc)
    cmd.undo(doc)
    cmd.do(doc)

    expect(findOpening(doc, 'o1')!.opening.offset).toBe(120)
  })
})

/**
 * The payoff of storing openings on the wall: every command that destroys a wall
 * already stashes and restores the whole Wall object, so undo brings its openings
 * back with it — and not one of these commands mentions openings anywhere.
 */
describe('openings ride along with the walls that carry them', () => {
  it('RemoveWallCommand undo restores the wall with its openings', () => {
    const { doc, wall } = docWithWall()
    wall.openings = [makeOpening('o1')]
    const cmd = new RemoveWallCommand(wall.id)

    cmd.do(doc)
    expect(findOpening(doc, 'o1')).toBeUndefined()
    cmd.undo(doc)

    expect(findOpening(doc, 'o1')!.opening).toEqual(makeOpening('o1'))
  })

  it('RemoveNodeCommand undo restores the cascaded walls with their openings', () => {
    const doc = createEmptyDocument()
    const corner = addNode(doc, { x: 0, y: 0 })
    const east = addNode(doc, { x: 200, y: 0 })
    const south = addNode(doc, { x: 0, y: 200 })
    addWall(doc, corner, east).openings = [makeOpening('o1')]
    addWall(doc, corner, south).openings = [makeOpening('o2')]
    const cmd = new RemoveNodeCommand(corner)

    cmd.do(doc)
    cmd.undo(doc)

    expect(findOpening(doc, 'o1')!.opening).toEqual(makeOpening('o1'))
    expect(findOpening(doc, 'o2')!.opening).toEqual(makeOpening('o2'))
  })

  it('RemoveRoomCommand undo restores the room walls with their openings', () => {
    const doc = createEmptyDocument()
    const key = docWithTwoRooms(doc)
    doc.walls[0]!.openings = [makeOpening('o1')]
    const cmd = new RemoveRoomCommand(key)

    cmd.do(doc)
    cmd.undo(doc)

    expect(findOpening(doc, 'o1')!.opening).toEqual(makeOpening('o1'))
  })

  it('MergeNodesCommand undo restores a dropped duplicate wall with its openings', () => {
    const doc = createEmptyDocument()
    const a = addNode(doc, { x: 0, y: 0 })
    const b = addNode(doc, { x: 200, y: 0 })
    const stray = addNode(doc, { x: 205, y: 0 })
    addWall(doc, a, b)
    // welding `stray` onto `b` makes this wall a duplicate of the one above, so
    // the merge drops it — taking its opening with it
    addWall(doc, a, stray).openings = [makeOpening('o1')]
    const cmd = new MergeNodesCommand(stray, b)

    cmd.do(doc)
    expect(findOpening(doc, 'o1')).toBeUndefined()
    cmd.undo(doc)

    expect(findOpening(doc, 'o1')!.opening).toEqual(makeOpening('o1'))
  })
})

describe('AddWallCommand through a wall carrying openings', () => {
  /** Draws a wall down from the middle of a 200cm wall, splitting it in two. */
  function splitWithNewWall(doc: SceneDocument) {
    const cmd = new AddWallCommand({ x: 100, y: 0 }, { x: 100, y: 100 })
    cmd.do(doc)
    return cmd
  }

  function openingsByWall(doc: SceneDocument) {
    return doc.walls.map((w) => w.openings.map((o) => `${o.id}@${o.offset}`)).flat().sort()
  }

  it('splits the openings between the halves and drops the one it cuts through', () => {
    const { doc, wall } = docWithWall()
    wall.openings = [
      makeOpening('left', { offset: 40, width: 20 }),
      makeOpening('right', { offset: 160, width: 20 }),
      makeOpening('across', { offset: 100, width: 40 }),
    ]

    splitWithNewWall(doc)

    expect(openingsByWall(doc)).toEqual(['left@40', 'right@60'])
  })

  it('undo restores the original wall with all three openings, the cut one included', () => {
    const { doc, wall } = docWithWall()
    wall.openings = [
      makeOpening('left', { offset: 40, width: 20 }),
      makeOpening('right', { offset: 160, width: 20 }),
      makeOpening('across', { offset: 100, width: 40 }),
    ]
    const cmd = splitWithNewWall(doc)

    cmd.undo(doc)

    expect(openingsByWall(doc)).toEqual(['across@100', 'left@40', 'right@160'])
  })

  it('redo replays the split and lands on the same opening ids and offsets', () => {
    const { doc, wall } = docWithWall()
    wall.openings = [
      makeOpening('left', { offset: 40, width: 20 }),
      makeOpening('right', { offset: 160, width: 20 }),
      makeOpening('across', { offset: 100, width: 40 }),
    ]
    const cmd = splitWithNewWall(doc)

    cmd.undo(doc)
    cmd.do(doc)

    expect(openingsByWall(doc)).toEqual(['left@40', 'right@60'])
  })
})
