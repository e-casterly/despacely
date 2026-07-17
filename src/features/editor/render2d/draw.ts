import { pointInPolygon, polygonCentroid } from '../domain/geometry'
import {
  fittingOpenings,
  openingRect,
  type FittedOpening,
  type OpeningSpan,
} from '../domain/openings'
import { nodeAt } from '../domain/operations'
import type { Guide } from '../domain/snapping'
import { detectRooms, insideAnyRoom, roomKey, type Room } from '../domain/rooms'
import { squareCmToM2, WALL_HEIGHT, WALL_THICKNESS } from '../domain/units'
import type { NodeId, OpeningKind, SceneDocument, SwingSide, Vec2, Wall } from '../domain/types'
import type { GhostOpening, Selection, ToolOverlay } from '../tools/types'
import type { EditorPalette } from '../palette'
import { screenToWorld, worldToScreen, type Viewport } from './viewport'
import { computeWallGeometry, type WallFaces, type WallGeometry } from '../domain/wallJoints'

/** Metric grid tiers (cm): 10cm fine, 50cm (4 squares per metre), 1m strong. */
const GRID_TIERS = [
  { step: 10, color: 'gridFine' },
  { step: 50, color: 'gridMid' },
  { step: 100, color: 'gridStrong' },
] as const

/** A tier is skipped once its lines get closer than this on screen. */
const MIN_LINE_GAP_PX = 6

/** Transient view state layered on top of the document. */
export interface RenderView {
  overlay?: ToolOverlay | null
  selection?: Selection | null
  /** the node or wall the pointer is hovering in select mode, highlighted lightly */
  hovered?: Selection | null
  /** which of the selected wall's face labels the pointer is over */
  hoveredFaceLabel?: 'left' | 'right' | null
}

/** Full repaint: background, grid, then the document in layer order. */
export function render(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: SceneDocument,
  palette: EditorPalette,
  dpr: number,
  view: RenderView = {},
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, vp.width, vp.height)

  drawGrid(ctx, vp, palette)

  const selectedWallId = view.selection?.kind === 'wall' ? view.selection.id : null
  const selectedNodeId = view.selection?.kind === 'node' ? view.selection.id : null
  const selectedRoomKey = view.selection?.kind === 'room' ? view.selection.id : null
  const selectedOpeningId = view.selection?.kind === 'opening' ? view.selection.id : null
  const hoveredWallId = view.hovered?.kind === 'wall' ? view.hovered.id : null
  const hoveredNodeId = view.hovered?.kind === 'node' ? view.hovered.id : null
  const hoveredRoomKey = view.hovered?.kind === 'room' ? view.hovered.id : null
  const hoveredOpeningId = view.hovered?.kind === 'opening' ? view.hovered.id : null
  const hoveredDividerId = view.hovered?.kind === 'divider' ? view.hovered.id : null
  const selectedDividerId = view.selection?.kind === 'divider' ? view.selection.id : null
  // The doc as the user currently sees it: a drag preview overrides node
  // positions on a render-only copy, so the real document stays untouched
  // until the move is committed as a command.
  let viewDoc = view.overlay?.movedNodes ? withMovedNodes(doc, view.overlay.movedNodes) : doc
  // an opening being dragged rides on the same render-only copy, so the gap, the
  // symbol and the selection wash all follow it without touching the document
  if (view.overlay?.movedOpening) {
    viewDoc = withMovedOpening(viewDoc, view.overlay.movedOpening)
  }
  // The ghost (a single wall, or the four edges of a room being drawn) is drawn
  // through the same path as real walls so they all miter against each other;
  // node dots stay on the real doc so the ghost corners carry none.
  const ghostSegs = ghostSegments(view.overlay)
  const ghost = ghostSegs ? augmentWithGhost(viewDoc, ghostSegs) : null
  // rooms derive from the ghost doc when one exists, so a closed ghost loop — a
  // room being drawn, or a wall ghost completing a loop — fills live; otherwise
  // from viewDoc, where a drag preview moves existing rooms
  const rooms = detectRooms(ghost?.doc ?? viewDoc)
  // one miter pass per repaint, shared by the wall fills and the face labels
  // (selection and ghost never coexist, so the ghost never skews label faces)
  const geometry = computeWallGeometry(ghost?.doc ?? viewDoc)
  // resolved once against that same miter pass, so the cut-out gaps and everything
  // downstream agree on which openings currently fit
  const openings = fittingOpenings(ghost?.doc ?? viewDoc, geometry)
  withWorldTransform(ctx, vp, dpr, () => {
    drawRooms(ctx, rooms, palette, selectedRoomKey, hoveredRoomKey)
    drawWalls(
      ctx,
      vp,
      ghost?.doc ?? viewDoc,
      geometry,
      openings,
      palette,
      selectedWallId,
      hoveredWallId,
      ghost?.ghostIds ?? null,
    )
    drawOpenings(
      ctx,
      vp,
      ghost?.doc ?? viewDoc,
      openings,
      rooms,
      palette,
      selectedOpeningId,
      hoveredOpeningId,
    )
    if (view.overlay?.ghostOpening) {
      drawGhostOpening(ctx, vp, view.overlay.ghostOpening, palette)
    }
    drawDividers(ctx, vp, ghost?.doc ?? viewDoc, palette, view.overlay?.ghostDivider, {
      selectedId: selectedDividerId,
      hoveredId: hoveredDividerId,
    })
    drawWallNodes(ctx, vp, viewDoc, palette, selectedWallId, selectedNodeId, hoveredNodeId)
    if (view.overlay?.previewNodes?.length) {
      drawPreviewNodes(ctx, vp, view.overlay.previewNodes, palette)
    }
    drawItems(ctx, vp, viewDoc, palette)
    drawRoomLabels(ctx, vp, rooms, palette)
    if (view.overlay?.roomDraft) drawRoomDraft(ctx, vp, view.overlay.roomDraft, palette)
    drawWallLengths(ctx, vp, lengthLabelSegments(viewDoc, rooms, geometry.faces, view), palette)
    if (view.overlay?.mergeTarget) drawMergeRing(ctx, vp, viewDoc, palette, view.overlay.mergeTarget)
  })

  // guides to last, in screen space (like the grid) so they stay 1px-crisp on top
  if (view.overlay?.guides?.length) drawGuides(ctx, vp, view.overlay.guides, palette)
}

/** Dash pattern (screen px) marking a guide as a construction line, not a wall. */
const GUIDE_DASH = [4, 3]

/**
 * Snap guides: thin dashed accent lines drawn in screen space, on top of the
 * scene. Alignment guides span the whole viewport; an axis guide is the full
 * construction line through its anchor at the snapped angle. Directions survive
 * world→screen unchanged because the transform is a uniform, unrotated scale.
 */
function drawGuides(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  guides: Guide[],
  palette: EditorPalette,
): void {
  ctx.save()
  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 1
  ctx.setLineDash(GUIDE_DASH)
  const reach = vp.width + vp.height // any length that clears the viewport
  for (const guide of guides) {
    ctx.beginPath()
    if (guide.kind === 'vertical') {
      const sx = worldToScreen(vp, { x: guide.x, y: 0 }).x
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, vp.height)
    } else if (guide.kind === 'horizontal') {
      const sy = worldToScreen(vp, { x: 0, y: guide.y }).y
      ctx.moveTo(0, sy)
      ctx.lineTo(vp.width, sy)
    } else if (guide.kind === 'edge') {
      // highlight the target wall along its body, not an infinite construction line
      const a = worldToScreen(vp, guide.a)
      const b = worldToScreen(vp, guide.b)
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    } else {
      const from = worldToScreen(vp, guide.from)
      const dx = Math.cos(guide.angle)
      const dy = Math.sin(guide.angle)
      ctx.moveTo(from.x - dx * reach, from.y - dy * reach)
      ctx.lineTo(from.x + dx * reach, from.y + dy * reach)
    }
    ctx.stroke()
  }
  ctx.restore()
}

/** Render-only copy of the doc with some node positions overridden. */
function withMovedNodes(doc: SceneDocument, moved: Record<NodeId, Vec2>): SceneDocument {
  const nodes = { ...doc.nodes }
  for (const [id, pos] of Object.entries(moved)) {
    const node = nodes[id]
    if (node) nodes[id] = { ...node, pos }
  }
  return { ...doc, nodes }
}

/** Render-only copy of the doc with one opening slid along its wall (and, for a
 *  door, swung to a new side). */
function withMovedOpening(
  doc: SceneDocument,
  moved: { id: string; offset: number; side?: SwingSide },
): SceneDocument {
  const walls = doc.walls.map((wall) =>
    wall.openings.some((opening) => opening.id === moved.id)
      ? {
          ...wall,
          openings: wall.openings.map((opening) =>
            opening.id === moved.id
              ? { ...opening, offset: moved.offset, side: moved.side ?? opening.side }
              : opening,
          ),
        }
      : wall,
  )
  return { ...doc, walls }
}

/** The ghost — a wall or a room's corner loop — as a flat list of segments. */
function ghostSegments(overlay: ToolOverlay | null | undefined): { a: Vec2; b: Vec2 }[] | null {
  if (overlay?.ghostRoom) return loopEdges(overlay.ghostRoom)
  if (overlay?.ghostWall) return [overlay.ghostWall]
  return null
}

/** Connects an ordered corner loop into its edges (the last back to the first). */
function loopEdges(corners: Vec2[]): { a: Vec2; b: Vec2 }[] {
  return corners.map((a, i) => ({ a, b: corners[(i + 1) % corners.length]! }))
}

/** Snap radius (cm) used to match a ghost endpoint onto an existing node. */
const GHOST_SNAP = 0.5
const GHOST_ID = '__ghost__'

/**
 * Returns a render-only copy of the doc with the in-progress ghost walls
 * appended: corners shared between segments collapse to one node, and any
 * endpoint landing on an existing node reuses it, so the ghost miters against
 * itself and the scene. Null when no non-degenerate segment survives.
 */
function augmentWithGhost(
  doc: SceneDocument,
  segs: { a: Vec2; b: Vec2 }[],
): { doc: SceneDocument; ghostIds: Set<string> } | null {
  const nodes = { ...doc.nodes }
  const corners = new Map<string, NodeId>()
  const resolve = (p: Vec2): NodeId => {
    const existing = nodeAt(doc, p, GHOST_SNAP)
    if (existing) return existing.id
    const key = `${p.x}:${p.y}`
    let id = corners.get(key)
    if (id === undefined) {
      id = `${GHOST_ID}${corners.size}`
      corners.set(key, id)
      nodes[id] = { id, pos: p }
    }
    return id
  }
  const walls = [...doc.walls]
  const ghostIds = new Set<string>()
  segs.forEach((seg, i) => {
    const a = resolve(seg.a)
    const b = resolve(seg.b)
    if (a === b) return
    const id = `${GHOST_ID}wall${i}`
    // a ghost wall is openings-free by construction — nothing has been placed in
    // it yet, so every openings lookup keyed by wall id simply misses it
    walls.push({ id, a, b, thickness: WALL_THICKNESS, height: WALL_HEIGHT, openings: [] })
    ghostIds.add(id)
  })
  if (ghostIds.size === 0) return null
  return { doc: { ...doc, nodes, walls }, ghostIds }
}

/**
 * Grid is drawn in screen space so lines stay crisp at any zoom. Tiers are
 * painted fine -> strong, so coarser (darker) lines overpaint the finer ones
 * at shared positions.
 */
function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, palette: EditorPalette): void {
  const topLeft = screenToWorld(vp, { x: 0, y: 0 })
  const bottomRight = screenToWorld(vp, { x: vp.width, y: vp.height })

  ctx.lineWidth = 1
  for (const tier of GRID_TIERS) {
    if (tier.step * vp.zoom < MIN_LINE_GAP_PX) continue
    ctx.strokeStyle = palette[tier.color]

    for (let x = Math.floor(topLeft.x / tier.step) * tier.step; x <= bottomRight.x; x += tier.step) {
      const sx = Math.round(worldToScreen(vp, { x, y: 0 }).x) + 0.5
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, vp.height)
      ctx.stroke()
    }
    for (let y = Math.floor(topLeft.y / tier.step) * tier.step; y <= bottomRight.y; y += tier.step) {
      const sy = Math.round(worldToScreen(vp, { x: 0, y }).y) + 0.5
      ctx.beginPath()
      ctx.moveTo(0, sy)
      ctx.lineTo(vp.width, sy)
      ctx.stroke()
    }
  }
}

/** Runs fn with the canvas transformed so drawing coordinates are world cm. */
function withWorldTransform(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  dpr: number,
  fn: () => void,
): void {
  ctx.save()
  ctx.setTransform(
    dpr * vp.zoom,
    0,
    0,
    dpr * vp.zoom,
    dpr * (vp.width / 2 - vp.pan.x * vp.zoom),
    dpr * (vp.height / 2 - vp.pan.y * vp.zoom),
  )
  fn()
  ctx.restore()
}

/** Selected-room fill: accent at low alpha, echoing the ghost wall's translucent accent. */
const SELECTED_ROOM_ALPHA = 0.25
/** Hovered-room wash: lighter than the selected fill, so hover reads as pre-selection. */
const ROOM_HOVER_ALPHA = 0.18

/**
 * Fills every closed wall contour, largest first so a loop nested inside a
 * room stays visible on top. Rooms are recomputed per repaint like the wall
 * miters — both walk the same graph and neither is worth caching at this
 * scene size.
 */
function drawRooms(
  ctx: CanvasRenderingContext2D,
  rooms: Room[],
  palette: EditorPalette,
  selectedKey: string | null,
  hoveredKey: string | null,
): void {
  for (const room of rooms) {
    const key = roomKey(room)
    if (selectedKey !== null && key === selectedKey) {
      ctx.globalAlpha = SELECTED_ROOM_ALPHA
      ctx.fillStyle = palette.accent
      fillRoomShape(ctx, room)
      ctx.globalAlpha = 1
    } else if (hoveredKey !== null && key === hoveredKey) {
      ctx.globalAlpha = ROOM_HOVER_ALPHA
      ctx.fillStyle = palette.accent
      fillRoomShape(ctx, room)
      ctx.globalAlpha = 1
    } else {
      ctx.fillStyle = palette.room
      fillRoomShape(ctx, room)
    }
  }
}

/** Fills the room's floor: contour with the nested-loop holes carved out. */
function fillRoomShape(ctx: CanvasRenderingContext2D, room: Room): void {
  ctx.beginPath()
  tracePoly(ctx, room.polygon)
  for (const hole of room.holes) tracePoly(ctx, hole)
  ctx.fill('evenodd')
}

/** Room label: constant screen size, like the node dots. */
const ROOM_LABEL_FONT_PX = 12
/** Mirrors --font-sans; canvas text can't read CSS custom properties. */
const ROOM_LABEL_FONT = "'Nunito Sans Variable', ui-sans-serif, system-ui, sans-serif"
/** Breathing room (screen px) the label needs inside the room's bbox to show at all. */
const ROOM_LABEL_PADDING_PX = 8

/**
 * Writes each room's area (m²) at its centroid. A label is skipped when the
 * room can't fit it on screen (small room or far zoom — they reappear on zoom
 * in) and when the centroid falls outside a strongly concave contour.
 */
function drawRoomLabels(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  rooms: Room[],
  palette: EditorPalette,
): void {
  const fontSize = ROOM_LABEL_FONT_PX / vp.zoom // world cm that render as 12px
  const pad = ROOM_LABEL_PADDING_PX / vp.zoom
  ctx.font = `${fontSize}px ${ROOM_LABEL_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = palette.roomLabel
  for (const room of rooms) {
    const center = polygonCentroid(room.polygon)
    if (!pointInPolygon(center, room.polygon)) continue
    // e.g. concentric rooms: the centroid lands in the hole, not on this floor
    if (room.holes.some((hole) => pointInPolygon(center, hole))) continue
    const text = `${squareCmToM2(room.area)} m²`
    let min = { x: Infinity, y: Infinity }
    let max = { x: -Infinity, y: -Infinity }
    for (const p of room.polygon) {
      min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y) }
      max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y) }
    }
    const fitsX = ctx.measureText(text).width + pad <= max.x - min.x
    const fitsY = fontSize * 1.4 + pad <= max.y - min.y
    if (fitsX && fitsY) ctx.fillText(text, center.x, center.y)
  }
}

/** Wall length label: constant screen size, slightly smaller than area labels. */
const WALL_LENGTH_FONT_PX = 11
/** Screen gap between the wall face and its length label. */
const WALL_LENGTH_GAP_PX = 6

/** The number a length label displays (cm, same rounding as the inspector). */
function displayLength(seg: readonly [Vec2, Vec2]): number {
  return Math.round(Math.hypot(seg[1].x - seg[0].x, seg[1].y - seg[0].y) * 10) / 10
}

/** One face label of a selected wall. Exported for tests. */
export interface FaceLabel {
  side: 'left' | 'right'
  /** the mitered face, oriented so its (-dy, dx) normal points away from the wall body */
  seg: readonly [Vec2, Vec2]
  /** the number the label shows (cm, inspector rounding) */
  value: number
}

/**
 * The selected wall's face labels after dedup: the right one earns its place
 * only by reading differently — on a free-standing wall (or a symmetric
 * junction) it would repeat the left. One source for the renderer and the
 * label hit-test, so a label is clickable exactly where it is drawn.
 */
export function wallFaceLabels(faces: WallFaces): FaceLabel[] {
  const left = displayLength(faces.left)
  const labels: FaceLabel[] = [{ side: 'left', seg: [faces.left[0]!, faces.left[1]!], value: left }]
  const right = displayLength(faces.right)
  if (right !== left) {
    labels.push({ side: 'right', seg: [faces.right[1]!, faces.right[0]!], value: right })
  }
  return labels
}

/** Clickable halo around a face label (screen px) — and the padding of the pill
 * drawn behind it, so the chip shows exactly the area a click will hit. */
const FACE_LABEL_PAD_PX = 4

/** A face label under the pointer — the entry point of on-canvas dimension editing. */
export interface FaceLabelHit {
  side: 'left' | 'right'
  /** the number the label shows (cm) */
  value: number
  /** world position of the label's centre, where an editing overlay belongs */
  center: Vec2
}

/**
 * The face label of a selected wall under a world point, honouring the same
 * visibility rules the renderer applies (dedup and the must-fit cutoff) — a
 * label can be clicked exactly when it can be seen. Needs the ctx only to
 * measure text in the label font.
 */
export function faceLabelAt(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  faces: WallFaces,
  point: Vec2,
): FaceLabelHit | undefined {
  ctx.save()
  ctx.font = `${WALL_LENGTH_FONT_PX / vp.zoom}px ${ROOM_LABEL_FONT}`
  try {
    for (const label of wallFaceLabels(faces)) {
      const [a, b] = label.seg
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (len === 0) continue
      const textWidth = ctx.measureText(`${label.value} cm`).width
      if (textWidth > len * 0.9) continue // hidden by the fit rule → not clickable
      const offset = (WALL_LENGTH_GAP_PX + WALL_LENGTH_FONT_PX / 2) / vp.zoom
      const center = {
        x: (a.x + b.x) / 2 - (dy / len) * offset,
        y: (a.y + b.y) / 2 + (dx / len) * offset,
      }
      // the point in the label's own frame: u along the text, v across it
      const u = ((point.x - center.x) * dx + (point.y - center.y) * dy) / len
      const v = ((point.x - center.x) * -dy + (point.y - center.y) * dx) / len
      const pad = FACE_LABEL_PAD_PX / vp.zoom
      const halfHeight = WALL_LENGTH_FONT_PX / vp.zoom / 2
      if (Math.abs(u) <= textWidth / 2 + pad && Math.abs(v) <= halfHeight + pad) {
        return { side: label.side, value: label.value, center }
      }
    }
  } finally {
    ctx.restore()
  }
  return undefined
}

/** A measured segment to label with its length. */
interface LengthSegment {
  a: Vec2
  b: Vec2
  /** extra world offset past the measured line (the ghost measures its axis) */
  clearance: number
  /** hide the label when it is wider than the wall; the ghost always shows */
  mustFit: boolean
  /** draw as a pill — marks the label as clickable (a selected wall's dimensions) */
  chip?: boolean
  /** the pointer is over this chip: tint it so the click target answers back */
  hover?: boolean
}

/** Accent wash inside a hovered chip — the same idiom as the selection washes. */
const FACE_LABEL_HOVER_ALPHA = 0.12

/**
 * Length labels appear only in interactive contexts, and all but the ghost
 * measure mitered faces, not axes: the ghost shows its axis (joints are not
 * final until commit, and snapping works on axes), the selected wall shows
 * both faces — each labelled on its own side, collapsed to one label when
 * both would read the same (a free-standing wall, a symmetric junction) —
 * and the selected room shows the room-facing face of every contour wall.
 * Segments are ordered so their (-dy, dx) normal points away from the wall body.
 */
function lengthLabelSegments(
  doc: SceneDocument,
  rooms: Room[],
  faces: Map<string, WallFaces>,
  view: RenderView,
): LengthSegment[] {
  const selection = view.selection
  const segments: LengthSegment[] = []
  if (view.overlay?.ghostWall) {
    segments.push({ ...view.overlay.ghostWall, clearance: WALL_THICKNESS / 2, mustFit: false })
  }
  // a divider has no body, so its ruler sits right on the line (no clearance)
  if (view.overlay?.ghostDivider) {
    segments.push({ ...view.overlay.ghostDivider, clearance: 0, mustFit: false })
  }
  // each edge of a room being drawn is its own live ruler, like the wall ghost
  if (view.overlay?.ghostRoom) {
    for (const edge of loopEdges(view.overlay.ghostRoom)) {
      segments.push({ ...edge, clearance: WALL_THICKNESS / 2, mustFit: false })
    }
  }
  if (selection?.kind === 'wall') {
    const face = faces.get(selection.id)
    if (face) {
      for (const label of wallFaceLabels(face)) {
        // chip: these labels open the on-canvas editor, and should look like it
        segments.push({
          a: label.seg[0],
          b: label.seg[1],
          clearance: 0,
          mustFit: true,
          chip: true,
          hover: label.side === view.hoveredFaceLabel,
        })
      }
    }
  }
  if (selection?.kind === 'room') {
    const room = rooms.find((r) => roomKey(r) === selection.id)
    if (room) {
      const pair = (a: NodeId, b: NodeId) => (a < b ? `${a}:${b}` : `${b}:${a}`)
      const byPair = new Map(doc.walls.map((w) => [pair(w.a, w.b), w]))
      for (let i = 0; i < room.nodeIds.length; i++) {
        const from = room.nodeIds[i]!
        const to = room.nodeIds[(i + 1) % room.nodeIds.length]!
        const wall = byPair.get(pair(from, to))
        const face = wall && faces.get(wall.id)
        if (!face) continue
        // the room lies on the (-dy, dx) side of from→to, so that side's face,
        // oriented along from→to, is the interior one
        const seg = wall!.a === from ? face.left : ([face.right[1], face.right[0]] as const)
        segments.push({ a: seg[0], b: seg[1], clearance: 0, mustFit: true })
      }
    }
  }
  return segments
}

/**
 * Writes each segment's length (cm, same rounding as the inspector) along it
 * at its midpoint, offset to the segment's (-dy, dx) side — into the room for
 * contour faces. Text flips to stay upright.
 */
function drawWallLengths(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  segments: LengthSegment[],
  palette: EditorPalette,
): void {
  if (segments.length === 0) return
  const fontSize = WALL_LENGTH_FONT_PX / vp.zoom
  ctx.font = `${fontSize}px ${ROOM_LABEL_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = palette.accent
  for (const seg of segments) {
    const dx = seg.b.x - seg.a.x
    const dy = seg.b.y - seg.a.y
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    const text = `${displayLength([seg.a, seg.b])} cm`
    const textWidth = ctx.measureText(text).width
    if (seg.mustFit && textWidth > len * 0.9) continue
    const offset = seg.clearance + (WALL_LENGTH_GAP_PX + WALL_LENGTH_FONT_PX / 2) / vp.zoom
    const x = (seg.a.x + seg.b.x) / 2 - (dy / len) * offset
    const y = (seg.a.y + seg.b.y) / 2 + (dx / len) * offset
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(uprightAngle(dx, dy))
    if (seg.chip) {
      // a pill behind an editable dimension marks it as clickable; its bounds
      // are the label's hit area, so the affordance never lies about the target
      const pad = FACE_LABEL_PAD_PX / vp.zoom
      ctx.beginPath()
      ctx.roundRect(
        -textWidth / 2 - pad,
        -fontSize / 2 - pad,
        textWidth + pad * 2,
        fontSize + pad * 2,
        (FACE_LABEL_PAD_PX + 2) / vp.zoom,
      )
      ctx.fillStyle = palette.background
      ctx.fill()
      if (seg.hover) {
        // answer the pointer: a light accent wash and a firmer border
        ctx.globalAlpha = FACE_LABEL_HOVER_ALPHA
        ctx.fillStyle = palette.accent
        ctx.fill()
        ctx.globalAlpha = 1
      }
      ctx.strokeStyle = palette.accent
      ctx.lineWidth = (seg.hover ? 1.5 : 1) / vp.zoom
      ctx.stroke()
      ctx.fillStyle = palette.accent
    }
    ctx.fillText(text, 0, 0)
    ctx.restore()
  }
}

/**
 * Rotation for a label along (dx, dy), in the drawing convention: horizontal
 * text runs left-to-right and vertical text bottom-to-top, whichever way the
 * segment points — so the two faces of one wall always read the same way.
 * Exported for tests only.
 */
export function uprightAngle(dx: number, dy: number): number {
  const angle = Math.atan2(dy, dx)
  if (angle >= Math.PI / 2) return angle - Math.PI
  if (angle < -Math.PI / 2) return angle + Math.PI
  return angle
}

/** Draft room readout size (screen px), matching the wall length labels. */
const ROOM_DRAFT_FONT_PX = 11
/** Screen gap between the dragged corner and its size readout. */
const ROOM_DRAFT_GAP_PX = 6

/**
 * A room being drawn that is still too small to place: a thin accent outline
 * (no walls, no fill) plus one compact `W × H` readout by the dragged corner, so
 * the gesture reads from its first pixel even before it clears the placement
 * threshold — including a wide-but-shallow drag the full ghost would hide. The
 * label sits diagonally outside the corner, on whichever side the drag opened.
 */
function drawRoomDraft(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  corners: Vec2[],
  palette: EditorPalette,
): void {
  if (corners.length < 4) return
  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 1 / vp.zoom
  ctx.beginPath()
  tracePoly(ctx, corners)
  ctx.stroke()

  const a = corners[0]!
  const c = corners[2]! // the dragged corner, opposite the anchor
  const w = Math.round(Math.abs(c.x - a.x) * 10) / 10
  const h = Math.round(Math.abs(c.y - a.y) * 10) / 10
  const gap = ROOM_DRAFT_GAP_PX / vp.zoom
  ctx.font = `${ROOM_DRAFT_FONT_PX / vp.zoom}px ${ROOM_LABEL_FONT}`
  ctx.fillStyle = palette.accent
  ctx.textAlign = c.x >= a.x ? 'left' : 'right'
  ctx.textBaseline = c.y >= a.y ? 'top' : 'bottom'
  ctx.fillText(`${w} × ${h} cm`, c.x + (c.x >= a.x ? gap : -gap), c.y + (c.y >= a.y ? gap : -gap))
}

/** Accent wash over a hovered (but unselected) wall — the pre-selection cue. */
const WALL_HOVER_ALPHA = 0.3
/** Accent outline (screen px) around a hovered wall, so the cue stays obvious. */
const WALL_HOVER_OUTLINE_PX = 1.5

/**
 * Each wall is one filled polygon, mitered at shared nodes so neighbours tile
 * without overlap or notch; too-sharp corners get a flat bevel (see wallJoints).
 * Plain walls are drawn first, then the selected (accent) and ghost (translucent
 * accent) walls on top so they sit above any neighbour they miter against.
 */
function drawWalls(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: SceneDocument,
  geometry: WallGeometry,
  openings: Map<string, FittedOpening[]>,
  palette: EditorPalette,
  selectedWallId: string | null,
  hoveredWallId: string | null,
  ghostIds: Set<string> | null,
): void {
  const { polygons } = geometry
  const isGhost = (id: string): boolean => ghostIds?.has(id) ?? false
  const isFront = (id: string): boolean => id === selectedWallId || isGhost(id)

  const holesOf = (wall: Wall): Vec2[][] =>
    (openings.get(wall.id) ?? []).map((fitted) => openingRect(fitted.span, wall.thickness))

  const front: Wall[] = []
  ctx.globalAlpha = 1
  ctx.fillStyle = palette.wall
  for (const wall of doc.walls) {
    const poly = polygons.get(wall.id)
    if (!poly) continue
    if (isFront(wall.id)) {
      front.push(wall)
      continue
    }
    fillWallShape(ctx, poly, holesOf(wall))
  }
  // a hovered but unselected wall gets an accent wash plus an accent outline over
  // its grey body — an obvious pre-selection cue, still short of the solid fill a
  // selected wall carries
  const hoverWall = doc.walls.find((wall) => wall.id === hoveredWallId)
  if (hoverWall && !isFront(hoverWall.id)) {
    const poly = polygons.get(hoverWall.id)
    if (poly) {
      const holes = holesOf(hoverWall)
      ctx.globalAlpha = WALL_HOVER_ALPHA
      ctx.fillStyle = palette.accent
      fillWallShape(ctx, poly, holes)
      ctx.globalAlpha = 1
      ctx.strokeStyle = palette.accent
      ctx.lineWidth = WALL_HOVER_OUTLINE_PX / vp.zoom
      ctx.beginPath()
      tracePoly(ctx, poly)
      ctx.stroke()
    }
  }
  for (const wall of front) {
    ctx.globalAlpha = isGhost(wall.id) ? 0.5 : 1
    ctx.fillStyle = palette.accent
    fillWallShape(ctx, polygons.get(wall.id)!, holesOf(wall))
  }
  ctx.globalAlpha = 1
}

/**
 * Fills a wall: its mitred ring with its openings carved out — the same evenodd
 * trace the room floors use for their holes.
 *
 * The gap is a real hole, not a patch of background: rooms are drawn before the
 * walls, so painting over it would scrub out the floor showing through the
 * doorway (which is exactly what you want to see through it).
 */
function fillWallShape(ctx: CanvasRenderingContext2D, ring: Vec2[], holes: Vec2[][]): void {
  if (ring.length === 0) return
  ctx.beginPath()
  tracePoly(ctx, ring)
  for (const hole of holes) tracePoly(ctx, hole)
  ctx.fill('evenodd')
}

/** Zoning divider line: constant screen width and dash, like a guide, since it
 *  marks a boundary rather than a wall body. */
const DIVIDER_WIDTH_PX = 1.5
const DIVIDER_DASH_PX = [6, 4]
/** The divider being placed reads as a ghost: the same translucent accent the wall ghost uses. */
const GHOST_DIVIDER_ALPHA = 0.6

/**
 * Zoning dividers: a thin dashed line along each divider's centerline, plus the
 * one being drawn (translucent accent). Zero thickness means there is no body to
 * fill — the line is the whole mark. Drawn over the room fills, so the boundary
 * reads on top of the two zones it separates. Widths and dashes are divided by
 * zoom so they stay constant on screen inside the world transform.
 */
function drawDividers(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: SceneDocument,
  palette: EditorPalette,
  ghost: { a: Vec2; b: Vec2 } | null | undefined,
  active: { selectedId: string | null; hoveredId: string | null } = {
    selectedId: null,
    hoveredId: null,
  },
): void {
  if (doc.dividers.length === 0 && !ghost) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.setLineDash(DIVIDER_DASH_PX.map((d) => d / vp.zoom))
  for (const divider of doc.dividers) {
    const a = doc.nodes[divider.a]?.pos
    const b = doc.nodes[divider.b]?.pos
    if (!a || !b) continue
    // selected and hovered dividers switch to accent; a selected one is bolder
    const selected = divider.id === active.selectedId
    const accented = selected || divider.id === active.hoveredId
    ctx.strokeStyle = accented ? palette.accent : palette.divider
    ctx.lineWidth = (DIVIDER_WIDTH_PX * (selected ? 1.8 : 1)) / vp.zoom
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  if (ghost) {
    ctx.lineWidth = DIVIDER_WIDTH_PX / vp.zoom
    ctx.globalAlpha = GHOST_DIVIDER_ALPHA
    ctx.strokeStyle = palette.accent
    ctx.beginPath()
    ctx.moveTo(ghost.a.x, ghost.a.y)
    ctx.lineTo(ghost.b.x, ghost.b.y)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

/** Stroke width (screen px) of the door/window symbols drawn inside the gaps. */
const OPENING_SYMBOL_PX = 1
/** How far off the centerline the two glazing lines of a window sit, as a share
 *  of the wall's thickness — enough to read as a pane, narrow enough to stay clear
 *  of the jambs. */
const WINDOW_PANE_INSET = 1 / 6

/** The plan symbol for a door: the leaf standing open, and the arc it sweeps. */
export interface DoorSwing {
  /** the jamb the door is hung on (the one nearer node A) */
  hinge: Vec2
  /** the tip of the leaf when the door stands fully open, square to the wall */
  leafTip: Vec2
  /** the far jamb — where the arc lands, i.e. the door shut */
  latch: Vec2
  radius: number
  startAngle: number
  endAngle: number
  counterclockwise: boolean
}

/**
 * The door's leaf and swing arc: hinged on the jamb nearer node A, opening a
 * quarter turn to `side`. The arc runs from the open leaf back to the far jamb,
 * so its radius is the door's own width — the way a plan draws it.
 */
export function doorSwing(span: OpeningSpan, side: SwingSide): DoorSwing {
  const radius = span.end - span.start
  const swing = { x: -span.axis.y * side, y: span.axis.x * side }
  const hinge = span.jambA
  const leafTip = { x: hinge.x + swing.x * radius, y: hinge.y + swing.y * radius }

  const startAngle = Math.atan2(swing.y, swing.x)
  const endAngle = Math.atan2(span.axis.y, span.axis.x)
  // the two are a quarter turn apart; sweep the short way round, whichever way
  // that is once the wall's direction and the swing side are taken together
  let delta = endAngle - startAngle
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta <= -Math.PI) delta += 2 * Math.PI

  return {
    hinge,
    leafTip,
    latch: span.jambB,
    radius,
    startAngle,
    endAngle,
    counterclockwise: delta < 0,
  }
}

/** The window's two glazing lines, each running jamb to jamb alongside the centerline. */
export function windowPanes(span: OpeningSpan, thickness: number): [Vec2, Vec2][] {
  const inset = thickness * WINDOW_PANE_INSET
  const left = { x: -span.axis.y, y: span.axis.x }
  const pane = (sign: SwingSide): [Vec2, Vec2] => [
    { x: span.jambA.x + left.x * inset * sign, y: span.jambA.y + left.y * inset * sign },
    { x: span.jambB.x + left.x * inset * sign, y: span.jambB.y + left.y * inset * sign },
  ]
  return [pane(1), pane(-1)]
}

/**
 * Which way a door should open: into the room, when exactly one side of it is one.
 *
 * Probes just past each face at the door's midpoint. A door between two rooms (or
 * between none) has no better answer, so it falls back to the wall's left — an
 * arbitrary but stable convention, not a guess dressed up as one.
 */
export function doorSwingSide(rooms: Room[], span: OpeningSpan, thickness: number): SwingSide {
  const mid = {
    x: (span.jambA.x + span.jambB.x) / 2,
    y: (span.jambA.y + span.jambB.y) / 2,
  }
  const left = { x: -span.axis.y, y: span.axis.x }
  const reach = thickness / 2 + 1
  const probe = (sign: SwingSide): Vec2 => ({
    x: mid.x + left.x * reach * sign,
    y: mid.y + left.y * reach * sign,
  })

  const onLeft = insideAnyRoom(rooms, probe(1))
  const onRight = insideAnyRoom(rooms, probe(-1))
  if (onRight && !onLeft) return -1
  return 1
}

/**
 * Wash of accent marking the selected opening. It has to be translucent, like a
 * selected room's: an opening is a hole, and an opaque fill would plug it,
 * covering the very floor you cut the doorway to see through.
 */
const SELECTED_OPENING_ALPHA = 0.25
/** Hovered-opening wash: lighter than the selected one, so hover reads as pre-selection. */
const OPENING_HOVER_ALPHA = 0.16

/** Door and window symbols, drawn inside the gaps the walls were cut open for. */
function drawOpenings(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: SceneDocument,
  openings: Map<string, FittedOpening[]>,
  rooms: Room[],
  palette: EditorPalette,
  selectedOpeningId: string | null,
  hoveredOpeningId: string | null,
): void {
  if (openings.size === 0) return
  ctx.lineWidth = OPENING_SYMBOL_PX / vp.zoom
  ctx.lineCap = 'round'

  for (const wall of doc.walls) {
    for (const { opening, span } of openings.get(wall.id) ?? []) {
      const selected = opening.id === selectedOpeningId
      // a selected opening washes solid; a merely hovered one washes lighter
      const washAlpha = selected
        ? SELECTED_OPENING_ALPHA
        : opening.id === hoveredOpeningId
          ? OPENING_HOVER_ALPHA
          : 0
      if (washAlpha > 0) {
        ctx.globalAlpha = washAlpha
        ctx.fillStyle = palette.accent
        ctx.beginPath()
        tracePoly(ctx, openingRect(span, wall.thickness))
        ctx.fill()
        ctx.globalAlpha = 1
      }

      // the side placement chose, else derived into the room (windows ignore it)
      const side =
        opening.side ??
        (opening.kind === 'door' ? doorSwingSide(rooms, span, wall.thickness) : 1)
      ctx.strokeStyle = selected ? palette.accent : palette.opening
      traceOpeningSymbol(ctx, opening.kind, span, wall.thickness, side)
      ctx.stroke()
    }
  }
}

/**
 * Traces a door's swing (leaf + arc) or a window's two panes into the current
 * path, ready to stroke. Shared by the placed openings and the placement ghost
 * so the preview draws the exact symbol the committed opening will.
 */
function traceOpeningSymbol(
  ctx: CanvasRenderingContext2D,
  kind: OpeningKind,
  span: OpeningSpan,
  thickness: number,
  side: SwingSide,
): void {
  ctx.beginPath()
  if (kind === 'window') {
    for (const [from, to] of windowPanes(span, thickness)) {
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
    }
  } else {
    const swing = doorSwing(span, side)
    ctx.moveTo(swing.hinge.x, swing.hinge.y)
    ctx.lineTo(swing.leafTip.x, swing.leafTip.y)
    ctx.arc(
      swing.hinge.x,
      swing.hinge.y,
      swing.radius,
      swing.startAngle,
      swing.endAngle,
      swing.counterclockwise,
    )
  }
}

/** Symbol opacity of the placement ghost — stronger than its wash, still clearly a preview. */
const GHOST_OPENING_ALPHA = 0.6

/**
 * The door/window placement preview: a translucent accent wash over the cut it
 * would make, plus its symbol. The span is resolved by the tool — snapped onto a
 * wall or floating free at the cursor — so this just draws it. An overlay (the
 * wall is never actually carved), so it reads as a ghost and costs nothing to
 * redraw as the pointer moves.
 */
function drawGhostOpening(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  ghost: GhostOpening,
  palette: EditorPalette,
): void {
  const { span, thickness } = ghost
  ctx.globalAlpha = SELECTED_OPENING_ALPHA
  ctx.fillStyle = palette.accent
  ctx.beginPath()
  tracePoly(ctx, openingRect(span, thickness))
  ctx.fill()

  ctx.globalAlpha = GHOST_OPENING_ALPHA
  ctx.strokeStyle = palette.accent
  ctx.lineWidth = OPENING_SYMBOL_PX / vp.zoom
  ctx.lineCap = 'round'
  traceOpeningSymbol(ctx, ghost.kind, span, thickness, ghost.side)
  ctx.stroke()
  ctx.globalAlpha = 1
}

/** Appends one closed ring to the current path (no fill). */
function tracePoly(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
  if (pts.length === 0) return
  ctx.moveTo(pts[0]!.x, pts[0]!.y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y)
  ctx.closePath()
}

/** Vertex dot radius in screen px, zoom-independent like Figma's anchor handles. */
const NODE_RADIUS_PX = 4
/** The selected vertex is drawn larger, so it reads differently from the
 * accent dots that mark the endpoints of a selected wall. */
const SELECTED_NODE_SCALE = 1.5
/** Radius (screen px) of the accent ring around a hovered (unselected) vertex. */
const NODE_HOVER_RING_PX = 7

/** Draws a dot at every node referenced by a wall, on top of the strokes. */
function drawWallNodes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: SceneDocument,
  palette: EditorPalette,
  selectedWallId: string | null,
  selectedNodeId: NodeId | null,
  hoveredNodeId: NodeId | null,
): void {
  const radius = NODE_RADIUS_PX / vp.zoom
  // accent both endpoints of a selected wall, or the one selected node
  const selected = new Set<string>()
  if (selectedNodeId) selected.add(selectedNodeId)
  const used = new Set<string>()
  for (const wall of doc.walls) {
    used.add(wall.a)
    used.add(wall.b)
    if (wall.id === selectedWallId) {
      selected.add(wall.a)
      selected.add(wall.b)
    }
  }
  ctx.strokeStyle = palette.background
  ctx.lineWidth = 1 / vp.zoom
  for (const id of used) {
    const node = doc.nodes[id]
    if (!node) continue
    ctx.fillStyle = selected.has(id) ? palette.accent : palette.wall
    ctx.beginPath()
    const r = id === selectedNodeId ? radius * SELECTED_NODE_SCALE : radius
    ctx.arc(node.pos.x, node.pos.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  // a hovered but unselected vertex gets a thin accent ring — lighter than the
  // solid accent dot a selected vertex becomes
  if (hoveredNodeId && hoveredNodeId !== selectedNodeId && used.has(hoveredNodeId)) {
    const node = doc.nodes[hoveredNodeId]
    if (node) {
      ctx.strokeStyle = palette.accent
      ctx.lineWidth = 1.5 / vp.zoom
      ctx.beginPath()
      ctx.arc(node.pos.x, node.pos.y, NODE_HOVER_RING_PX / vp.zoom, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

/** Ring radius (screen px) marking the vertex a dragged vertex will weld into. */
const MERGE_RING_PX = 9

/** Drawn last so the ring sits above the dot pile-up at the weld point. */
function drawMergeRing(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: SceneDocument,
  palette: EditorPalette,
  nodeId: NodeId,
): void {
  const node = doc.nodes[nodeId]
  if (!node) return
  ctx.strokeStyle = palette.accent
  ctx.lineWidth = 2 / vp.zoom
  ctx.beginPath()
  ctx.arc(node.pos.x, node.pos.y, MERGE_RING_PX / vp.zoom, 0, Math.PI * 2)
  ctx.stroke()
}

/**
 * Preview node dots the split tool drops where an endpoint has snapped onto a
 * wall or vertex — accent fill with the background ring the real node dots use,
 * so they read as "the divider will attach here" while it is being drawn.
 */
function drawPreviewNodes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  points: Vec2[],
  palette: EditorPalette,
): void {
  const radius = NODE_RADIUS_PX / vp.zoom
  ctx.fillStyle = palette.accent
  ctx.strokeStyle = palette.background
  ctx.lineWidth = 1 / vp.zoom
  for (const point of points) {
    ctx.beginPath()
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}

/** Each item is drawn in its own stored colour — the palette only supplies the outline. */
function drawItems(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: SceneDocument,
  palette: EditorPalette,
): void {
  for (const item of doc.items) {
    ctx.save()
    ctx.translate(item.pos.x, item.pos.y)
    ctx.rotate(item.rotation)
    ctx.fillStyle = item.color
    ctx.fillRect(-item.size.x / 2, -item.size.y / 2, item.size.x, item.size.y)
    ctx.lineWidth = 1 / vp.zoom
    ctx.strokeStyle = palette.itemStroke
    ctx.strokeRect(-item.size.x / 2, -item.size.y / 2, item.size.x, item.size.y)
    ctx.restore()
  }
}
