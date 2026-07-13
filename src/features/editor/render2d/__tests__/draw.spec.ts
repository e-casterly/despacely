import { describe, expect, it } from 'vitest'
import { uprightAngle } from '../draw'

describe('uprightAngle', () => {
  it('keeps horizontal text left-to-right for both segment directions', () => {
    expect(uprightAngle(1, 0)).toBe(0)
    expect(uprightAngle(-1, 0)).toBe(0)
  })

  it('turns vertical text bottom-to-top for both segment directions', () => {
    expect(uprightAngle(0, 1)).toBe(-Math.PI / 2)
    expect(uprightAngle(0, -1)).toBe(-Math.PI / 2)
  })

  it('flips only the diagonals that would read upside down', () => {
    expect(uprightAngle(1, 1)).toBeCloseTo(Math.PI / 4)
    expect(uprightAngle(-1, -1)).toBeCloseTo(Math.PI / 4)
    expect(uprightAngle(-1, 1)).toBeCloseTo(-Math.PI / 4)
    expect(uprightAngle(1, -1)).toBeCloseTo(-Math.PI / 4)
  })
})
