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

export type NodeId = string

/** A shared point in the wall graph; walls reference nodes by id. */
export interface Node {
  id: NodeId
  pos: Vec2
}

export interface Wall {
  id: string
  /** centerline endpoints, referenced by node id so corners stay connected */
  a: NodeId
  b: NodeId
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
  /** wall graph vertices, keyed by id for O(1) lookup */
  nodes: Record<NodeId, Node>
  walls: Wall[]
  items: Item[]
}
