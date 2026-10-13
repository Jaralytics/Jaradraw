import { describe, expect, it } from 'vitest'
import { createLinear, createShape, createText } from './factory'
import { elementsInRect, getSelectionBounds, normalizeRect, scaleElements } from './group'
import { resizeBox } from './resize'
import { withAbsolutePoints } from './geometry'

const rect = (x: number, y: number, w: number, h: number) => ({
  ...createShape('rectangle', x, y),
  width: w,
  height: h,
})

describe('marquee', () => {
  it('normalizes a rect dragged in any direction', () => {
    expect(normalizeRect({ x: 50, y: 40 }, { x: 10, y: 80 })).toEqual({ x: 10, y: 40, width: 40, height: 40 })
  })

  it('selects only elements fully inside', () => {
    const inside = rect(10, 10, 20, 20)
    const partial = rect(90, 10, 40, 20)
    const outside = rect(300, 300, 10, 10)
    const deleted = { ...rect(20, 20, 5, 5), isDeleted: true }
    const hit = elementsInRect([inside, partial, outside, deleted], { x: 0, y: 0, width: 100, height: 100 })
    expect(hit.map((e) => e.id)).toEqual([inside.id])
  })

  it('uses rotated bounds', () => {
    const bar = { ...rect(0, 0, 100, 10), angle: Math.PI / 2 }
    expect(elementsInRect([bar], { x: 40, y: -50, width: 20, height: 110 })).toHaveLength(1)
    expect(elementsInRect([bar], { x: 0, y: 0, width: 100, height: 100 })).toHaveLength(0)
  })
})

describe('multi-selection bounds and scaling', () => {
  it('computes the common bounding box', () => {
    const b = getSelectionBounds([rect(0, 0, 10, 10), rect(40, 20, 20, 30)])
    expect(b).toEqual({ x: 0, y: 0, width: 60, height: 50 })
  })

  it('scales positions, sizes, points and font size proportionally', () => {
    const a = rect(0, 0, 10, 10)
    const b = rect(30, 20, 20, 10)
    const line = withAbsolutePoints(createLinear('line', 0, 40), [
      [0, 40],
      [40, 40],
    ])
    const text = createText(10, 10, 'x', { width: 10, height: 25 })
    const els = [a, b, line, text]
    const from = getSelectionBounds(els)!
    const { box, scale } = resizeBox(from, 'se', from.x + from.width * 2, from.y + from.height * 2, true)
    expect(scale).toBeCloseTo(2, 9)
    const out = scaleElements(els, from, box, scale)
    const nb = getSelectionBounds(out)!
    expect(nb.width).toBeCloseTo(from.width * 2, 6)
    expect(nb.height).toBeCloseTo(from.height * 2, 6)
    expect(out[0]).toMatchObject({ x: 0, y: 0, width: 20, height: 20 })
    expect(out[1]).toMatchObject({ x: 60, y: 40, width: 40, height: 20 })
    const l = out[2] as typeof line
    expect(l.points[1]).toEqual([80, 0])
    expect(l.y).toBe(80)
    expect((out[3] as typeof text).fontSize).toBe(40)
    expect(out[0].version).toBe(a.version + 1)
    expect(a.width).toBe(10)
  })
})
