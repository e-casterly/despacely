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

export type OpeningKind = 'door' | 'window'

/** Which side of a wall a door swings towards: +1 is the wall's left, (-dy, dx). */
export type SwingSide = 1 | -1

/**
 * A door or window cut into a wall. The two kinds differ only by `sill` (a door
 * sits on the floor) and by the symbol the plan draws for them.
 *
 * Positioned in absolute cm from the wall's node A, not as a fraction of its
 * length: stretching a wall must not stretch or slide its door. The cost is that
 * a wall can end up too short to hold an opening — that is never repaired by
 * mutating the data. Fitness is derived (see `openingSpan`), so a shrunken wall
 * simply stops drawing the opening and lengthening it brings the opening back.
 */
export interface Opening {
  id: string
  kind: OpeningKind
  /** cm from node A along the centerline to the opening's midpoint */
  offset: number
  /** clear width along the centerline */
  width: number
  /** clear height */
  height: number
  /** height of the bottom edge above the floor; 0 for a door */
  sill: number
  /**
   * Which side of the wall a door swings towards, chosen from the cursor's side
   * as it is placed. Absent means "derive it" — into the room (see `doorSwingSide`)
   * — which is how openings placed before this, and windows (symmetric), read.
   */
  side?: SwingSide
}

export interface Wall {
  id: string
  /** centerline endpoints, referenced by node id so corners stay connected */
  a: NodeId
  b: NodeId
  thickness: number
  height: number
  /** doors and windows cut into this wall, positioned from node A */
  openings: Opening[]
}

/**
 * A zero-thickness zoning line in the wall graph. Unlike a wall it has no
 * thickness, height, openings, faces or 3D body — it exists only to subdivide an
 * open space into measured zones (прихожая/кухня/зал in one room). It shares the
 * node graph with walls, so `detectRooms` treats it as an edge and a divider
 * drawn across a room splits it into two zones.
 */
export interface Divider {
  id: string
  a: NodeId
  b: NodeId
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
  /** zero-thickness zoning lines; share the node graph with walls */
  dividers: Divider[]
  items: Item[]
}
