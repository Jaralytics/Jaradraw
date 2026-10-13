import { describe, expect, it } from 'vitest'
import { createLinear, createShape, createText } from './factory'
import { getAbsolutePoints, getElementBox, getPointsBounds, withAbsolutePoints } from './geometry'
import { moveLinearPoint, resizeBox, resizeElement } from './resize'

const box = { x: 100, y: 100, width: 100, height: 50 }

describe('resizeBox', () => {
  it('se handle keeps the nw corner fixed', () => {
    const { box: b } = resizeBox(box, 'se', 300, 200)
    expect(b).toEqual({ x: 100, y: 100, width: 200, height: 100 })
  })

  it('flips through zero and normalizes to positive size', () => {
    const { box: b } = resizeBox(box, 'e', 50, 120)
    expect(b.width).toBe(50)
    expect(b.x).toBe(50)
    expect(b.y).toBe(100)
    expect(b.height).toBe(50)
  })

  it('corner flip on both axes', () => {
    const { box: b } = resizeBox(box, 'se', 40, 60)
    expect(b).toEqual({ x: 40, y: 60, width: 60, height: 40 })
  })

  it('edge handle only changes one axis', () => {
    const { box: b } = resizeBox(box, 'n', 999, 60)
    expect(b).toEqual({ x: 100, y: 60, width: 100, height: 90 })
  })

  it('keepAspect scales uniformly', () => {
    const { box: b, scale } = resizeBox(box, 'se', 300, 130, true)
    expect(scale).toBe(2)
    expect(b.width / b.height).toBeCloseTo(2, 9)
  })
})

describe('resizeElement', () => {
  it('returns a new object and bumps version', () => {
    const el = { ...createShape('rectangle', 100, 100), width: 100, height: 50 }
    const next = resizeElement(el, 'se', 250, 175)
    expect(next).not.toBe(el)
    expect(el.width).toBe(100)
    expect(next.width).toBe(150)
    expect(next.height).toBe(75)
    expect(next.version).toBe(el.version + 1)
  })

  it('text corner resize scales fontSize proportionally', () => {
    const t = createText(0, 0, 'hola', { width: 100, height: 25 })
    const next = resizeElement(t, 'se', 200, 50)
    expect(next.fontSize).toBeCloseTo(40, 6)
    expect(next.width).toBeCloseTo(200, 6)
    expect(next.height).toBeCloseTo(50, 6)
  })
})

describe('linear bounds', () => {
  it('width/height equal the bounding box of the points', () => {
    const l = createLinear('arrow', 50, 50)
    const next = withAbsolutePoints(l, [
      [50, 50],
      [20, 130],
    ])
    expect(next.points[0]).toEqual([0, 0])
    expect(next.points[1]).toEqual([-30, 80])
    expect(next.width).toBe(30)
    expect(next.height).toBe(80)
    expect(getElementBox(next)).toEqual({ x: 20, y: 50, width: 30, height: 80 })
    expect(getPointsBounds(next.points)).toEqual({ minX: -30, minY: 0, maxX: 0, maxY: 80 })
  })

  it('moving the first endpoint re-origins the element', () => {
    const l = withAbsolutePoints(createLinear('line', 0, 0), [
      [0, 0],
      [100, 0],
    ])
    const next = moveLinearPoint(l, 0, 40, 30)
    expect(next.x).toBe(40)
    expect(next.y).toBe(30)
    expect(getAbsolutePoints(next)).toEqual([
      [40, 30],
      [100, 0],
    ])
    expect(next.width).toBe(60)
    expect(next.height).toBe(30)
  })
})

describe('group resize with a degenerate box', () => {
  it('derives the scale from the non-zero axis', () => {
    const { box: b, scale } = resizeBox({ x: 10, y: 0, width: 0, height: 100 }, 'se', 500, 200, true)
    expect(scale).toBeCloseTo(2)
    expect(b.height).toBeCloseTo(200)
    expect(b.width).toBe(0)
  })
})
