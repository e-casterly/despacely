export const WALL_THICKNESS = 10
export const WALL_HEIGHT = 270
export const ITEM_SIZE = 60
export const ITEM_HEIGHT = 75
export const ITEM_COLOR = '#94a3b8'

/** Rounds a value to the nearest multiple of step, e.g. snap(123, 5) === 125. */
export function snap(value: number, step: number): number {
  return Math.round(value / step) * step
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}
