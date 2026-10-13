import { describe, expect, it } from 'vitest'
import { MAX_ZOOM, MIN_ZOOM, screenToScene, sceneToScreen, zoomViewportAt } from './viewport'

const vp = { scrollX: -120.5, scrollY: 40, zoom: 1.75 }

describe('viewport conversions', () => {
  it('round-trips scene -> screen -> scene', () => {
    const s = sceneToScreen(vp, 33.3, -910.2)
    const back = screenToScene(vp, s.x, s.y)
    expect(back.x).toBeCloseTo(33.3, 9)
    expect(back.y).toBeCloseTo(-910.2, 9)
  })

  it('round-trips screen -> scene -> screen', () => {
    const p = screenToScene(vp, 400, 250)
    const s = sceneToScreen(vp, p.x, p.y)
    expect(s.x).toBeCloseTo(400, 9)
    expect(s.y).toBeCloseTo(250, 9)
  })

  it('zoom anchored at a screen point keeps the scene point fixed', () => {
    const before = screenToScene(vp, 300, 200)
    const next = zoomViewportAt(vp, 300, 200, 4)
    const after = screenToScene(next, 300, 200)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
    expect(next.zoom).toBe(4)
  })

  it('clamps zoom between 10% and 3000%', () => {
    expect(zoomViewportAt(vp, 0, 0, 0.001).zoom).toBe(MIN_ZOOM)
    expect(zoomViewportAt(vp, 0, 0, 1000).zoom).toBe(MAX_ZOOM)
  })
})
