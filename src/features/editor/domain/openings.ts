import { wallSegment } from './operations'
import type { Opening, SceneDocument, Vec2, Wall } from './types'
import type { WallFaces, WallGeometry } from './wallJoints'

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
