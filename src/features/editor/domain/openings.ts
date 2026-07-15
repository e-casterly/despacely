import { clipPolygon, pointInPolygon } from './geometry'
import { wallSegment } from './operations'
import type { Opening, SceneDocument, SwingSide, Vec2, Wall } from './types'
import { computeWallGeometry, type WallFaces, type WallGeometry } from './wallJoints'

/**
 * Where an opening actually sits on its wall, in the wall's own frame.
 *
 * Openings are stored as an offset and a width along the centerline (see
 * `Opening`); this is that stored pair resolved against the wall's current
 * geometry — which is where it can turn out not to fit at all.
 */
export interface OpeningSpan {
  /** cm from node A to the jamb nearer A, and to the jamb nearer B */
  start: number
  end: number
  /** the jambs themselves, as points on the centerline */
  jambA: Vec2
  jambB: Vec2
  /** unit direction A→B; the wall's left side is (-axis.y, axis.x) */
  axis: Vec2
}

export interface FittedOpening {
  opening: Opening
  span: OpeningSpan
}

/**
 * The stretch of centerline that is clear of the mitred end caps, as cm from
 * node A.
 *
 * A wall does not end squarely where its centerline ends: at a corner the two
 * faces are mitred, and they are mitred by *different* amounts — the inner face
 * of an L is shorter than the outer one. A cross-section of the wall is only
 * full-thickness where BOTH faces are already present, so the clear stretch is
 * the intersection of the two: the later of the two starts, the earlier of the
 * two ends.
 *
 * `from > to` means the two caps have eaten the wall whole — a 30cm wall running
 * between two 40cm-thick ones has no full-thickness cross-section anywhere, and
 * so can hold no opening at all. Callers must handle the empty range; they get it
 * for free by comparing against `from`/`to` rather than assuming a positive span.
 */
export function wallClearRange(faces: WallFaces, a: Vec2, b: Vec2): { from: number; to: number } {
  const axis = unitAxis(a, b)
  const along = (p: Vec2) => (p.x - a.x) * axis.x + (p.y - a.y) * axis.y
  return {
    from: Math.max(along(faces.left[0]), along(faces.right[0])),
    to: Math.min(along(faces.left[1]), along(faces.right[1])),
  }
}

/**
 * Where an opening sits, or null when the wall cannot currently hold it: it has
 * no length, the opening is wider than the clear stretch, or a jamb would fall
 * inside a mitred end cap and the opening would break out through the corner.
 *
 * Deliberately derived rather than repaired. Shrink a wall and its door stops
 * being drawn; lengthen the wall again and the door comes back exactly where it
 * was, because nothing ever rewrote the stored offset.
 */
export function openingSpan(
  doc: SceneDocument,
  wall: Wall,
  opening: Opening,
  faces: WallFaces,
): OpeningSpan | null {
  if (opening.width <= 0) return null
  const { a, b } = wallSegment(doc, wall)
  if (a.x === b.x && a.y === b.y) return null

  const start = opening.offset - opening.width / 2
  const end = opening.offset + opening.width / 2
  const clear = wallClearRange(faces, a, b)
  if (start < clear.from || end > clear.to) return null

  const axis = unitAxis(a, b)
  return {
    start,
    end,
    jambA: alongAxis(a, axis, start),
    jambB: alongAxis(a, axis, end),
    axis,
  }
}

/**
 * Every opening that currently fits, keyed by wall id. The single entry point
 * both renderers, the tool and the inspector go through, so none of them can
 * disagree about which openings are real right now.
 */
export function fittingOpenings(
  doc: SceneDocument,
  geometry: WallGeometry,
): Map<string, FittedOpening[]> {
  const byWall = new Map<string, FittedOpening[]>()
  for (const wall of doc.walls) {
    if (wall.openings.length === 0) continue
    const faces = geometry.faces.get(wall.id)
    if (!faces) continue
    const fitted: FittedOpening[] = []
    for (const opening of wall.openings) {
      const span = openingSpan(doc, wall, opening, faces)
      if (span) fitted.push({ opening, span })
    }
    if (fitted.length > 0) byWall.set(wall.id, fitted)
  }
  return byWall
}

/**
 * The four corners of the full-thickness rectangle the opening cuts out of the
 * wall, jamb to jamb and face to face. Wound left side first, so it traces the
 * same way round as the wall polygon it is carved from.
 */
export function openingRect(span: OpeningSpan, thickness: number): Vec2[] {
  const half = thickness / 2
  const left = { x: -span.axis.y, y: span.axis.x }
  return [
    offsetBy(span.jambA, left, half),
    offsetBy(span.jambB, left, half),
    offsetBy(span.jambB, left, -half),
    offsetBy(span.jambA, left, -half),
  ]
}

/**
 * The offsets an opening of this width may take on this wall, or null when the
 * wall is too short to hold it at all. The tool clamps a click into this range;
 * the inspector hands it to the number field as min/max, so an offset that would
 * push the opening into a corner visibly snaps back.
 */
export function offsetRange(
  faces: WallFaces,
  a: Vec2,
  b: Vec2,
  width: number,
): { min: number; max: number } | null {
  const clear = wallClearRange(faces, a, b)
  const min = clear.from + width / 2
  const max = clear.to - width / 2
  return min > max ? null : { min, max }
}

/**
 * Which side of the directed wall segment a→b a point lies on: +1 is the wall's
 * left, (-dy, dx), matching {@link SwingSide}; a point on the axis reads as +1.
 *
 * A door's swing side is chosen from this as it is placed or dragged — moving the
 * pointer across the centerline to the far face flips the direction.
 */
export function sideOfWall(point: Vec2, a: Vec2, b: Vec2): SwingSide {
  const perp = (point.x - a.x) * -(b.y - a.y) + (point.y - a.y) * (b.x - a.x)
  return perp >= 0 ? 1 : -1
}

/** An opening the pointer is over, with the wall it belongs to and where it sits. */
export interface OpeningHit {
  wall: Wall
  opening: Opening
  span: OpeningSpan
}

/**
 * The opening whose cut-out the point lands in, or undefined.
 *
 * An opening sits *inside* a wall's body, so anything picking walls by proximity
 * would swallow it — callers must offer the point here first (see selectTool's
 * pick order). Only openings that currently fit can be hit: one that isn't drawn
 * cannot be clicked.
 */
export function openingAtPoint(doc: SceneDocument, point: Vec2): OpeningHit | undefined {
  const openings = fittingOpenings(doc, computeWallGeometry(doc))
  for (const wall of doc.walls) {
    for (const { opening, span } of openings.get(wall.id) ?? []) {
      if (pointInPolygon(point, openingRect(span, wall.thickness))) {
        return { wall, opening, span }
      }
    }
  }
  return undefined
}

/**
 * Whether the candidate would run into another opening on the same wall.
 *
 * An opening with the candidate's own id is ignored, so this answers "may I move
 * or widen this one?" as well as "may I add one here?". Jambs that merely touch
 * are allowed — two openings sharing a jamb line is tight, not overlapping.
 *
 * This guards the three edit paths (place, inspector commit, drag) rather than
 * rendering: overlap can never arise on its own, since shrinking a wall does not
 * move openings and a split distributes them instead of duplicating them.
 */
export function overlapsAnotherOpening(wall: Wall, candidate: Opening): boolean {
  const start = candidate.offset - candidate.width / 2
  const end = candidate.offset + candidate.width / 2
  return wall.openings.some((other) => {
    if (other.id === candidate.id) return false
    const otherStart = other.offset - other.width / 2
    const otherEnd = other.offset + other.width / 2
    return start < otherEnd && otherStart < end
  })
}

/** A wall footprint cut up by its openings, along the wall's axis. */
export interface WallSlices {
  /** the solid stretches between (and beyond) the openings */
  piers: Vec2[][]
  /** the band each opening cuts, paired with the opening that cut it */
  openings: { opening: Opening; ring: Vec2[] }[]
}

/**
 * Cuts a wall's footprint across its axis at every jamb, giving the solid piers
 * and the band under each opening: `pier | opening | pier | opening | …`.
 *
 * This exists because 3D cannot carve an opening the way 2D does. A wall is
 * extruded from its *footprint*, so a hole punched in that footprint would be
 * swept upwards with it — a shaft from floor to ceiling, not a door. (And an
 * opening spans the wall's full thickness anyway, so its edges lie on the
 * footprint's own faces: it is not an interior hole at all.) But that is exactly
 * what makes this work — a full-thickness cut doesn't pierce the footprint, it
 * *slices* it. The caller then extrudes the piers full height and puts only a
 * sill and a lintel in each opening band, leaving the doorway itself empty.
 *
 * A wall with no openings comes back as a single pier — the polygon it was given,
 * untouched — so there is one code path and no special case.
 */
export function sliceWallFootprint(
  polygon: Vec2[],
  origin: Vec2,
  axis: Vec2,
  fitted: FittedOpening[],
): WallSlices {
  if (fitted.length === 0) return { piers: [polygon], openings: [] }

  // A cut at offset `s` keeps whichever side the normal points away from, so
  // `axis` trims everything past s, and the reversed axis trims everything before
  // it. `null` means "no cut on this side" — the wall's own end already bounds it.
  const back = { x: -axis.x, y: -axis.y }
  const band = (from: number | null, to: number | null): Vec2[] => {
    let piece = polygon
    if (to !== null) piece = clipPolygon(piece, alongAxis(origin, axis, to), axis)
    if (from !== null) piece = clipPolygon(piece, alongAxis(origin, axis, from), back)
    return piece
  }

  const inOrder = [...fitted].sort((p, q) => p.span.start - q.span.start)
  const piers: Vec2[][] = []
  const openings: WallSlices['openings'] = []
  let cursor: number | null = null // the end of the last opening; null before the first

  for (const { opening, span } of inOrder) {
    const pier = band(cursor, span.start)
    if (pier.length >= 3) piers.push(pier) // empty when an opening starts flush with the last
    const ring = band(span.start, span.end)
    if (ring.length >= 3) openings.push({ opening, ring })
    cursor = span.end
  }
  const tail = band(cursor, null)
  if (tail.length >= 3) piers.push(tail)

  return { piers, openings }
}

/** One extruded block of a wall: a footprint ring standing from `baseY` to `baseY + height`. */
export interface WallBlock {
  ring: Vec2[]
  baseY: number
  height: number
}

/**
 * The solid blocks a wall is built from once its openings are cut out: the piers
 * at full height, plus a sill under each opening and a lintel over it. What is
 * left between the sill and the lintel is the opening itself.
 *
 * A door has `sill: 0` and so gets no sill block. Heights are clamped to the
 * wall: `wall.height` is edited independently of the opening, so a door taller
 * than its wall must simply lose its lintel rather than extrude one to a negative
 * depth (which would turn the block inside out).
 */
export function wallBlocks(wall: Wall, slices: WallSlices): WallBlock[] {
  const blocks: WallBlock[] = slices.piers.map((ring) => ({
    ring,
    baseY: 0,
    height: wall.height,
  }))

  for (const { opening, ring } of slices.openings) {
    const sill = Math.min(opening.sill, wall.height)
    if (sill > 0) blocks.push({ ring, baseY: 0, height: sill })

    const head = Math.min(opening.sill + opening.height, wall.height)
    if (wall.height - head > 0) {
      blocks.push({ ring, baseY: head, height: wall.height - head })
    }
  }
  return blocks
}

// --- vector helpers ---

function unitAxis(a: Vec2, b: Vec2): Vec2 {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  return length === 0 ? { x: 0, y: 0 } : { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
}

/** The point `distance` cm along `axis` from `origin`. */
function alongAxis(origin: Vec2, axis: Vec2, distance: number): Vec2 {
  return { x: origin.x + axis.x * distance, y: origin.y + axis.y * distance }
}

function offsetBy(point: Vec2, direction: Vec2, distance: number): Vec2 {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance }
}
