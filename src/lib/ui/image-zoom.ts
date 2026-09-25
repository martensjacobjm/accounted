/**
 * Zoom for underlag images (fork bok.dalavs.se). A photographed receipt fitted
 * to the pane is too small to read; every image viewer shares these rules so
 * the steps and the click-to-zoom behave the same everywhere. Level 1 is
 * "fit": the image scaled to the pane; higher levels multiply that width.
 */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const

/** The zoom level a click switches to from fit. */
const CLICK_ZOOM = 2.5

export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((s) => s > current) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((s) => s < current) ?? ZOOM_STEPS[0]
}

/** A click on the image: from fit to a readable level, from any zoom back to fit. */
export function toggleZoom(current: number): number {
  return current > 1 ? 1 : CLICK_ZOOM
}

/**
 * Scroll offset (one axis) that keeps the point under the cursor in place
 * when the zoom changes from `from` to `to`. At fit a centred image sits away
 * from the box edge; the caller passes that offset as a negative `scroll`.
 */
export function scrollToKeepPoint(input: { pointInViewport: number; scroll: number; from: number; to: number }): number {
  const { pointInViewport, scroll, from, to } = input
  const contentAtFit = (scroll + pointInViewport) / from
  return Math.max(0, Math.round(contentAtFit * to - pointInViewport))
}
