import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  createViewport,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../viewport'

function makeViewport() {
  const vp = createViewport(800, 600)
  vp.pan = { x: 100, y: 50 }
  vp.zoom = 2
  return vp
}

describe('coordinate mapping', () => {
  it('shows the pan point at the screen center', () => {
    const vp = makeViewport()
    expect(worldToScreen(vp, vp.pan)).toEqual({ x: 400, y: 300 })
  })

  it('round-trips world -> screen -> world', () => {
    const vp = makeViewport()
    const p = { x: -37, y: 412 }
    const back = screenToWorld(vp, worldToScreen(vp, p))
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })

  it('scales distances by zoom', () => {
    const vp = makeViewport()
    const a = worldToScreen(vp, { x: 0, y: 0 })
    const b = worldToScreen(vp, { x: 100, y: 0 })
    expect(b.x - a.x).toBe(200)
  })
})

describe('panBy', () => {
  it('moves content along with the cursor', () => {
    const vp = makeViewport()
    const before = worldToScreen(vp, { x: 0, y: 0 })

    panBy(vp, { x: 30, y: -10 })

    const after = worldToScreen(vp, { x: 0, y: 0 })
    expect(after.x - before.x).toBeCloseTo(30)
    expect(after.y - before.y).toBeCloseTo(-10)
  })
})

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    const vp = makeViewport()
    const cursor = { x: 200, y: 150 }
    const anchor = screenToWorld(vp, cursor)

    zoomAt(vp, cursor, 1.5)

    const after = worldToScreen(vp, anchor)
    expect(after.x).toBeCloseTo(cursor.x)
    expect(after.y).toBeCloseTo(cursor.y)
    expect(vp.zoom).toBe(3)
  })

  it('clamps zoom to the allowed range', () => {
    const vp = makeViewport()
    zoomAt(vp, { x: 0, y: 0 }, 1000)
    expect(vp.zoom).toBe(MAX_ZOOM)
    zoomAt(vp, { x: 0, y: 0 }, 0.000001)
    expect(vp.zoom).toBe(MIN_ZOOM)
  })
})
