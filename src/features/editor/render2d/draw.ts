import { nodeAt } from '../domain/operations'
import { WALL_HEIGHT, WALL_THICKNESS } from '../domain/units'
import type { NodeId, SceneDocument, Vec2, Wall } from '../domain/types'
import type { Selection, ToolOverlay } from '../tools/types'
import { screenToWorld, worldToScreen, type Viewport } from './viewport'
import { computeWallGeometry } from './wallJoints'

export interface CanvasPalette {
  background: string
  gridFine: string
  gridMid: string
  gridStrong: string
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
  // The doc as the user currently sees it: a drag preview overrides node
  // positions on a render-only copy, so the real document stays untouched
  // until the move is committed as a command.
  const viewDoc = view.overlay?.movedNodes ? withMovedNodes(doc, view.overlay.movedNodes) : doc
  // The ghost is drawn through the same path as real walls so the two miter
  // against each other; node dots stay on the real doc so the cursor end has none.
  const ghost = view.overlay?.ghostWall ? augmentWithGhost(viewDoc, view.overlay.ghostWall) : null
  withWorldTransform(ctx, vp, dpr, () => {
    drawWalls(ctx, ghost?.doc ?? viewDoc, palette, selectedWallId, ghost?.ghostId ?? null)
    drawWallNodes(ctx, vp, viewDoc, palette, selectedWallId, selectedNodeId)
    drawItems(ctx, vp, viewDoc)
    if (view.overlay?.mergeTarget) drawMergeRing(ctx, vp, viewDoc, palette, view.overlay.mergeTarget)
  })
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

/** Snap radius (cm) used to match a ghost endpoint onto an existing node. */
const GHOST_SNAP = 0.5
const GHOST_ID = '__ghost__'

/**
 * Returns a render-only copy of the doc with the in-progress wall appended as a
 * temporary wall, its endpoints resolved onto existing nodes where they land so
 * the joint miters on both sides. Null if the segment is degenerate.
 */
function augmentWithGhost(
  doc: SceneDocument,
  seg: { a: Vec2; b: Vec2 },
): { doc: SceneDocument; ghostId: string } | null {
  const nodes = { ...doc.nodes }
  const resolve = (p: Vec2, tempId: NodeId): NodeId => {
    const existing = nodeAt(doc, p, GHOST_SNAP)
    if (existing) return existing.id
    nodes[tempId] = { id: tempId, pos: p }
    return tempId
  }
  const a = resolve(seg.a, '__ghost_a__')
  const b = resolve(seg.b, '__ghost_b__')
  if (a === b) return null

  const ghost: Wall = { id: GHOST_ID, a, b, thickness: WALL_THICKNESS, height: WALL_HEIGHT }
  return { doc: { ...doc, nodes, walls: [...doc.walls, ghost] }, ghostId: GHOST_ID }
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

/**
 * Each wall is one filled polygon, mitered at shared nodes so neighbours tile
 * without overlap or notch; too-sharp corners get a flat bevel (see wallJoints).
 * Plain walls are drawn first, then the selected (accent) and ghost (translucent
 * accent) walls on top so they sit above any neighbour they miter against.
 */
function drawWalls(
  ctx: CanvasRenderingContext2D,
  doc: SceneDocument,
  palette: CanvasPalette,
  selectedWallId: string | null,
  ghostId: string | null,
): void {
  const { polygons } = computeWallGeometry(doc)
  const isFront = (id: string): boolean => id === selectedWallId || id === ghostId

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
    ctx.globalAlpha = id === ghostId ? 0.5 : 1
    ctx.fillStyle = palette.accent
    fillPoly(ctx, polygons.get(id)!)
  }
  ctx.globalAlpha = 1
}

function fillPoly(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
  if (pts.length === 0) return
  ctx.beginPath()
  ctx.moveTo(pts[0]!.x, pts[0]!.y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y)
  ctx.closePath()
  ctx.fill()
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
