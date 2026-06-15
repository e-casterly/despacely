<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useEditorStore } from '../store/editorStore'
import { render, type CanvasPalette } from './draw'
import { createViewport, panBy, zoomAt } from './viewport'
import type { Vec2 } from '../domain/types'

const editor = useEditorStore()

const container = useTemplateRef('container')
const canvas = useTemplateRef('canvas')

const viewport = createViewport()
const spaceHeld = ref(false)

let palette: CanvasPalette = {
  background: '#ffffff',
  gridFine: '#f1f5f9',
  gridMid: '#e2e8f0',
  gridStrong: '#cbd5e1',
  wall: '#1e293b',
}
let dpr = 1
let frameId: number | undefined
let resizeObserver: ResizeObserver | undefined
let panning = false
let lastPointer: Vec2 | null = null

/** Requests a single repaint on the next frame; repeated calls coalesce into one. */
function markDirty() {
  if (frameId !== undefined) return
  frameId = requestAnimationFrame(() => {
    frameId = undefined
    const ctx = canvas.value?.getContext('2d')
    if (!ctx || !editor.doc) return
    render(ctx, viewport, editor.doc, palette, dpr)
  })
}

function readPalette(): CanvasPalette {
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  return {
    background: token('--color-bg', palette.background),
    gridFine: token('--color-grid-fine', palette.gridFine),
    gridMid: token('--color-grid-mid', palette.gridMid),
    gridStrong: token('--color-grid-strong', palette.gridStrong),
    wall: token('--color-text', palette.wall),
  }
}

function resize() {
  if (!container.value || !canvas.value) return
  dpr = window.devicePixelRatio || 1
  const rect = container.value.getBoundingClientRect()
  viewport.width = rect.width
  viewport.height = rect.height
  canvas.value.width = Math.round(rect.width * dpr)
  canvas.value.height = Math.round(rect.height * dpr)
  markDirty()
}

function pointerPosition(event: PointerEvent | WheelEvent): Vec2 {
  const rect = canvas.value!.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function onWheel(event: WheelEvent) {
  zoomAt(viewport, pointerPosition(event), Math.exp(-event.deltaY * 0.002))
  markDirty()
}

function onPointerDown(event: PointerEvent) {
  const panButton = event.button === 1 || (event.button === 0 && spaceHeld.value)
  if (!panButton) return
  panning = true
  lastPointer = { x: event.clientX, y: event.clientY }
  canvas.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function onPointerMove(event: PointerEvent) {
  if (!panning || !lastPointer) return
  panBy(viewport, { x: event.clientX - lastPointer.x, y: event.clientY - lastPointer.y })
  lastPointer = { x: event.clientX, y: event.clientY }
  markDirty()
}

function onPointerUp() {
  panning = false
  lastPointer = null
}

function onKeyDown(event: KeyboardEvent) {
  if (event.code === 'Space' && !event.repeat) spaceHeld.value = true
}

function onKeyUp(event: KeyboardEvent) {
  if (event.code === 'Space') spaceHeld.value = false
}

watch(() => editor.doc, markDirty, { deep: true })

onMounted(() => {
  palette = readPalette()
  resize()
  resizeObserver = new ResizeObserver(resize)
  if (container.value) resizeObserver.observe(container.value)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  markDirty()
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
      :class="panning ? 'cursor-grabbing' : spaceHeld ? 'cursor-grab' : ''"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />
  </div>
</template>
