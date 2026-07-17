import { describe, expect, it } from 'vitest'
import { createEmptyDocument } from '../operations'
import { parseDocument } from '../serialize'

describe('parseDocument', () => {
  it('accepts a valid document', () => {
    const doc = createEmptyDocument()
    expect(parseDocument(doc)).toBe(doc)
  })

  it('rejects non-objects', () => {
    expect(() => parseDocument(null)).toThrow(/not an object/)
    expect(() => parseDocument('walls')).toThrow(/not an object/)
  })

  it('rejects a missing or malformed nodes map', () => {
    expect(() => parseDocument({ walls: [], items: [] })).toThrow(/malformed/)
    expect(() => parseDocument({ nodes: [], walls: [], items: [] })).toThrow(/malformed/)
  })

  it('rejects malformed wall/item collections', () => {
    expect(() => parseDocument({ nodes: {}, walls: {}, items: [] })).toThrow(/malformed/)
  })

  it('gives walls saved before openings existed an empty openings array', () => {
    const legacy = {
      nodes: { n1: { id: 'n1', pos: { x: 0, y: 0 } }, n2: { id: 'n2', pos: { x: 100, y: 0 } } },
      walls: [{ id: 'w1', a: 'n1', b: 'n2', thickness: 10, height: 270 }],
      items: [],
    }

    const doc = parseDocument(legacy)

    // without this, the first opening placed into an old project would throw
    expect(doc.walls[0]!.openings).toEqual([])
  })

  it('gives a document saved before dividers existed an empty dividers array', () => {
    const legacy = {
      nodes: {},
      walls: [],
      items: [],
    }

    // without this, the first divider drawn into an old project would throw
    expect(parseDocument(legacy).dividers).toEqual([])
  })

  it('leaves dividers alone on a document that already has them', () => {
    const doc = createEmptyDocument()
    doc.dividers.push({ id: 'd1', a: 'n1', b: 'n2' })

    expect(parseDocument(doc).dividers).toEqual([{ id: 'd1', a: 'n1', b: 'n2' }])
  })

  it('leaves openings alone on a document that already has them', () => {
    const doc = createEmptyDocument()
    const opening = { id: 'o1', kind: 'door' as const, offset: 50, width: 90, height: 210, sill: 0 }
    doc.walls.push({
      id: 'w1',
      a: 'n1',
      b: 'n2',
      thickness: 10,
      height: 270,
      openings: [opening],
    })

    expect(parseDocument(doc).walls[0]!.openings).toEqual([opening])
  })
})
