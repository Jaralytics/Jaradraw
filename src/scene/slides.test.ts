import { describe, expect, it } from 'vitest'
import { createFrame } from '../element/frame'
import { createShape } from '../element/factory'
import type { FrameElement, SceneElement } from '../element/types'
import {
  easeInOut,
  fitFrame,
  lerpViewport,
  nextAutoplay,
  overviewViewport,
  transitionDuration,
  transitionViewport,
  ZOOM_OUT_SHARE,
  ownDuration,
  parseSeconds,
  reorderSlides,
  slideDuration,
  slideFrames,
  slideName,
  slideProgress,
  stepSlide,
  withSlideDuration,
} from './slides'

const frame = (name: string | null, customData?: Record<string, unknown>): FrameElement => ({ ...createFrame(0, 0), name, customData })
const names = (els: readonly SceneElement[]) => slideFrames(els).map((f) => f.name)

describe('slideFrames', () => {
  it('uses scene order without slideIndex and skips deleted frames and other elements', () => {
    const a = frame('a')
    const b = frame('b')
    const gone = { ...frame('gone'), isDeleted: true }
    expect(names([a, createShape('rectangle', 0, 0), gone, b])).toEqual(['a', 'b'])
  })

  it('orders by slideIndex first, then the unindexed ones in scene order', () => {
    const els = [frame('x'), frame('c', { slideIndex: 2 }), frame('a', { slideIndex: 0 }), frame('y')]
    expect(names(els)).toEqual(['a', 'c', 'x', 'y'])
  })

  it('falls back to a numbered name', () => {
    expect(slideName(frame(null), 2)).toBe('Diapositiva 3')
    expect(slideName(frame('Intro'), 0)).toBe('Intro')
  })
})

describe('reorderSlides', () => {
  it('moves a slide, renumbers all and keeps other customData keys', () => {
    const a = frame('a', { keep: 1 })
    const b = frame('b')
    const c = frame('c')
    const out = reorderSlides([a, b, c], c.id, -1)
    expect(names(out)).toEqual(['a', 'c', 'b'])
    expect(out.find((e) => e.id === a.id)?.customData).toEqual({ keep: 1, slideIndex: 0 })
    expect(out.map((e) => e.customData?.slideIndex)).toEqual([0, 2, 1])
  })

  it('does nothing at the edges or for unknown ids', () => {
    const els = [frame('a'), frame('b')]
    expect(reorderSlides(els, els[0].id, -1)).toBe(els)
    expect(reorderSlides(els, els[1].id, 1)).toBe(els)
    expect(reorderSlides(els, 'nope', 1)).toBe(els)
  })
})

describe('durations', () => {
  it('sets, resolves and clears a per-slide duration', () => {
    const a = frame('a', { slideIndex: 0 })
    const set = withSlideDuration([a], a.id, 8)
    expect(ownDuration(set[0])).toBe(8)
    expect(slideDuration(set[0], 5)).toBe(8)
    expect(slideDuration(a, 5)).toBe(5)
    const cleared = withSlideDuration(set, a.id, null)
    expect(cleared[0].customData).toEqual({ slideIndex: 0 })
    expect(withSlideDuration([frame('b')], 'x', 3)[0].customData).toBeUndefined()
  })

  it('rejects invalid durations and parses input', () => {
    const a = frame('a')
    expect(withSlideDuration([a], a.id, -2)[0]).toBe(a)
    expect(parseSeconds('')).toBeNull()
    expect(parseSeconds('0')).toBeNull()
    expect(parseSeconds('2,5')).toBe(2.5)
    expect(parseSeconds('abc')).toBeNull()
  })
})

describe('navigation and timing', () => {
  it('clamps manual steps', () => {
    expect(stepSlide(0, 3, -1)).toBe(0)
    expect(stepSlide(2, 3, 1)).toBe(2)
    expect(stepSlide(1, 3, 1)).toBe(2)
  })

  it('autoplay stops at the end unless looping', () => {
    expect(nextAutoplay(0, 3, false)).toBe(1)
    expect(nextAutoplay(2, 3, false)).toBeNull()
    expect(nextAutoplay(2, 3, true)).toBe(0)
    expect(nextAutoplay(0, 0, true)).toBeNull()
  })

  it('computes slide progress', () => {
    expect(slideProgress(0, 5)).toBe(0)
    expect(slideProgress(2500, 5)).toBe(0.5)
    expect(slideProgress(9000, 5)).toBe(1)
  })
})

describe('viewport helpers', () => {
  const f = { x: 100, y: 50, width: 400, height: 200 }

  it('fits a frame centered with margin', () => {
    const vp = fitFrame(f, 1000, 600, 24)
    expect(vp.zoom).toBeCloseTo(Math.min(952 / 400, 552 / 200))
    expect((f.x + f.width / 2 + vp.scrollX) * vp.zoom).toBeCloseTo(500)
    expect((f.y + f.height / 2 + vp.scrollY) * vp.zoom).toBeCloseTo(300)
  })

  it('fits a rotated frame by its rotated bounding box', () => {
    const vp = fitFrame({ ...f, angle: Math.PI / 2 }, 1000, 600, 24)
    expect(vp.zoom).toBeCloseTo(Math.min(952 / 200, 552 / 400))
  })

  it('interpolates between viewports and hits both ends', () => {
    const a = fitFrame(f, 1000, 600)
    const b = fitFrame({ x: 900, y: 900, width: 100, height: 100 }, 1000, 600)
    expect(lerpViewport(a, b, 0, 1000, 600).zoom).toBeCloseTo(a.zoom)
    const end = lerpViewport(a, b, 1, 1000, 600)
    expect(end.zoom).toBeCloseTo(b.zoom)
    expect(end.scrollX).toBeCloseTo(b.scrollX)
    expect(end.scrollY).toBeCloseTo(b.scrollY)
  })

  it('zoom transition starts at the previous fit, shows both frames in the middle and ends at the next fit', () => {
    const prev = { ...createFrame(0, 0), width: 400, height: 200 }
    const next = { ...createFrame(0, 0), x: 2000, y: 900, width: 300, height: 300 }
    const from = fitFrame(prev, 1000, 600)
    const to = fitFrame(next, 1000, 600)
    const overview = overviewViewport([prev, next], 1000, 600)
    const at = (t: number) => transitionViewport('zoom', from, to, overview, t, 1000, 600)
    expect(at(0)).toEqual(from)
    const mid = at(ZOOM_OUT_SHARE)
    expect(mid.zoom).toBeCloseTo(overview.zoom)
    for (const fr of [prev, next]) {
      for (const [x, y] of [[fr.x, fr.y], [fr.x + fr.width, fr.y + fr.height]]) {
        const sx = (x + mid.scrollX) * mid.zoom
        const sy = (y + mid.scrollY) * mid.zoom
        expect(sx).toBeGreaterThanOrEqual(-1e-6)
        expect(sx).toBeLessThanOrEqual(1000 + 1e-6)
        expect(sy).toBeGreaterThanOrEqual(-1e-6)
        expect(sy).toBeLessThanOrEqual(600 + 1e-6)
      }
    }
    expect(mid.zoom).toBeLessThan(Math.min(from.zoom, to.zoom))
    const end = at(1)
    expect(end.zoom).toBeCloseTo(to.zoom)
    expect(end.scrollX).toBeCloseTo(to.scrollX)
    expect(end.scrollY).toBeCloseTo(to.scrollY)
  })

  it('pan transition goes straight between fits and tolerates a missing overview', () => {
    const a = fitFrame(f, 1000, 600)
    const b = fitFrame({ x: 900, y: 900, width: 100, height: 100 }, 1000, 600)
    expect(transitionViewport('pan', a, b, null, 0, 1000, 600)).toEqual(a)
    expect(transitionViewport('zoom', a, b, null, 1, 1000, 600).zoom).toBeCloseTo(b.zoom)
    expect(transitionDuration('zoom')).toBeGreaterThan(transitionDuration('pan'))
  })

  it('eases from 0 to 1', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBe(0.5)
    expect(easeInOut(1)).toBe(1)
  })
})
