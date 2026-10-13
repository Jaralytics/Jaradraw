import { describe, expect, it } from 'vitest'
import { createLinear, createShape, createText } from './factory'
import { hitTestElement, hitTestScene } from './hit'

const TOL = 4

describe('hit testing', () => {
  it('transparent rectangle: only near the outline', () => {
    const r = createShape('rectangle', 0, 0, {})
    const rect = { ...r, width: 100, height: 60 }
    expect(hitTestElement(rect, 50, 30, TOL)).toBe(false)
    expect(hitTestElement(rect, 100, 30, TOL)).toBe(true)
    expect(hitTestElement(rect, 0, 0, TOL)).toBe(true)
    expect(hitTestElement(rect, 50, 3, TOL)).toBe(true)
    expect(hitTestElement(rect, 120, 30, TOL)).toBe(false)
  })

  it('filled rectangle: inside counts', () => {
    const rect = { ...createShape('rectangle', 0, 0, { backgroundColor: '#ffc9c9' }), width: 100, height: 60 }
    expect(hitTestElement(rect, 50, 30, TOL)).toBe(true)
    expect(hitTestElement(rect, 105, 30, TOL)).toBe(true)
    expect(hitTestElement(rect, 130, 30, TOL)).toBe(false)
  })

  it('ellipse: outline vs filled interior', () => {
    const e = { ...createShape('ellipse', 0, 0), width: 200, height: 100 }
    expect(hitTestElement(e, 100, 50, TOL)).toBe(false)
    expect(hitTestElement(e, 200, 50, TOL)).toBe(true)
    expect(hitTestElement(e, 100, 0, TOL)).toBe(true)
    // corner of the bounding box is outside the ellipse
    expect(hitTestElement(e, 2, 2, TOL)).toBe(false)
    const filled = { ...e, backgroundColor: '#a5d8ff' }
    expect(hitTestElement(filled, 100, 50, TOL)).toBe(true)
    expect(hitTestElement(filled, 2, 2, TOL)).toBe(false)
  })

  it('diamond: outline vs filled interior', () => {
    const d = { ...createShape('diamond', 0, 0), width: 100, height: 100 }
    expect(hitTestElement(d, 50, 50, TOL)).toBe(false)
    expect(hitTestElement(d, 25, 25, TOL)).toBe(true)
    expect(hitTestElement(d, 5, 5, TOL)).toBe(false)
    const filled = { ...d, backgroundColor: '#b2f2bb' }
    expect(hitTestElement(filled, 50, 50, TOL)).toBe(true)
    expect(hitTestElement(filled, 5, 5, TOL)).toBe(false)
  })

  it('line and arrow: distance to segment', () => {
    const l = { ...createLinear('line', 10, 10), points: [[0, 0], [100, 0]] as const, width: 100, height: 0 }
    expect(hitTestElement(l, 60, 12, TOL)).toBe(true)
    expect(hitTestElement(l, 60, 30, TOL)).toBe(false)
    expect(hitTestElement(l, 140, 10, TOL)).toBe(false)
    const a = { ...createLinear('arrow', 0, 0), points: [[0, 0], [100, 100]] as const, width: 100, height: 100 }
    expect(hitTestElement(a, 50, 52, TOL)).toBe(true)
    expect(hitTestElement(a, 50, 80, TOL)).toBe(false)
  })

  it('text: bounding box', () => {
    const t = createText(10, 10, 'hola', { width: 80, height: 25 })
    expect(hitTestElement(t, 50, 20, TOL)).toBe(true)
    expect(hitTestElement(t, 200, 20, TOL)).toBe(false)
  })

  it('rotated element honors angle', () => {
    // 200x20 horizontal bar filled, rotated 90deg about its center (100, 10)
    const bar = {
      ...createShape('rectangle', 0, 0, { backgroundColor: '#ffc9c9' }),
      width: 200,
      height: 20,
      angle: Math.PI / 2,
    }
    // after rotation the bar is vertical around x=100, spanning y from -90 to 110
    expect(hitTestElement(bar, 100, 100, TOL)).toBe(true)
    expect(hitTestElement(bar, 100, -80, TOL)).toBe(true)
    expect(hitTestElement(bar, 190, 10, TOL)).toBe(false)
    expect(hitTestElement(bar, 10, 10, TOL)).toBe(false)
  })

  it('ignores deleted elements and returns the topmost hit', () => {
    const a = { ...createShape('rectangle', 0, 0, { backgroundColor: '#fff' }), width: 50, height: 50 }
    const b = { ...createShape('rectangle', 0, 0, { backgroundColor: '#fff' }), width: 50, height: 50 }
    expect(hitTestScene([a, b], 25, 25, TOL)?.id).toBe(b.id)
    expect(hitTestScene([a, { ...b, isDeleted: true }], 25, 25, TOL)?.id).toBe(a.id)
  })
})
