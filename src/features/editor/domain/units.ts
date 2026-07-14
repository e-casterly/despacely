export const WALL_THICKNESS = 10
export const WALL_HEIGHT = 270

/** Defaults a freshly placed opening takes; everything is editable afterwards. */
export const DOOR_WIDTH = 90
export const DOOR_HEIGHT = 210
export const WINDOW_WIDTH = 120
export const WINDOW_HEIGHT = 120
export const WINDOW_SILL = 90

export const ITEM_SIZE = 60
export const ITEM_HEIGHT = 75
// an item's colour is document data, and its default is a theme decision: the tool
// that builds the Item reads --color-item off the palette (see palette.ts)

/** Room areas read in m² while documents store cm²; rounded to 2 decimals. */
export function squareCmToM2(areaCm2: number): number {
  return Math.round(areaCm2 / 100) / 100
}

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
