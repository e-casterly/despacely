import { nodeAt } from './operations'
import type { NodeId, SceneDocument, Vec2 } from './types'
import { snap } from './units'

/** Angular step (radians) the soft direction snap locks onto: 45° (0/45/90/…). */
export const SNAP_ANGLE_STEP = Math.PI / 4

/**
 * A snap constraint that both shaped the resolved point and can be drawn as a
 * guideline while the tool holds it. `vertical`/`horizontal` are infinite
 * alignment lines through an existing vertex; `axis` is a ray from the anchor.
 */
export type Guide =
  | { kind: 'vertical'; x: number }
  | { kind: 'horizontal'; y: number }
  | { kind: 'axis'; from: Vec2; angle: number }

export interface SnapResult {
  /** the resolved world point (cm) */
  point: Vec2
  /** the constraints that shaped the point, for the overlay (0–2 of them) */
  guides: Guide[]
  /** set only when the point landed exactly on an existing vertex */
  nodeId?: NodeId
}

export interface SnapOptions {
  /** the previous chain point; enables the angular snap. null for the first point. */
  anchor: Vec2 | null
  /** pick/snap tolerance in world cm (derive from zoom, e.g. SNAP_PX / zoom) */
  tol: number
  /** angular step for the soft direction snap; defaults to {@link SNAP_ANGLE_STEP}. */
  angleStep?: number
  /** optional grid fallback (cm) used only when nothing else snaps; off (null) by default. */
  grid?: number | null
  /** vertices to ignore as snap targets (e.g. the ones being dragged). */
  exclude?: Iterable<NodeId>
  /**
   * When false, the exact vertex-coincidence snap is skipped and only guides
   * shape the point — used by drags, where landing on a vertex means merge (a
   * separate path), not a silent overlap. Defaults to true (the wall tool).
   */
  snapToNodes?: boolean
}

/** A line as base point + unit direction, plus the guide it renders as. */
interface Candidate {
  base: Vec2
  dir: Vec2
  guide: Guide
  /** perpendicular distance from the raw point to this line (cm) */
  dist: number
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

/** 2D cross product (z of the 3D cross); zero when the vectors are parallel. */
function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

function projectOnto(raw: Vec2, c: Candidate): Vec2 {
  const t = dot(sub(raw, c.base), c.dir)
  return { x: c.base.x + t * c.dir.x, y: c.base.y + t * c.dir.y }
}

/** Intersection of two candidate lines, or null when they are (near) parallel. */
function intersect(c1: Candidate, c2: Candidate): Vec2 | null {
  const denom = cross(c1.dir, c2.dir)
  if (Math.abs(denom) < 1e-9) return null
  const t = cross(sub(c2.base, c1.base), c2.dir) / denom
  return { x: c1.base.x + t * c1.dir.x, y: c1.base.y + t * c1.dir.y }
}

/**
 * Resolves a raw pointer position to a snapped point plus the guides that
 * shaped it. Priority: an existing vertex wins outright; otherwise the point is
 * pinned to the closest alignment/axis constraint, and to the intersection of
 * the two closest non-parallel constraints when both are within `tol` (e.g. a
 * vertical guide from one corner crossing a horizontal guide from another).
 * The fixed grid is only a last-resort fallback and is off unless `grid` is set.
 */
export function resolveSnap(doc: SceneDocument, raw: Vec2, opts: SnapOptions): SnapResult {
  const { anchor, tol } = opts
  const angleStep = opts.angleStep ?? SNAP_ANGLE_STEP
  const exclude = new Set(opts.exclude ?? [])

  // 1. an existing vertex is an exact snap and beats every soft constraint
  if (opts.snapToNodes !== false) {
    const node = nodeAt(doc, raw, tol)
    if (node && !exclude.has(node.id)) return { point: { ...node.pos }, guides: [], nodeId: node.id }
  }

  const candidates = collectCandidates(doc, raw, anchor, tol, angleStep, exclude)
  if (candidates.length === 0) {
    return { point: opts.grid ? snapToGrid(raw, opts.grid) : { ...raw }, guides: [] }
  }

  candidates.sort((a, b) => a.dist - b.dist)
  const primary = candidates[0]!
  let point = projectOnto(raw, primary)
  const guides: Guide[] = [primary.guide]

  // pin to the intersection with the next non-parallel constraint, if any
  for (const next of candidates.slice(1)) {
    const p = intersect(primary, next)
    if (p) {
      point = p
      guides.push(next.guide)
      break
    }
  }

  return { point, guides }
}

/** Alignment lines (nearest vertex sharing x or y) plus the soft axis ray. */
function collectCandidates(
  doc: SceneDocument,
  raw: Vec2,
  anchor: Vec2 | null,
  tol: number,
  angleStep: number,
  exclude: Set<NodeId>,
): Candidate[] {
  const out: Candidate[] = []

  // nearest vertex sharing an x (vertical guide) and sharing a y (horizontal guide)
  let vx: number | null = null
  let vDist = tol
  let hy: number | null = null
  let hDist = tol
  for (const n of Object.values(doc.nodes)) {
    if (exclude.has(n.id)) continue
    const dx = Math.abs(n.pos.x - raw.x)
    if (dx <= vDist) {
      vDist = dx
      vx = n.pos.x
    }
    const dy = Math.abs(n.pos.y - raw.y)
    if (dy <= hDist) {
      hDist = dy
      hy = n.pos.y
    }
  }
  if (vx !== null) {
    out.push({ base: { x: vx, y: 0 }, dir: { x: 0, y: 1 }, guide: { kind: 'vertical', x: vx }, dist: vDist })
  }
  if (hy !== null) {
    out.push({ base: { x: 0, y: hy }, dir: { x: 1, y: 0 }, guide: { kind: 'horizontal', y: hy }, dist: hDist })
  }

  // soft angular snap: lock direction to the nearest angleStep multiple when the
  // raw point is within `tol` of that ray (a constant-pixel band around each axis)
  if (anchor) {
    const d = sub(raw, anchor)
    if (d.x !== 0 || d.y !== 0) {
      const angle = Math.round(Math.atan2(d.y, d.x) / angleStep) * angleStep
      const dir = { x: Math.cos(angle), y: Math.sin(angle) }
      const perp = Math.abs(cross(d, dir))
      if (perp <= tol) {
        out.push({ base: anchor, dir, guide: { kind: 'axis', from: anchor, angle }, dist: perp })
      }
    }
  }

  return out
}

function snapToGrid(raw: Vec2, step: number): Vec2 {
  return { x: snap(raw.x, step), y: snap(raw.y, step) }
}
