import { describe, expect, it } from 'vitest'
import { nextCopyName } from '../copyName'

describe('nextCopyName', () => {
  it('appends (copy) when free', () => {
    expect(nextCopyName('My flat', ['My flat'])).toBe('My flat (copy)')
  })

  it('numbers the copy when (copy) is taken', () => {
    expect(nextCopyName('My flat', ['My flat', 'My flat (copy)'])).toBe('My flat (copy 2)')
    expect(nextCopyName('My flat', ['My flat', 'My flat (copy)', 'My flat (copy 2)'])).toBe(
      'My flat (copy 3)',
    )
  })

  it('reuses a freed-up name', () => {
    expect(nextCopyName('My flat', ['My flat', 'My flat (copy 2)'])).toBe('My flat (copy)')
  })

  it('does not stack suffixes when copying a copy', () => {
    expect(nextCopyName('My flat (copy)', ['My flat (copy)'])).toBe('My flat (copy 2)')
    expect(nextCopyName('My flat (copy 2)', ['My flat (copy 2)'])).toBe('My flat (copy)')
  })

  it('keeps unrelated parentheses intact', () => {
    expect(nextCopyName('Flat (small)', ['Flat (small)'])).toBe('Flat (small) (copy)')
  })
})
