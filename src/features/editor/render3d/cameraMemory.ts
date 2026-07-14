/**
 * Where the 3D camera was left standing.
 *
 * Canvas3D is unmounted every time the user toggles back to 2D, so the camera
 * can't keep its own position across a switch — it lives here instead, outside
 * the component. Keyed by project so opening a different plan frames that plan's
 * content instead of restoring a pose that belongs somewhere else.
 *
 * Session-only on purpose: this is view state, not part of the scene document.
 */
export interface CameraPose {
  position: [number, number, number]
  target: [number, number, number]
}

let saved: { projectId: string; pose: CameraPose } | null = null

export function rememberCamera(projectId: string, pose: CameraPose): void {
  saved = { projectId, pose }
}

/** The pose last left in this project, or null when there isn't one. */
export function recallCamera(projectId: string): CameraPose | null {
  return saved?.projectId === projectId ? saved.pose : null
}
