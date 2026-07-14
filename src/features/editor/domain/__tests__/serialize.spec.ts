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
})
