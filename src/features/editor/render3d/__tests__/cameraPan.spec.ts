import { describe, expect, it } from 'vitest'
import {
  groundForward,
  MIN_PAN_REFERENCE_CM,
  panDirection,
  panDistance,
  PAN_KEYS,
} from '../cameraPan'

/** three's Y-up world: the ground is the XZ plane. */
const UP = { x: 0, y: 1, z: 0 }

const held = (...codes: string[]) => new Set(codes)

function expectDirection(actual: { x: number; y: number; z: number } | null, x: number, z: number) {
  expect(actual).not.toBeNull()
  expect(actual!.x).toBeCloseTo(x, 6)
  expect(actual!.z).toBeCloseTo(z, 6)
  expect(actual!.y).toBe(0) // movement never leaves the floor
}

describe('PAN_KEYS', () => {
  it('is keyed by physical key, so a non-latin layout still drives WASD', () => {
    // event.code, not event.key: on a Cyrillic layout W types 'ц'
    expect([...PAN_KEYS]).toEqual(['KeyW', 'KeyA', 'KeyS', 'KeyD'])
  })
})

describe('groundForward', () => {
  it('flattens the camera’s look direction onto the floor', () => {
    // camera up high and back, looking down at the origin
    const forward = groundForward({ x: 0, y: 100, z: 100 }, { x: 0, y: 0, z: 0 }, UP)!

    expectDirection(forward, 0, -1) // straight ahead, with the height dropped
  })

  it('falls back to the camera’s up vector when looking straight down', () => {
    // directly overhead: the look direction has no horizontal part at all, so
    // the flattened vector would be zero — what points "away" is screen-up
    const cameraUp = { x: 0, y: 0, z: -1 }

    const forward = groundForward({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 0 }, cameraUp)!

    expectDirection(forward, 0, -1)
  })

  it('is null when the camera sits on its own target', () => {
    expect(groundForward({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull()
  })
})

describe('panDirection', () => {
  const forward = { x: 0, y: 0, z: -1 } // looking along -Z

  it('sends W the way the camera is facing and S the other way', () => {
    expectDirection(panDirection(held('KeyW'), forward), 0, -1)
    expectDirection(panDirection(held('KeyS'), forward), 0, 1)
  })

  it('strafes D right and A left of the facing direction', () => {
    expectDirection(panDirection(held('KeyD'), forward), 1, 0)
    expectDirection(panDirection(held('KeyA'), forward), -1, 0)
  })

  it('travels diagonally at the same speed as straight ahead', () => {
    const diagonal = panDirection(held('KeyW', 'KeyD'), forward)!

    // normalised, so W+D is not √2 times faster than W — the naive sum's bug
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(1, 6)
    expectDirection(diagonal, Math.SQRT1_2, -Math.SQRT1_2)
  })

  it('stands still when opposite keys are held together', () => {
    expect(panDirection(held('KeyW', 'KeyS'), forward)).toBeNull()
    expect(panDirection(held('KeyA', 'KeyD'), forward)).toBeNull()
  })

  it('stands still when nothing is held', () => {
    expect(panDirection(held(), forward)).toBeNull()
  })

  it('follows the camera round: W always means "away from the viewer"', () => {
    const facingX = { x: 1, y: 0, z: 0 } // camera turned to look along +X

    expectDirection(panDirection(held('KeyW'), facingX), 1, 0)
    expectDirection(panDirection(held('KeyD'), facingX), 0, 1) // right of +X is +Z
  })
})

describe('panDistance', () => {
  it('scales with how far the camera is from what it is looking at', () => {
    // the same keypress covers more ground zoomed out, so a step always feels alike
    expect(panDistance(2000, 1)).toBeGreaterThan(panDistance(1000, 1))
  })

  it('scales with the time the key was held', () => {
    expect(panDistance(500, 0.5)).toBeCloseTo(panDistance(500, 1) / 2, 6)
  })

  it('keeps moving once the camera is right down on the floor', () => {
    // the bug this guards: speed scaled straight off the distance to the target,
    // so diving in until that distance neared zero left the keys dead
    const nose = panDistance(1, 1)
    const onTop = panDistance(0, 1)

    expect(nose).toBe(panDistance(MIN_PAN_REFERENCE_CM, 1)) // floored, not vanishing
    expect(onTop).toBeGreaterThan(0)
    expect(nose).toBeGreaterThan(50) // still a usable stroll, not a crawl
  })
})
