<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useEditorStore } from '../store/editorStore'
import { faceLabelAt, render, type FaceLabelHit } from './draw'
import { readPalette, type EditorPalette } from '../palette'
import { createViewport, panBy, screenToWorld, worldToScreen, zoomAt, zoomToFit } from './viewport'
import {
  collapsesAnEdge,
  dividerUnderPoint,
  docBounds,
  findWall,
  nodeAt,
  stretchWallMoves,
  wallUnderPoint,
} from '../domain/operations'
import { openingAtPoint } from '../domain/openings'
import { roomAt, roomKey } from '../domain/rooms'
import { MoveNodesCommand } from '../domain/commands'
import { computeWallGeometry, type WallFaces } from '../domain/wallJoints'
import type { Vec2, Wall } from '../domain/types'
import type { PointerInput, Selection, Tool, ToolContext, ToolId } from '../tools/types'
import { createWallTool } from '../tools/wallTool'
import { createRoomTool } from '../tools/roomTool'
import { createOpeningTool } from '../tools/openingTool'
import { createSelectTool } from '../tools/selectTool'
import { createSplitTool } from '../tools/splitTool'

const { activeTool } = defineProps<{ activeTool: ToolId }>()

const editor = useEditorStore()

const container = useTemplateRef('container')
const canvas = useTemplateRef('canvas')

const viewport = createViewport()
const spaceHeld = ref(false)
// reactive mirror of viewport.zoom (the viewport itself is deliberately non-reactive);
// re-synced at every point where the zoom changes
const zoomLevel = ref(viewport.zoom)

const tools: Partial<Record<ToolId, Tool>> = {
  select: createSelectTool(),
  wall: createWallTool(),
  room: createRoomTool(),
  door: createOpeningTool('door'),
  window: createOpeningTool('window'),
  split: createSplitTool(),
}
function currentTool(): Tool | undefined {
  return tools[activeTool]
}

// the active tool's live text entry (e.g. a wall length being typed); mirrored
// into a ref so the chip renders and EditorView can defer its own key handling
const textEntry = ref<string | null>(null)
function syncTextEntry() {
  textEntry.value = currentTool()?.textEntry?.value ?? null
}

// --- on-canvas face-label editing ---
// Clicking a face length label of the selected wall opens an input right on the
// label; the arrow buttons commit the typed length by choosing WHICH END the
// change extends toward (the HomeByMe idiom). Esc/blur cancel.

/** UI clamp for a typed face length (cm): can't vanish, catches typos. */
const FACE_LIMIT = { min: 1, max: 100_000 } as const

/** One end of the wall as an apply-direction choice. */
interface FaceEditEnd {
  end: 'a' | 'b'
  /** where this end lies on screen, as an arrow glyph */
  arrow: '←' | '→' | '↑' | '↓'
  /** false at a 3+-wall junction, which stretchWallMoves refuses */
  enabled: boolean
}

/** The editor opened over a clicked face label. */
const faceEdit = ref<{
  wallId: string
  side: 'left' | 'right'
  value: number
  screen: Vec2
  /** reading order: the ←/↑ end first, so buttons match the plan */
  ends: [FaceEditEnd, FaceEditEnd]
} | null>(null)
const faceInput = useTemplateRef<HTMLInputElement>('faceInput')
/** face label under the pointer; drives the chip's hover tint and the cursor */
const hoveredFaceLabel = ref<'left' | 'right' | null>(null)

function setHoveredFaceLabel(side: 'left' | 'right' | null) {
  if (side === hoveredFaceLabel.value) return
  hoveredFaceLabel.value = side
  requestRepaint() // the chip answers the pointer, so the canvas must follow
}
/** arrow button under the cursor: while hovered, the preview assumes its direction */
const hoverEnd = ref<'a' | 'b' | null>(null)
/** the typed value cannot be applied (unparsable, or the stretch would collapse a wall) */
const faceEditInvalid = ref(false)

/** The typed face length, clamped exactly as commit will clamp it; null when unparsable. */
function typedFaceLength(): number | null {
  const raw = faceInput.value?.value.trim() ?? ''
  // Number('') === 0, so an emptied field must be treated as invalid, not as 0
  const parsed = raw === '' ? NaN : Math.round(Number(raw))
  if (!Number.isFinite(parsed)) return null
  return Math.min(FACE_LIMIT.max, Math.max(FACE_LIMIT.min, parsed))
}

/**
 * The direction the preview (and Enter) may assume without the user pointing:
 * the hovered arrow, else the only enabled end. Two live choices → null; we
 * never guess which way a wall will stretch.
 */
function effectiveEnd(): 'a' | 'b' | null {
  if (hoverEnd.value) return hoverEnd.value
  const enabled = faceEdit.value?.ends.filter((option) => option.enabled) ?? []
  return enabled.length === 1 ? enabled[0]!.end : null
}

// Reflects the typed length on a render-only overlay through the SAME moves the
// commit will apply — the preview cannot diverge from the result. The document
// stays untouched; invalid or refused values show a danger border instead.
function refreshFacePreview() {
  const edit = faceEdit.value
  if (!edit || !editor.doc) return
  faceEditInvalid.value = false
  const next = typedFaceLength()
  if (next === null) {
    faceEditInvalid.value = true
    return editor.setPreviewMoves(null)
  }
  const end = effectiveEnd()
  if (!end) return editor.setPreviewMoves(null) // direction not chosen yet
  const wall = findWall(editor.doc, edit.wallId)
  const faces = wall && selectedWallFaces()
  if (!wall || !faces) return editor.setPreviewMoves(null)
  const face = edit.side === 'left' ? faces.left : faces.right
  const delta = next - Math.hypot(face[1].x - face[0].x, face[1].y - face[0].y)
  if (Math.abs(delta) < 0.005) return editor.setPreviewMoves(null)
  const moves = stretchWallMoves(editor.doc, wall, end, delta)
  const targets = moves && Object.fromEntries(moves.map((move) => [move.nodeId, move.to]))
  if (!targets || collapsesAnEdge(editor.doc, targets)) {
    faceEditInvalid.value = true
    return editor.setPreviewMoves(null)
  }
  editor.setPreviewMoves(targets)
}

function clearFacePreview() {
  hoverEnd.value = null
  faceEditInvalid.value = false
  editor.setPreviewMoves(null)
}

function onArrowEnter(option: FaceEditEnd) {
  if (!option.enabled) return
  hoverEnd.value = option.end
  refreshFacePreview()
}

function onArrowLeave() {
  hoverEnd.value = null
  refreshFacePreview()
}

function faceEditEnds(wall: Wall): [FaceEditEnd, FaceEditEnd] {
  const a = editor.doc!.nodes[wall.a]!.pos
  const b = editor.doc!.nodes[wall.b]!.pos
  const endInfo = (end: 'a' | 'b'): FaceEditEnd => {
    const own = end === 'a' ? a : b
    const other = end === 'a' ? b : a
    const ox = own.x - other.x
    const oy = own.y - other.y
    const arrow = Math.abs(ox) >= Math.abs(oy) ? (ox > 0 ? '→' : '←') : oy > 0 ? '↓' : '↑'
    return { end, arrow, enabled: stretchWallMoves(editor.doc!, wall, end, 0) !== undefined }
  }
  const ends: [FaceEditEnd, FaceEditEnd] = [endInfo('a'), endInfo('b')]
  return ends[0].arrow === '←' || ends[0].arrow === '↑' ? ends : [ends[1], ends[0]]
}

// Applies the typed length by stretching the wall at the chosen end. The change
// is linear by construction (see stretchWallMoves), so the committed face comes
// out at exactly the typed number — no solve, one undo step.
function commitFaceEdit(end: 'a' | 'b') {
  const edit = faceEdit.value
  if (!edit || !editor.doc) return
  const wall = findWall(editor.doc, edit.wallId)
  if (!wall) return closeFaceEdit()
  const next = typedFaceLength()
  if (next === null) return closeFaceEdit()

  const faces = selectedWallFaces()
  if (!faces) return closeFaceEdit()
  const face = edit.side === 'left' ? faces.left : faces.right
  // delta from the EXACT face length, so the result is the typed value even
  // when the label had been rounded for display
  const delta = next - Math.hypot(face[1].x - face[0].x, face[1].y - face[0].y)
  if (Math.abs(delta) < 0.005) return closeFaceEdit()

  const moves = stretchWallMoves(editor.doc, wall, end, delta)
  if (!moves) return closeFaceEdit()
  // refuse a stretch that collapses a neighbouring wall; nothing is committed
  const targets = Object.fromEntries(moves.map((move) => [move.nodeId, move.to]))
  if (collapsesAnEdge(editor.doc, targets)) return closeFaceEdit()
  editor.apply(new MoveNodesCommand(moves, 'Resize wall'))
  closeFaceEdit()
}

// Enter commits only when the direction is unambiguous (one end editable);
// otherwise the arrows are the commit path, as in HomeByMe
function onFaceEditEnter() {
  const enabled = faceEdit.value?.ends.filter((option) => option.enabled) ?? []
  if (enabled.length === 1) commitFaceEdit(enabled[0]!.end)
}

// one miter pass per document change is enough for label hit-testing
let facesCache: { revision: number; faces: Map<string, WallFaces> } | null = null
function selectedWallFaces(): WallFaces | undefined {
  if (editor.selection?.kind !== 'wall' || !editor.doc) return undefined
  if (facesCache?.revision !== editor.revision) {
    facesCache = { revision: editor.revision, faces: computeWallGeometry(editor.doc).faces }
  }
  return facesCache.faces.get(editor.selection.id)
}

function faceLabelUnder(event: PointerEvent): FaceLabelHit | undefined {
  if (activeTool !== 'select') return undefined
  const faces = selectedWallFaces()
  const ctx = canvas.value?.getContext('2d')
  if (!faces || !ctx) return undefined
  return faceLabelAt(ctx, viewport, faces, screenToWorld(viewport, pointerPosition(event)))
}

function openFaceEdit(hit: FaceLabelHit) {
  if (editor.selection?.kind !== 'wall' || !editor.doc) return
  const wall = findWall(editor.doc, editor.selection.id)
  if (!wall) return
  faceEdit.value = {
    wallId: wall.id,
    side: hit.side,
    value: hit.value,
    screen: worldToScreen(viewport, hit.center),
    ends: faceEditEnds(wall),
  }
  void nextTick(() => {
    faceInput.value?.focus()
    faceInput.value?.select()
  })
}

function closeFaceEdit() {
  faceEdit.value = null
  clearFacePreview()
}

// the label the editor sits on moves or vanishes with these — close, don't chase
watch(() => editor.selection, closeFaceEdit)
watch(() => editor.revision, closeFaceEdit)

/** pointer pick/snap radius: ~10 screen px expressed in world cm */
const SNAP_PX = 10

// --- element hover (select mode): the node or wall under an idle pointer ---
// A pre-selection cue; the renderer washes the wall / rings the vertex lightly.
const hovered = ref<Selection | null>(null)

function sameHover(a: Selection | null, b: Selection | null): boolean {
  return a?.kind === b?.kind && a?.id === b?.id
}

/** The element under a world point in select mode, in the same pick priority a
 *  click uses: vertex → opening → wall → divider → room. */
function hoverAt(world: Vec2): Selection | null {
  if (activeTool !== 'select' || !editor.doc) return null
  const tol = SNAP_PX / viewport.zoom
  const node = nodeAt(editor.doc, world, tol)
  if (node) return { kind: 'node', id: node.id }
  const opening = openingAtPoint(editor.doc, world)
  if (opening) return { kind: 'opening', id: opening.opening.id }
  const wall = wallUnderPoint(editor.doc, world, tol)
  if (wall) return { kind: 'wall', id: wall.id }
  const divider = dividerUnderPoint(editor.doc, world, tol)
  if (divider) return { kind: 'divider', id: divider.id }
  const room = roomAt(editor.doc, world)
  if (room) return { kind: 'room', id: roomKey(room) }
  return null
}

function setHovered(next: Selection | null) {
  if (sameHover(next, hovered.value)) return
  hovered.value = next
  requestRepaint()
}

function toolContext(): ToolContext {
  return {
    doc: editor.doc!,
    apply: editor.apply,
    select: editor.select,
    snapDist: SNAP_PX / viewport.zoom,
  }
}
function pointerInput(event: PointerEvent): PointerInput {
  return { world: screenToWorld(viewport, pointerPosition(event)), shift: event.shiftKey }
}

// resolved on mount, once the theme's stylesheet is in the document
let palette!: EditorPalette
let dpr = 1
let frameId: number | undefined
let resizeObserver: ResizeObserver | undefined
let panning = false
let lastPointer: Vec2 | null = null

/** Requests a single repaint on the next frame; repeated calls coalesce into one. */
function requestRepaint() {
  if (frameId !== undefined) return
  frameId = requestAnimationFrame(() => {
    frameId = undefined
    const ctx = canvas.value?.getContext('2d')
    if (!ctx || !editor.doc) return
    // a pending numeric edit (store preview) outranks the tool's own preview;
    // they never coexist — the face editor only lives in idle select mode
    render(ctx, viewport, editor.doc, palette, dpr, {
      overlay: editor.previewMoves ? { movedNodes: editor.previewMoves } : currentTool()?.preview,
      selection: editor.selection,
      hovered: hovered.value,
      hoveredFaceLabel: hoveredFaceLabel.value,
    })
  })
}

function resize() {
  if (!container.value || !canvas.value) return
  dpr = window.devicePixelRatio || 1
  const rect = container.value.getBoundingClientRect()
  viewport.width = rect.width
  viewport.height = rect.height
  canvas.value.width = Math.round(rect.width * dpr)
  canvas.value.height = Math.round(rect.height * dpr)
  requestRepaint()
}

function pointerPosition(event: PointerEvent | WheelEvent): Vec2 {
  const rect = canvas.value!.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function onWheel(event: WheelEvent) {
  closeFaceEdit() // zoom and pan both invalidate the editor's on-screen anchor
  // Firefox reports mouse-wheel deltas in lines, not pixels
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1
  if (event.ctrlKey || event.metaKey) {
    // trackpad pinch arrives as wheel with ctrlKey set
    zoomAt(viewport, pointerPosition(event), Math.exp(-event.deltaY * unit * 0.002))
    zoomLevel.value = viewport.zoom
  } else {
    // Safari keeps shift+wheel vertical; Chrome/Firefox already remap it to deltaX
    const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
    const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY
    panBy(viewport, { x: -dx * unit, y: -dy * unit })
  }
  requestRepaint()
}

function onPointerDown(event: PointerEvent) {
  if (event.button === 1 || (event.button === 0 && spaceHeld.value)) {
    closeFaceEdit() // panning invalidates the editor's on-screen anchor
    panning = true
    lastPointer = { x: event.clientX, y: event.clientY }
    canvas.value?.setPointerCapture(event.pointerId)
    event.preventDefault()
    return
  }
  if (event.button !== 0) return
  const labelHit = faceLabelUnder(event)
  if (labelHit) {
    // the click lands on the dimension, not the scene: no deselect, no drag.
    // preventDefault suppresses the compatibility mousedown, whose default
    // focus handling would otherwise blur the input right after it opens
    event.preventDefault()
    openFaceEdit(labelHit)
    return
  }
  closeFaceEdit()
  setHovered(null) // a press starts a drag/selection; the hover cue washes out
  const tool = currentTool()
  if (tool?.onPointerDown) {
    // capture so drags keep receiving move/up outside the canvas
    canvas.value?.setPointerCapture(event.pointerId)
    tool.onPointerDown(pointerInput(event), toolContext())
    syncTextEntry() // committing a point clears any pending length
    requestRepaint()
  }
}

function onPointerMove(event: PointerEvent) {
  if (panning && lastPointer) {
    panBy(viewport, { x: event.clientX - lastPointer.x, y: event.clientY - lastPointer.y })
    lastPointer = { x: event.clientX, y: event.clientY }
    requestRepaint()
    return
  }
  setHoveredFaceLabel(faceLabelUnder(event)?.side ?? null)
  // element hover only while idle (no button held) — a press starts a drag
  setHovered(event.buttons === 0 ? hoverAt(screenToWorld(viewport, pointerPosition(event))) : null)
  const tool = currentTool()
  if (tool?.onPointerMove) {
    const hadPreview = tool.preview !== null
    tool.onPointerMove(pointerInput(event), toolContext())
    // repaint when a preview is showing, and once more when it disappears
    if (tool.preview || hadPreview) requestRepaint()
  }
}

function onPointerUp(event: PointerEvent) {
  if (panning) {
    panning = false
    lastPointer = null
    return
  }
  const tool = currentTool()
  if (tool?.onPointerUp) {
    tool.onPointerUp(pointerInput(event), toolContext())
    requestRepaint()
  }
}

function onPointerLeave() {
  setHoveredFaceLabel(null)
  setHovered(null)
  // drop any hover-only preview (e.g. the door/window ghost) as the cursor exits
  const tool = currentTool()
  if (tool?.onPointerLeave) {
    tool.onPointerLeave()
    requestRepaint()
  }
}

/** one +/- button click; two clicks double the zoom */
const BUTTON_ZOOM = Math.SQRT2

function zoomStep(factor: number) {
  zoomAt(viewport, { x: viewport.width / 2, y: viewport.height / 2 }, factor)
  zoomLevel.value = viewport.zoom
  requestRepaint()
}

function fitContent() {
  const bounds = editor.doc ? docBounds(editor.doc) : null
  if (bounds) {
    zoomToFit(viewport, bounds)
  } else {
    // empty scene: back to the origin at default scale
    viewport.pan = { x: 0, y: 0 }
    viewport.zoom = 1
  }
  zoomLevel.value = viewport.zoom
  requestRepaint()
}

defineExpose({
  zoomLevel,
  zoomIn: () => zoomStep(BUTTON_ZOOM),
  zoomOut: () => zoomStep(1 / BUTTON_ZOOM),
  zoomToFit: fitContent,
  // true while a tool is capturing typed text, so EditorView leaves those keys alone
  isCapturingText: () => textEntry.value !== null,
})

function onKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

  // give the active tool first refusal on the key (e.g. wall-length entry); when
  // it consumes it, EditorView defers via isCapturingText, so no double handling
  const tool = currentTool()
  if (tool?.onKey?.(event.key, toolContext())) {
    event.preventDefault()
    syncTextEntry()
    requestRepaint()
    return
  }

  if (event.code === 'Space' && !event.repeat) spaceHeld.value = true
  // EditorView switches Esc back to select; when select is already active
  // the tool watch won't fire, so cancel any in-progress drag here too
  if (event.key === 'Escape') {
    currentTool()?.cancel?.()
    syncTextEntry()
    requestRepaint()
  }
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code === 'Space') spaceHeld.value = false
}

// the document is non-reactive; the store bumps `revision` on every change
watch(() => editor.revision, requestRepaint)
watch(() => editor.selection, requestRepaint)
watch(() => editor.previewMoves, requestRepaint)

// switching tools (incl. Esc -> select) ends any in-progress interaction
watch(
  () => activeTool,
  (next, prev) => {
    if (prev) tools[prev]?.cancel?.()
    // leaving select mode drops the highlight so it doesn't linger while drawing
    if (next !== 'select') editor.select(null)
    setHovered(null) // the hover cue belongs to select mode only
    syncTextEntry()
    requestRepaint()
  },
)

onMounted(() => {
  palette = readPalette()
  resize()
  resizeObserver = new ResizeObserver(resize)
  if (container.value) resizeObserver.observe(container.value)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  requestRepaint()
})

onBeforeUnmount(() => {
  if (frameId !== undefined) cancelAnimationFrame(frameId)
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})
</script>

<template>
  <div ref="container" class="relative flex-1">
    <canvas
      ref="canvas"
      class="block h-full w-full touch-none"
      :class="
        panning
          ? 'cursor-grabbing'
          : spaceHeld
            ? 'cursor-grab'
            : hoveredFaceLabel || hovered
              ? 'cursor-pointer'
              : activeTool === 'select'
                ? ''
                : 'cursor-crosshair'
      "
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
    />

    <div
      v-if="faceEdit"
      class="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1"
      :style="{ left: `${faceEdit.screen.x}px`, top: `${faceEdit.screen.y}px` }"
    >
      <!-- pointerdown.prevent keeps the input focused, so blur can't cancel before click -->
      <button
        v-for="(option, index) in faceEdit.ends"
        :key="option.end"
        type="button"
        class="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-surface text-sm text-text shadow-sm hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
        :class="index === 0 ? 'order-1' : 'order-3'"
        :disabled="!option.enabled"
        :title="
          option.enabled
            ? 'Apply, moving this end of the wall'
            : 'This end joins three or more walls and cannot move'
        "
        :aria-label="`Apply toward ${option.arrow}`"
        @pointerdown.prevent
        @pointerenter="onArrowEnter(option)"
        @pointerleave="onArrowLeave"
        @click="commitFaceEdit(option.end)"
      >
        {{ option.arrow }}
      </button>
      <input
        ref="faceInput"
        type="number"
        :value="faceEdit.value"
        class="order-2 h-7 w-20 rounded-md border bg-surface px-2 text-center text-sm text-text shadow-sm focus-visible:outline-2 focus-visible:outline-primary"
        :class="faceEditInvalid ? 'border-danger' : 'border-border'"
        aria-label="Face length, cm"
        @input="refreshFacePreview"
        @blur="closeFaceEdit"
        @keydown.escape.stop="closeFaceEdit"
        @keydown.enter.prevent="onFaceEditEnter"
      />
    </div>

    <div
      v-if="textEntry !== null"
      class="pointer-events-none absolute bottom-16 left-1/2 flex -translate-x-1/2 items-baseline gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm shadow-sm"
    >
      <span class="text-text-muted">Length</span>
      <span class="font-medium tabular-nums text-text">{{ textEntry }}</span>
      <span class="text-text-muted">cm</span>
    </div>
  </div>
</template>
