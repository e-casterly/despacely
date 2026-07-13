import { describe, expect, it } from 'vitest'
import { addNode, createEmptyDocument } from '../operations'
import { resolveSnap, SNAP_ANGLE_STEP } from '../snapping'
import type { SceneDocument, Vec2 } from '../types'

const TOL = 5

function docWith(...positions: Vec2[]): SceneDocument {
  const doc = createEmptyDocument()
  for (const pos of positions) addNode(doc, pos)
  return doc
}

describe('resolveSnap — vertex snap', () => {
  it('snaps onto a nearby existing vertex and reports its id', () => {
    const doc = docWith({ x: 100, y: 0 })
    const nodeId = Object.keys(doc.nodes)[0]

    const result = resolveSnap(doc, { x: 102, y: 1 }, { anchor: null, tol: TOL })

    expect(result.point).toEqual({ x: 100, y: 0 })
    expect(result.nodeId).toBe(nodeId)
    expect(result.guides).toEqual([])
  })

  it('a vertex beats an alignment guide from another vertex', () => {
    // raw sits on the target vertex, and also shares an x with a far vertex
    const doc = docWith({ x: 100, y: 200 }, { x: 100, y: 900 })

    const result = resolveSnap(doc, { x: 101, y: 200 }, { anchor: null, tol: TOL })

    expect(result.point).toEqual({ x: 100, y: 200 })
    expect(result.nodeId).toBeDefined()
  })
})

describe('resolveSnap — no snap', () => {
  it('returns the raw point unchanged when nothing is in range', () => {
    const doc = docWith({ x: 500, y: 500 })

    const result = resolveSnap(doc, { x: 33, y: 77 }, { anchor: null, tol: TOL })

    expect(result.point).toEqual({ x: 33, y: 77 })
    expect(result.guides).toEqual([])
    expect(result.nodeId).toBeUndefined()
  })

  it('falls back to the grid only when a grid step is given', () => {
    const doc = createEmptyDocument()

    const snapped = resolveSnap(doc, { x: 33, y: 77 }, { anchor: null, tol: TOL, grid: 10 })
    expect(snapped.point).toEqual({ x: 30, y: 80 })

    const free = resolveSnap(doc, { x: 33, y: 77 }, { anchor: null, tol: TOL })
    expect(free.point).toEqual({ x: 33, y: 77 })
  })
})

describe('resolveSnap — alignment guides', () => {
  it('aligns x to a vertex sharing an x, leaving y free', () => {
    const doc = docWith({ x: 100, y: 900 })

    const result = resolveSnap(doc, { x: 102, y: 250 }, { anchor: null, tol: TOL })

    expect(result.point).toEqual({ x: 100, y: 250 })
    expect(result.guides).toEqual([{ kind: 'vertical', x: 100 }])
  })

  it('aligns y to a vertex sharing a y, leaving x free', () => {
    const doc = docWith({ x: 900, y: 300 })

    const result = resolveSnap(doc, { x: 250, y: 298 }, { anchor: null, tol: TOL })

    expect(result.point).toEqual({ x: 250, y: 300 })
    expect(result.guides).toEqual([{ kind: 'horizontal', y: 300 }])
  })

  it('pins to the intersection of a vertical and a horizontal guide', () => {
    const doc = docWith({ x: 100, y: 900 }, { x: 900, y: 300 })

    const result = resolveSnap(doc, { x: 101, y: 299 }, { anchor: null, tol: TOL })

    expect(result.point).toEqual({ x: 100, y: 300 })
    expect(result.guides).toContainEqual({ kind: 'vertical', x: 100 })
    expect(result.guides).toContainEqual({ kind: 'horizontal', y: 300 })
    expect(result.guides).toHaveLength(2)
  })

  it('picks the nearest vertex when several share an x', () => {
    const doc = docWith({ x: 100, y: 0 }, { x: 103, y: 0 })

    const result = resolveSnap(doc, { x: 102, y: 400 }, { anchor: null, tol: TOL })

    expect(result.point.x).toBe(103)
  })
})

describe('resolveSnap — soft angular snap', () => {
  it('locks a near-horizontal drag to the axis from the anchor', () => {
    const doc = createEmptyDocument()

    const result = resolveSnap(doc, { x: 100, y: 3 }, { anchor: { x: 0, y: 0 }, tol: TOL })

    expect(result.point.x).toBeCloseTo(100)
    expect(result.point.y).toBeCloseTo(0)
    expect(result.guides).toEqual([{ kind: 'axis', from: { x: 0, y: 0 }, angle: 0 }])
  })

  it('locks a near-diagonal drag to the 45° axis', () => {
    const doc = createEmptyDocument()

    const result = resolveSnap(doc, { x: 100, y: 98 }, { anchor: { x: 0, y: 0 }, tol: TOL })

    expect(result.point.x).toBeCloseTo(result.point.y) // exactly on the 45° ray
    expect(result.guides).toEqual([{ kind: 'axis', from: { x: 0, y: 0 }, angle: SNAP_ANGLE_STEP }])
  })

  it('leaves the direction free when the drag is far from any axis', () => {
    const doc = createEmptyDocument()

    const result = resolveSnap(doc, { x: 100, y: 40 }, { anchor: { x: 0, y: 0 }, tol: TOL })

    expect(result.point).toEqual({ x: 100, y: 40 })
    expect(result.guides).toEqual([])
  })

  it('does not snap a zero-length drag onto the anchor', () => {
    const doc = createEmptyDocument()

    const result = resolveSnap(doc, { x: 0, y: 0 }, { anchor: { x: 0, y: 0 }, tol: TOL })

    expect(result.guides).toEqual([])
  })
})

describe('resolveSnap — exclude / snapToNodes (drag options)', () => {
  it('excludes given vertices from both node snap and alignment', () => {
    const doc = docWith({ x: 100, y: 0 }, { x: 500, y: 300 })
    const excluded = Object.keys(doc.nodes)[0]! // the (100,0) vertex

    // without excluding, this would snap onto (100,0)
    const result = resolveSnap(doc, { x: 101, y: 1 }, { anchor: null, tol: TOL, exclude: [excluded] })

    expect(result.nodeId).toBeUndefined()
    expect(result.point).toEqual({ x: 101, y: 1 }) // nothing left to align to
  })

  it('snapToNodes:false skips vertex coincidence but keeps alignment guides', () => {
    const doc = docWith({ x: 100, y: 900 })

    const result = resolveSnap(doc, { x: 102, y: 250 }, { anchor: null, tol: TOL, snapToNodes: false })

    expect(result.nodeId).toBeUndefined()
    expect(result.point).toEqual({ x: 100, y: 250 }) // still rides the column
    expect(result.guides).toEqual([{ kind: 'vertical', x: 100 }])
  })

  it('snapToNodes:false does not land exactly on a nearby vertex', () => {
    const doc = docWith({ x: 100, y: 0 })

    const onNode = resolveSnap(doc, { x: 101, y: 1 }, { anchor: null, tol: TOL, snapToNodes: false })
    // aligns to the vertex's row and column, but is not reported as a vertex snap
    expect(onNode.nodeId).toBeUndefined()
    expect(onNode.point).toEqual({ x: 100, y: 0 })
  })
})

describe('resolveSnap — axis meets alignment', () => {
  it('extends a vertical axis to a horizontal guide, forming a corner', () => {
    // anchor at origin, another corner at y=200; a near-vertical drag should
    // lock to the axis AND ride up to the far corner's y, landing at (0, 200)
    const doc = docWith({ x: 500, y: 200 })

    const result = resolveSnap(doc, { x: 2, y: 198 }, { anchor: { x: 0, y: 0 }, tol: TOL })

    expect(result.point.x).toBeCloseTo(0)
    expect(result.point.y).toBeCloseTo(200)
    expect(result.guides).toContainEqual({ kind: 'horizontal', y: 200 })
    expect(result.guides.some((g) => g.kind === 'axis')).toBe(true)
  })
})
