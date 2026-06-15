import type { SceneDocument } from '../domain/types'
import { screenToWorld, worldToScreen, type Viewport } from './viewport'

export interface CanvasPalette {
  background: string
  gridFine: string
  gridMid: string
  gridStrong: string
  wall: string
}

/** Metric grid tiers (cm): 10cm fine, 50cm (4 squares per metre), 1m strong. */
const GRID_TIERS = [
  { step: 10, color: 'gridFine' },
  { step: 50, color: 'gridMid' },
  { step: 100, color: 'gridStrong' },
] as const

/** A tier is skipped once its lines get closer than this on screen. */
const MIN_LINE_GAP_PX = 6

/** Full repaint: background, grid, then the document in layer order. */
export function render(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  doc: SceneDocument,
  palette: CanvasPalette,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, vp.width, vp.height)

  drawGrid(ctx, vp, palette)

  withWorldTransform(ctx, vp, dpr, () => {
    drawWalls(ctx, doc, palette)
    drawItems(ctx, vp, doc)
  })
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

function drawWalls(ctx: CanvasRenderingContext2D, doc: SceneDocument, palette: CanvasPalette): void {
  ctx.strokeStyle = palette.wall
  ctx.lineCap = 'butt'
  for (const wall of doc.walls) {
    ctx.lineWidth = wall.thickness
    ctx.beginPath()
    ctx.moveTo(wall.a.x, wall.a.y)
    ctx.lineTo(wall.b.x, wall.b.y)
    ctx.stroke()
  }
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
