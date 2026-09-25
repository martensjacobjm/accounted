import { describe, it, expect } from 'vitest'
import { ZOOM_STEPS, stepZoom, toggleZoom, scrollToKeepPoint } from '../image-zoom'

describe('image zoom (fork bok.dalavs.se)', () => {
  it('starts at fit and steps through the fixed levels, clamped at both ends', () => {
    expect(ZOOM_STEPS[0]).toBe(1)
    expect(stepZoom(1, 1)).toBe(ZOOM_STEPS[1])
    expect(stepZoom(ZOOM_STEPS[ZOOM_STEPS.length - 1], 1)).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1])
    expect(stepZoom(1, -1)).toBe(1)
    expect(stepZoom(ZOOM_STEPS[2], -1)).toBe(ZOOM_STEPS[1])
  })

  it('a click toggles between fit and a readable level', () => {
    expect(toggleZoom(1)).toBeGreaterThanOrEqual(2)
    expect(toggleZoom(toggleZoom(1))).toBe(1)
    expect(toggleZoom(ZOOM_STEPS[3])).toBe(1)
  })

  it('keeps the clicked point under the cursor after zooming', () => {
    // A point 100px into a 400px-wide image, viewport 400px, zoom 1 -> 3:
    // the point moves to 300px in content, so scroll 300 - 100 = 200.
    expect(scrollToKeepPoint({ pointInViewport: 100, scroll: 0, from: 1, to: 3 })).toBe(200)
    // Already scrolled 50 at zoom 2, point at 120 in viewport: content point
    // (50 + 120) / 2 = 85 at zoom 1; at zoom 4 it is 340, minus 120 = 220.
    expect(scrollToKeepPoint({ pointInViewport: 120, scroll: 50, from: 2, to: 4 })).toBe(220)
    // A centred image 150px from the box edge (scroll -150), click 250px in:
    // 100px into the image; at zoom 2 that is 200px, minus 250 -> clamp 0.
    expect(scrollToKeepPoint({ pointInViewport: 250, scroll: -150, from: 1, to: 2 })).toBe(0)
    // Same image, click 350px in: 200px into it -> 400 - 350 = 50.
    expect(scrollToKeepPoint({ pointInViewport: 350, scroll: -150, from: 1, to: 2 })).toBe(50)
    // Never negative when zooming back out.
    expect(scrollToKeepPoint({ pointInViewport: 300, scroll: 0, from: 3, to: 1 })).toBe(0)
  })
})
