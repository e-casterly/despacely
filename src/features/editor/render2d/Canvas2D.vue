<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useEditorStore } from '../store/editorStore'
import { render } from './draw'
import { readPalette, type EditorPalette } from '../palette'
import { createViewport, panBy, screenToWorld, zoomAt, zoomToFit } from './viewport'
import { docBounds } from '../domain/operations'
import type { Vec2 } from '../domain/types'
import type { PointerInput, Tool, ToolContext, ToolId } from '../tools/types'
import { createWallTool } from '../tools/wallTool'
import { createRoomTool } from '../tools/roomTool'
import { createOpeningTool } from '../tools/openingTool'
import { createSelectTool } from '../tools/selectTool'

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

/** pointer pick/snap radius: ~10 screen px expressed in world cm */
const SNAP_PX = 10
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
    render(ctx, viewport, editor.doc, palette, dpr, {
      overlay: currentTool()?.preview,
      selection: editor.selection,
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
    panning = true
    lastPointer = { x: event.clientX, y: event.clientY }
    canvas.value?.setPointerCapture(event.pointerId)
    event.preventDefault()
    return
  }
  if (event.button !== 0) return
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

// switching tools (incl. Esc -> select) ends any in-progress interaction
watch(
  () => activeTool,
  (next, prev) => {
    if (prev) tools[prev]?.cancel?.()
    // leaving select mode drops the highlight so it doesn't linger while drawing
    if (next !== 'select') editor.select(null)
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
            : activeTool === 'select'
              ? ''
              : 'cursor-crosshair'
      "
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />

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
