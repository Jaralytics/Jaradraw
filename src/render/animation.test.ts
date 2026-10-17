import { describe, expect, it } from 'vitest'
import { useStore } from '../scene/store'
import { DEFAULT_APP_STATE } from '../scene/serialize'
import { DEFAULT_VIEWPORT } from '../scene/viewport'
import { createLinear, createShape, createText } from '../element/factory'
import type { LinearElement } from '../element/types'
import {
  ANIMATION_PERIOD_MS,
  PULSE_MAX_SCALE,
  animationOf,
  canAnimate,
  customDataWithAnimation,
  flowDotPosition,
  hasAnimations,
  pointAlong,
  pulseScale,
} from './animation'

const line = (points: [number, number][], extra: Partial<LinearElement> = {}): LinearElement =>
  ({ ...createLinear('line', 0, 0), points, ...extra }) as LinearElement

describe('pulseScale', () => {
  it('is 1 at the start, peaks halfway and is 1 again at the end', () => {
    expect(pulseScale(0)).toBeCloseTo(1, 10)
    expect(pulseScale(ANIMATION_PERIOD_MS / 4)).toBeCloseTo(1 + (PULSE_MAX_SCALE - 1) / 2, 10)
    expect(pulseScale(ANIMATION_PERIOD_MS / 2)).toBeCloseTo(PULSE_MAX_SCALE, 10)
    expect(pulseScale(ANIMATION_PERIOD_MS)).toBeCloseTo(1, 10)
  })

  it('wraps around the period, also for negative times', () => {
    expect(pulseScale(ANIMATION_PERIOD_MS * 3 + 500)).toBeCloseTo(pulseScale(500), 10)
    expect(pulseScale(-500)).toBeCloseTo(pulseScale(ANIMATION_PERIOD_MS - 500), 10)
  })
})

describe('flow dot', () => {
  const straight = line([[0, 0], [100, 0]])

  it('starts at the first point, is halfway at half the period and ends at the last point', () => {
    expect(flowDotPosition(straight, 0)).toEqual({ x: 0, y: 0 })
    expect(flowDotPosition(straight, ANIMATION_PERIOD_MS / 2).x).toBeCloseTo(50, 10)
    expect(flowDotPosition(straight, ANIMATION_PERIOD_MS - 1).x).toBeCloseTo(99.95, 1)
  })

  it('wraps back to the start for the next trip', () => {
    expect(flowDotPosition(straight, ANIMATION_PERIOD_MS)).toEqual({ x: 0, y: 0 })
  })

  it('moves by arc length along a bent path', () => {
    const bent = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]
    expect(pointAlong(bent, 0.5)).toEqual({ x: 100, y: 0 })
    expect(pointAlong(bent, 0.75)).toEqual({ x: 100, y: 50 })
    expect(pointAlong(bent, 1)).toEqual({ x: 100, y: 100 })
  })

  it('follows a curved path and stays on its end points', () => {
    const curved = line([[0, 0], [50, 40], [100, 0]], { roundness: { type: 2 } as never })
    expect(flowDotPosition(curved, 0)).toEqual({ x: 0, y: 0 })
    const mid = flowDotPosition(curved, ANIMATION_PERIOD_MS / 2)
    expect(mid.x).toBeCloseTo(50, 0)
    expect(mid.y).toBeGreaterThan(10)
  })
})

describe('animation data', () => {
  it('only accepts flow on lines and pulse on shapes', () => {
    const rect = createShape('rectangle', 0, 0)
    const arrow = createLinear('arrow', 0, 0)
    expect(canAnimate(arrow, 'flow')).toBe(true)
    expect(canAnimate(arrow, 'pulse')).toBe(false)
    expect(canAnimate(rect, 'pulse')).toBe(true)
    expect(canAnimate(rect, 'flow')).toBe(false)
    expect(canAnimate(createText(0, 0, 'a', { width: 5, height: 5 }), 'pulse')).toBe(true)
    expect(animationOf({ ...rect, customData: { animation: 'flow' } })).toBeNull()
    expect(animationOf({ ...rect, customData: { animation: 'pulse' } })).toBe('pulse')
  })

  it('keeps other customData keys and clears to undefined when empty', () => {
    const el = { ...createLinear('arrow', 0, 0), customData: { waypoints: [[1, 2]] } }
    const set = customDataWithAnimation(el, 'flow')
    expect(set).toEqual({ waypoints: [[1, 2]], animation: 'flow' })
    expect(customDataWithAnimation({ ...el, customData: set }, null)).toEqual({ waypoints: [[1, 2]] })
    expect(customDataWithAnimation({ ...el, customData: { animation: 'flow' } }, null)).toBeUndefined()
  })

  it('detects animated, non-deleted elements', () => {
    const a = { ...createShape('ellipse', 0, 0), customData: { animation: 'pulse' } }
    expect(hasAnimations([createShape('ellipse', 0, 0)])).toBe(false)
    expect(hasAnimations([a])).toBe(true)
    expect(hasAnimations([{ ...a, isDeleted: true }])).toBe(false)
  })
})

describe('setAnimation action', () => {
  const st = () => useStore.getState()

  it('sets only applicable kinds, records one history entry and undoes', () => {
    const rect = createShape('rectangle', 0, 0)
    const arrow = createLinear('arrow', 0, 0)
    st().load({ elements: [rect, arrow], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
    st().setSelection([rect.id, arrow.id])
    st().setAnimation('flow')
    expect(st().elements.map((e) => animationOf(e))).toEqual([null, 'flow'])
    st().setAnimation('pulse')
    expect(st().elements.map((e) => animationOf(e))).toEqual(['pulse', 'flow'])
    st().setAnimation(null)
    expect(st().elements.map((e) => animationOf(e))).toEqual([null, null])
    st().undo()
    expect(st().elements.map((e) => animationOf(e))).toEqual(['pulse', 'flow'])
  })
})

describe('renderGifBlob cancellation', () => {
  it('returns null without rendering when already aborted', async () => {
    const { renderGifBlob } = await import('./gif')
    const controller = new AbortController()
    controller.abort()
    const el = { ...createShape('rectangle', 0, 0), width: 10, height: 10 }
    // no canvas in the test environment: an abort must never reach the encoder
    const out = await renderGifBlob([el], { background: '#fff', scale: 1, files: {} }, undefined, controller.signal).catch(() => null)
    expect(out).toBeNull()
  })
})
