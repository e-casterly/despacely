/**
 * The editor's colours, read from the CSS theme.
 *
 * Canvas (2D and 3D) cannot use CSS classes, so it has to resolve the theme by
 * hand. This is the only place that does: `style.css` holds every value, this
 * table only names the token each render key comes from, and nothing outside
 * it may spell a colour literal. Both canvases share one palette so a token
 * changed in the theme moves the plan and the model together.
 */
const TOKENS = {
  /** 2D canvas background; also the ring drawn around the node dots */
  background: '--color-bg',
  /** 3D scene background: a shade off the plan's white, so the model reads as a body */
  background3d: '--color-bg-subtle',
  gridFine: '--color-grid-fine',
  gridMid: '--color-grid-mid',
  gridStrong: '--color-grid-strong',
  room: '--color-room',
  roomLabel: '--color-label',
  /** the wall body in plan; the node dots take the same colour */
  wall: '--color-wall',
  wall3d: '--color-wall-3d',
  floor3d: '--color-floor-3d',
  opening: '--color-opening',
  /** zoning divider: a dashed line subdividing a room, no wall body */
  divider: '--color-divider',
  /** selection, ghosts, guides and every measurement the editor writes */
  accent: '--color-accent',
  /** the fill a newly placed item takes; an item's own colour then lives in the document */
  item: '--color-item',
  itemStroke: '--color-item-stroke',
} as const

export type EditorPalette = Record<keyof typeof TOKENS, string>

/**
 * Resolves every token against :root. Called once per canvas mount — there is no
 * theme switch to react to yet, and getComputedStyle forces a style flush, so it
 * has no business running per frame.
 *
 * A missing token throws rather than defaulting: canvas would otherwise silently
 * keep the previous fill, and a typo'd name would show up as a wrongly coloured
 * shape long after the change that caused it.
 */
export function readPalette(): EditorPalette {
  const styles = getComputedStyle(document.documentElement)
  const palette = {} as Record<string, string>
  for (const [key, token] of Object.entries(TOKENS)) {
    const value = styles.getPropertyValue(token).trim()
    if (!value) throw new Error(`Missing theme token ${token} for palette.${key}`)
    palette[key] = value
  }
  return palette as EditorPalette
}
