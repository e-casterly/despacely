import { describe, expect, it } from 'vitest'
import { squareCmToM2 } from '../units'

describe('squareCmToM2', () => {
  it('converts whole square metres', () => {
    expect(squareCmToM2(40000)).toBe(4)
  })

  it('rounds to two decimals', () => {
    expect(squareCmToM2(12345)).toBe(1.23)
    expect(squareCmToM2(12355)).toBe(1.24)
  })
})
