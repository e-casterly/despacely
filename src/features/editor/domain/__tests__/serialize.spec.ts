import { describe, expect, it } from 'vitest'
import { createEmptyDocument } from '../operations'
import { parseDocument } from '../serialize'

describe('parseDocument', () => {
  it('accepts a valid v1 document', () => {
    const doc = createEmptyDocument()
    expect(parseDocument(doc)).toBe(doc)
  })

  it('rejects non-objects', () => {
    expect(() => parseDocument(null)).toThrow()
    expect(() => parseDocument('walls')).toThrow()
  })

  it('rejects unknown versions', () => {
    expect(() => parseDocument({ version: 2, walls: [], items: [] })).toThrow(/version/)
  })

  it('rejects malformed shapes', () => {
    expect(() => parseDocument({ version: 1, walls: {}, items: [] })).toThrow(/malformed/)
  })
})
