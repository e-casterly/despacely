/**
 * Keyboard panning for the 3D view: WASD slides the camera across the floor.
 *
 * The camera is a turntable (it orbits a target), so "moving" means panning —
 * camera and target slide together, and the orbit itself is untouched. The maths
 * lives here rather than in the component so it can be tested.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** The movement keys, by `event.code` — layout-independent, so WASD also works
 *  on a keyboard whose W key types 'ц'. */
export const PAN_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD'])

/**
 * The camera's viewing direction flattened onto the floor.
 *
 * Looking straight down, that flattened direction collapses to nothing — so the
 * camera's own up vector stands in for it, since from overhead it is exactly what
 * points "away from you" across the floor. Null when even that degenerates.
 */
export function groundForward(position: Vec3, target: Vec3, cameraUp: Vec3): Vec3 | null {
  const flat = { x: target.x - position.x, z: target.z - position.z }
  if (Math.hypot(flat.x, flat.z) < 1e-6) {
    flat.x = cameraUp.x
    flat.z = cameraUp.z
  }
  const length = Math.hypot(flat.x, flat.z)
  if (length < 1e-6) return null
  return { x: flat.x / length, y: 0, z: flat.z / length }
}

/**
 * The unit direction the held keys ask the camera to slide, or null when nothing
 * is held (or the keys cancel out — W and S together stand still).
 *
 * The result is normalised, so holding W and D travels at the same speed as W
 * alone rather than √2 times faster, the way a naive sum would.
 */
export function panDirection(held: ReadonlySet<string>, forward: Vec3): Vec3 | null {
  // with Y up, the camera's right-hand direction is the forward vector turned 90°
  const right = { x: -forward.z, z: forward.x }

  let x = 0
  let z = 0
  if (held.has('KeyW')) {
    x += forward.x
    z += forward.z
  }
  if (held.has('KeyS')) {
    x -= forward.x
    z -= forward.z
  }
  if (held.has('KeyD')) {
    x += right.x
    z += right.z
  }
  if (held.has('KeyA')) {
    x -= right.x
    z -= right.z
  }

  const length = Math.hypot(x, z)
  if (length < 1e-9) return null
  return { x: x / length, y: 0, z: z / length }
}

/**
 * How far a held key slides the view each second, as a fraction of the camera's
 * distance to what it is looking at — so a step feels the same nose-to-the-wall
 * as it does with the whole plan in view.
 *
 * At 0.5 it takes about two seconds to travel all the way to whatever you are
 * looking at. Faster than that and a room shoots out of frame before you can let
 * go of the key.
 */
export const PAN_SPEED_PER_SECOND = 0.5

/**
 * The closest the speed is allowed to be measured from, in cm.
 *
 * Speed scales with the distance to the target so that a step feels the same at
 * any zoom — but zooming right down to the floor drives that distance towards
 * zero, and without a floor under it the step would shrink away too: the keys
 * would go dead exactly when you were trying to walk around inside the plan.
 * Below this, movement settles at a steady stroll (0.5 x 200cm = 1 m/s).
 */
export const MIN_PAN_REFERENCE_CM = 200

/**
 * How close the camera may dolly to the point it orbits, in cm. Right on top of
 * it the look direction is undefined, and everything derived from it — which way
 * is forward, which way is right — goes with it.
 */
export const MIN_ORBIT_DISTANCE_CM = 20

/** How far to slide this frame, given the camera's distance to its target. */
export function panDistance(distanceToTarget: number, deltaSeconds: number): number {
  const reference = Math.max(distanceToTarget, MIN_PAN_REFERENCE_CM)
  return reference * PAN_SPEED_PER_SECOND * deltaSeconds
}
