import { pointInPolygon, polygonCentroid } from '../domain/geometry'
import { nodeAt } from '../domain/operations'
import type { Guide } from '../domain/snapping'
import { detectRooms, roomKey, type Room } from '../domain/rooms'
import { squareCmToM2, WALL_HEIGHT, WALL_THICKNESS } from '../domain/units'
import type { NodeId, SceneDocument, Vec2 } from '../domain/types'
import type { Selection, ToolOverlay } from '../tools/types'
import { screenToWorld, worldToScreen, type Viewport } from './viewport'
import { computeWallGeometry, type WallFaces, type WallGeometry } from '../domain/wallJoints'

export interface CanvasPalette {
  background: string
  gridFine: string
  gridMid: string
  gridStrong: string
  room: string
  roomLabel: string
  wall: string
  accent: string
}

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
}

/** Full repaint: background, grid, then the document in layer order. */
export function render(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: SceneDocument,
  palette: CanvasPalette,
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
  // The doc as the user currently sees it: a drag preview overrides node
  // positions on a render-only copy, so the real document stays untouched
  // until the move is committed as a command.
  const viewDoc = view.overlay?.movedNodes ? withMovedNodes(doc, view.overlay.movedNodes) : doc
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
  withWorldTransform(ctx, vp, dpr, () => {
    drawRooms(ctx, rooms, palette, selectedRoomKey)
    drawWalls(ctx, ghost?.doc ?? viewDoc, geometry, palette, selectedWallId, ghost?.ghostIds ?? null)
    drawWallNodes(ctx, vp, viewDoc, palette, selectedWallId, selectedNodeId)
    drawItems(ctx, vp, viewDoc)
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
  palette: CanvasPalette,
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
function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, palette: CanvasPalette): void {
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

/**
 * Fills every closed wall contour, largest first so a loop nested inside a
 * room stays visible on top. Rooms are recomputed per repaint like the wall
 * miters — both walk the same graph and neither is worth caching at this
 * scene size.
 */
function drawRooms(
  ctx: CanvasRenderingContext2D,
  rooms: Room[],
  palette: CanvasPalette,
  selectedKey: string | null,
): void {
  for (const room of rooms) {
    if (selectedKey !== null && roomKey(room) === selectedKey) {
      ctx.globalAlpha = SELECTED_ROOM_ALPHA
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
  palette: CanvasPalette,
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

/** A measured segment to label with its length. */
interface LengthSegment {
  a: Vec2
  b: Vec2
  /** extra world offset past the measured line (the ghost measures its axis) */
  clearance: number
  /** hide the label when it is wider than the wall; the ghost always shows */
  mustFit: boolean
}

/**
 * Length labels appear only in interactive contexts, and all but the ghost
 * measure mitered faces, not axes: the ghost shows its axis (joints are not
 * final until commit, and snapping works on axes), the selected wall shows
 * both faces — each labelled on its own side — and the selected room shows
 * the room-facing face of every contour wall. Segments are ordered so their
 * (-dy, dx) normal points away from the wall body.
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
  // each edge of a room being drawn is its own live ruler, like the wall ghost
  if (view.overlay?.ghostRoom) {
    for (const edge of loopEdges(view.overlay.ghostRoom)) {
      segments.push({ ...edge, clearance: WALL_THICKNESS / 2, mustFit: false })
    }
  }
  if (selection?.kind === 'wall') {
    const face = faces.get(selection.id)
    if (face) {
      segments.push({ a: face.left[0], b: face.left[1], clearance: 0, mustFit: true })
      segments.push({ a: face.right[1], b: face.right[0], clearance: 0, mustFit: true })
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
  palette: CanvasPalette,
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
    const text = `${Math.round(len * 10) / 10} cm`
    if (seg.mustFit && ctx.measureText(text).width > len * 0.9) continue
    const offset = seg.clearance + (WALL_LENGTH_GAP_PX + WALL_LENGTH_FONT_PX / 2) / vp.zoom
    const x = (seg.a.x + seg.b.x) / 2 - (dy / len) * offset
    const y = (seg.a.y + seg.b.y) / 2 + (dx / len) * offset
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(uprightAngle(dx, dy))
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
  palette: CanvasPalette,
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

/**
 * Each wall is one filled polygon, mitered at shared nodes so neighbours tile
 * without overlap or notch; too-sharp corners get a flat bevel (see wallJoints).
 * Plain walls are drawn first, then the selected (accent) and ghost (translucent
 * accent) walls on top so they sit above any neighbour they miter against.
 */
function drawWalls(
  ctx: CanvasRenderingContext2D,
  doc: SceneDocument,
  geometry: WallGeometry,
  palette: CanvasPalette,
  selectedWallId: string | null,
  ghostIds: Set<string> | null,
): void {
  const { polygons } = geometry
  const isGhost = (id: string): boolean => ghostIds?.has(id) ?? false
  const isFront = (id: string): boolean => id === selectedWallId || isGhost(id)

  const front: string[] = []
  ctx.globalAlpha = 1
  ctx.fillStyle = palette.wall
  for (const wall of doc.walls) {
    const poly = polygons.get(wall.id)
    if (!poly) continue
    if (isFront(wall.id)) {
      front.push(wall.id)
      continue
    }
    fillPoly(ctx, poly)
  }
  for (const id of front) {
    ctx.globalAlpha = isGhost(id) ? 0.5 : 1
    ctx.fillStyle = palette.accent
    fillPoly(ctx, polygons.get(id)!)
  }
  ctx.globalAlpha = 1
}

function fillPoly(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
  if (pts.length === 0) return
  ctx.beginPath()
  tracePoly(ctx, pts)
  ctx.fill()
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

/** Draws a dot at every node referenced by a wall, on top of the strokes. */
function drawWallNodes(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: SceneDocument,
  palette: CanvasPalette,
  selectedWallId: string | null,
  selectedNodeId: NodeId | null,
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
}

/** Ring radius (screen px) marking the vertex a dragged vertex will weld into. */
const MERGE_RING_PX = 9

/** Drawn last so the ring sits above the dot pile-up at the weld point. */
function drawMergeRing(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: SceneDocument,
  palette: CanvasPalette,
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

function drawItems(ctx: CanvasRenderingContext2D, vp: Viewport, doc: SceneDocument): void {
  for (const item of doc.items) {
    ctx.save()
    ctx.translate(item.pos.x, item.pos.y)
    ctx.rotate(item.rotation)
    ctx.fillStyle = item.color
    ctx.fillRect(-item.size.x / 2, -item.size.y / 2, item.size.x, item.size.y)
    ctx.lineWidth = 1 / vp.zoom
    ctx.strokeStyle = 'rgb(0 0 0 / 0.2)'
    ctx.strokeRect(-item.size.x / 2, -item.size.y / 2, item.size.x, item.size.y)
    ctx.restore()
  }
}
