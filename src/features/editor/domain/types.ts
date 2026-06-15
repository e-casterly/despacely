/**
 * Scene model conventions:
 * - every linear value is centimeters;
 * - the 2D plan has the Y axis pointing down (matching the screen);
 * - angles are radians, clockwise positive;
 * - 3D mapping (render3d only): plan (x, y) -> three.js (x, height, y).
 */
export interface Vec2 {
  x: number
  y: number
}

export interface Wall {
  id: string
  /** centerline start */
  a: Vec2
  /** centerline end */
  b: Vec2
  thickness: number
  height: number
}

export interface Item {
  id: string
  kind: 'box'
  /** center of the footprint */
  pos: Vec2
  /** width x depth of the footprint */
  size: Vec2
  height: number
  rotation: number
  color: string
}

export interface SceneDocument {
  version: 1
  walls: Wall[]
  items: Item[]
}
