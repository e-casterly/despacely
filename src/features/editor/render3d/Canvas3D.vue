<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useEditorStore } from '../store/editorStore'
import { computeWallGeometry } from '../domain/wallJoints'
import { recallCamera, rememberCamera } from './cameraMemory'
import {
  groundForward,
  MIN_ORBIT_DISTANCE_CM,
  panDirection,
  panDistance,
  PAN_KEYS,
} from './cameraPan'
import { fittingOpenings, sliceWallFootprint, wallBlocks } from '../domain/openings'
import { docBounds, wallSegment } from '../domain/operations'
import { detectRooms } from '../domain/rooms'
import { readPalette, type EditorPalette } from '../palette'
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

// the same theme the 2D plan paints with, resolved on mount (see palette.ts);
// three parses the CSS colour strings it holds
let palette!: EditorPalette

/** Renders one frame on the next tick; repeated calls coalesce into one. */
function requestRender() {
  if (frameId !== undefined || !renderer || !scene || !camera) return
  frameId = requestAnimationFrame(() => {
    frameId = undefined
    renderer!.render(scene!, camera!)
  })
}

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
    color: palette.wall3d,
    side: THREE.DoubleSide,
  })
  /** One extruded block of wall: a footprint ring, rising `height` from `baseY`. */
  const addBlock = (ring: Vec2[], baseY: number, height: number): void => {
    if (ring.length < 3 || height <= 0) return
    const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(ring.map(planToShape)), {
      depth: height,
      bevelEnabled: false,
    })
    // the rotation turns the extrusion into the Y axis, so the lift is a plain translate
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(0, baseY, 0)
    group.add(new THREE.Mesh(geometry, wallMaterial))
  }

  const geometry = computeWallGeometry(doc)
  const openings = fittingOpenings(doc, geometry)
  for (const wall of doc.walls) {
    const polygon = geometry.polygons.get(wall.id)
    if (!polygon || polygon.length < 3) continue
    const { a, b } = wallSegment(doc, wall)
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length === 0) continue
    const axis = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }

    // An opening cannot be a hole in the extruded profile — that would sweep it
    // upward into a floor-to-ceiling shaft. It is a cut *across* the footprint
    // instead: solid piers either side, and a sill and lintel around the gap.
    // A wall with no openings yields one full-height pier: the same polygon.
    const slices = sliceWallFootprint(polygon, a, axis, openings.get(wall.id) ?? [])
    for (const block of wallBlocks(wall, slices)) {
      addBlock(block.ring, block.baseY, block.height)
    }
  }

  // Floors: rooms are derived from the wall graph, never stored. A nested
  // detached loop is not floor, so it becomes a hole in the slab — the same
  // carve-out the 2D canvas fills with the evenodd rule.
  const floorMaterial = new THREE.MeshLambertMaterial({
    color: palette.floor3d,
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

/** Puts the camera back where the user left it, or frames the plan on a first visit. */
function restoreOrFrameCamera() {
  const pose = editor.projectId ? recallCamera(editor.projectId) : null
  if (!pose || !camera || !controls) {
    frameCamera()
    return
  }
  camera.position.set(...pose.position)
  controls.target.set(...pose.target)
  camera.updateProjectionMatrix()
  controls.update()
}

function saveCamera() {
  if (!camera || !controls || !editor.projectId) return
  rememberCamera(editor.projectId, {
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [controls.target.x, controls.target.y, controls.target.z],
  })
}

// --- WASD: slide the camera across the floor ---
//
// Not OrbitControls' own key handling: that fires on keydown, so holding a key
// leans on the OS auto-repeat — a pause, then jerky hops. Tracking the held keys
// and moving per frame instead makes it glide.

const heldPanKeys = new Set<string>()
let panFrame: number | undefined
let lastPanTime = 0

function onPanKeyDown(event: KeyboardEvent) {
  if (!PAN_KEYS.has(event.code)) return
  // never steal a shortcut (Cmd+W closes the tab) or a keystroke meant for a field
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

  event.preventDefault()
  heldPanKeys.add(event.code)
  startPanning()
}

function onPanKeyUp(event: KeyboardEvent) {
  heldPanKeys.delete(event.code)
}

/** A key held while the window loses focus never sends its keyup — so drop them all. */
function releaseAllPanKeys() {
  heldPanKeys.clear()
}

function startPanning() {
  if (panFrame !== undefined) return
  lastPanTime = performance.now()
  const step = (now: number): void => {
    // seconds since the last frame, capped so a background tab doesn't lurch
    const elapsed = Math.min((now - lastPanTime) / 1000, 0.1)
    lastPanTime = now

    if (heldPanKeys.size === 0 || !camera || !controls) {
      panFrame = undefined
      return
    }

    const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1)
    const forward = groundForward(camera.position, controls.target, cameraUp)
    const direction = forward && panDirection(heldPanKeys, forward)
    if (direction) {
      const distance = panDistance(camera.position.distanceTo(controls.target), elapsed)
      const move = new THREE.Vector3(direction.x, 0, direction.z).multiplyScalar(distance)
      // camera and target move together: this is a pan, so the orbit is unchanged
      camera.position.add(move)
      controls.target.add(move)
      controls.update()
      requestRender()
    }
    panFrame = requestAnimationFrame(step)
  }
  panFrame = requestAnimationFrame(step)
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

  palette = readPalette()

  scene = new THREE.Scene()
  scene.background = new THREE.Color(palette.background3d)

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
  const grid = new THREE.GridHelper(
    4000,
    40,
    new THREE.Color(palette.gridStrong),
    new THREE.Color(palette.gridMid),
  )
  scene.add(grid)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = false
  // keep the camera above ground so you can't orbit under the floor
  controls.maxPolarAngle = Math.PI / 2 - 0.05
  // don't let the camera dolly all the way onto its own target: the look
  // direction degenerates there, and with it every direction derived from it
  controls.minDistance = MIN_ORBIT_DISTANCE_CM
  controls.addEventListener('change', requestRender)

  rebuild()
  restoreOrFrameCamera()
  resize()

  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container.value)

  window.addEventListener('keydown', onPanKeyDown)
  window.addEventListener('keyup', onPanKeyUp)
  window.addEventListener('blur', releaseAllPanKeys)
})

// the document is non-reactive; the store bumps `revision` on every change
watch(() => editor.revision, rebuild)

// a different plan is its own scene: frame it rather than keeping a pose that
// was aimed at the previous project's content
watch(
  () => editor.projectId,
  () => {
    frameCamera()
    requestRender()
  },
)

onBeforeUnmount(() => {
  saveCamera()
  window.removeEventListener('keydown', onPanKeyDown)
  window.removeEventListener('keyup', onPanKeyUp)
  window.removeEventListener('blur', releaseAllPanKeys)
  releaseAllPanKeys()
  if (panFrame !== undefined) cancelAnimationFrame(panFrame)
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
