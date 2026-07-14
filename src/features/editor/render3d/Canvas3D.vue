<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useEditorStore } from '../store/editorStore'
import { computeWallGeometry } from '../render2d/wallJoints'
import { docBounds } from '../domain/operations'
import { detectRooms } from '../domain/rooms'
import type { SceneDocument, Vec2 } from '../domain/types'

const editor = useEditorStore()
const container = useTemplateRef('container')

// three.js is set up once the component mounts and torn down on unmount; every
// field is nulled again in dispose() so a remount (v-if toggle) starts clean.
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
// the walls/floor for the current document, rebuilt (and disposed) on change
let content: THREE.Group | null = null
let resizeObserver: ResizeObserver | undefined
let frameId: number | undefined

/** Reads a CSS custom property off :root, falling back when unset. */
function cssColor(name: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return new THREE.Color(value || fallback)
}

/** Renders one frame on the next tick; repeated calls coalesce into one. */
function requestRender() {
  if (frameId !== undefined || !renderer || !scene || !camera) return
  frameId = requestAnimationFrame(() => {
    frameId = undefined
    renderer!.render(scene!, camera!)
  })
}

/** Light neutral so lighting shows the wall faces apart (not tied to a token). */
const WALL_COLOR = 0xdfe3ea
/** Light indigo, echoing the 2D room fill (--color-room) so both views read alike. */
const FLOOR_COLOR = 0xe4e6f6
/** Lifts the floors a hair off y=0 so they don't z-fight the ground grid. */
const FLOOR_LIFT = 0.2

/**
 * Plan point -> shape point. three builds shapes in XY and pushes them along +Z,
 * and we lay the result down with rotateX(-90°), which sends (x, y, z) to
 * (x, z, -y). Feeding (x, -y) therefore lands a vertex at (x, z, y): exactly the
 * documented mapping plan (x, y) -> three (x, height, y), Y up (see types.ts).
 */
function planToShape(p: Vec2): THREE.Vector2 {
  return new THREE.Vector2(p.x, -p.y)
}

function buildContent(doc: SceneDocument): THREE.Group {
  const group = new THREE.Group()

  // Walls: each one's 2D footprint extruded to its own height. The footprint is
  // the same mitred geometry the 2D canvas draws, so corners join identically.
  const wallMaterial = new THREE.MeshLambertMaterial({
    color: WALL_COLOR,
    side: THREE.DoubleSide,
  })
  const { polygons } = computeWallGeometry(doc)
  for (const wall of doc.walls) {
    const polygon = polygons.get(wall.id)
    if (!polygon || polygon.length < 3) continue
    const shape = new THREE.Shape(polygon.map(planToShape))
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: wall.height, bevelEnabled: false })
    geometry.rotateX(-Math.PI / 2)
    group.add(new THREE.Mesh(geometry, wallMaterial))
  }

  // Floors: rooms are derived from the wall graph, never stored. A nested
  // detached loop is not floor, so it becomes a hole in the slab — the same
  // carve-out the 2D canvas fills with the evenodd rule.
  const floorMaterial = new THREE.MeshLambertMaterial({
    color: FLOOR_COLOR,
    side: THREE.DoubleSide,
  })
  for (const room of detectRooms(doc)) {
    const shape = new THREE.Shape(room.polygon.map(planToShape))
    for (const hole of room.holes) shape.holes.push(new THREE.Path(hole.map(planToShape)))
    const geometry = new THREE.ShapeGeometry(shape)
    geometry.rotateX(-Math.PI / 2)
    const floor = new THREE.Mesh(geometry, floorMaterial)
    floor.position.y = FLOOR_LIFT
    group.add(floor)
  }

  return group
}

function disposeContent() {
  if (!content || !scene) return
  scene.remove(content)
  content.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose()
      ;(object.material as THREE.Material).dispose()
    }
  })
  content = null
}

function rebuild() {
  if (!scene || !editor.doc) return
  disposeContent()
  content = buildContent(editor.doc)
  scene.add(content)
  requestRender()
}

/**
 * Frames the whole plan from a fixed three-quarter angle: fits the content's
 * bounding sphere (footprint plus tallest wall) into the vertical field of view,
 * and aims at the mid-height of the model so it sits centred.
 */
function frameCamera() {
  if (!camera || !controls || !editor.doc) return
  const doc = editor.doc
  const bounds = docBounds(doc)
  const width = bounds ? bounds.max.x - bounds.min.x : 400
  const depth = bounds ? bounds.max.y - bounds.min.y : 400
  const height = doc.walls.reduce((max, wall) => Math.max(max, wall.height), 0) || 250
  const center = {
    x: bounds ? (bounds.min.x + bounds.max.x) / 2 : 0,
    z: bounds ? (bounds.min.y + bounds.max.y) / 2 : 0,
  }

  // radius of the sphere enclosing the (width × height × depth) box
  const radius = 0.5 * Math.hypot(width, height, depth)
  const halfFov = ((camera.fov / 2) * Math.PI) / 180
  const distance = (radius / Math.sin(halfFov)) * 1.15 // margin so nothing clips the edge

  // ~47° above the horizon: a dollhouse view that clears the walls, so you see
  // the room floors on entry rather than just the outside of the box
  const dir = new THREE.Vector3(1, 1.5, 1).normalize()
  controls.target.set(center.x, height / 2, center.z)
  camera.position.copy(controls.target).addScaledVector(dir, distance)
  camera.updateProjectionMatrix()
  controls.update()
}

function resize() {
  if (!container.value || !renderer || !camera) return
  const { width, height } = container.value.getBoundingClientRect()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height, false)
  camera.aspect = width === 0 || height === 0 ? 1 : width / height
  camera.updateProjectionMatrix()
  requestRender()
}

onMounted(() => {
  if (!container.value) return
  const { width, height } = container.value.getBoundingClientRect()

  scene = new THREE.Scene()
  scene.background = cssColor('--color-bg-subtle', '#f8fafc')

  camera = new THREE.PerspectiveCamera(50, width / height || 1, 1, 100_000)

  renderer = new THREE.WebGLRenderer({ antialias: true })
  container.value.appendChild(renderer.domElement)
  renderer.domElement.classList.add('block', 'h-full', 'w-full')

  // a soft sky/ground fill plus one keyed direction so wall faces read apart
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  key.position.set(1, 2, 1.5)
  scene.add(key)

  // ground grid, sized generously around the origin (cm units)
  const grid = new THREE.GridHelper(4000, 40, cssColor('--color-grid-strong', '#cbd5e1'), cssColor('--color-grid-mid', '#e2e8f0'))
  scene.add(grid)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  // keep the camera above ground so you can't orbit under the floor
  controls.maxPolarAngle = Math.PI / 2 - 0.05
  controls.addEventListener('change', requestRender)

  rebuild()
  frameCamera()
  resize()

  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container.value)
})

// the document is non-reactive; the store bumps `revision` on every change
watch(() => editor.revision, rebuild)

onBeforeUnmount(() => {
  if (frameId !== undefined) cancelAnimationFrame(frameId)
  resizeObserver?.disconnect()
  disposeContent()
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
  renderer = null
  scene = null
  camera = null
  controls = null
})
</script>

<template>
  <div ref="container" class="relative flex-1 overflow-hidden" />
</template>
