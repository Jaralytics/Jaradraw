import { describe, expect, it } from 'vitest'
import { createLinear } from './factory'
import { getBoxCenter, getElementBox, rotatePoint, withAbsolutePoints } from './geometry'
import { getHandlePositions, hitHandle } from './handles'
import { bezierAt, closestPathPoint, getCurveSegments } from './path'
import { insertNodeAt } from './points'
import type { Point } from './types'

const pts: Point[] = [[0, 0], [100, 0], [100, 100]]

describe('closestPathPoint', () => {
  it('finds the segment and projection on a polyline', () => {
    const a = closestPathPoint(pts, false, 40, 7)!
    expect(a.segment).toBe(0)
    expect(a.point).toEqual({ x: 40, y: 0 })
    expect(a.distance).toBeCloseTo(7)
    const b = closestPathPoint(pts, false, 108, 60)!
    expect(b.segment).toBe(1)
    expect(b.point).toEqual({ x: 100, y: 60 })
  })

  it('clamps to the ends of the path', () => {
    expect(closestPathPoint(pts, false, -30, 0)!.point).toEqual({ x: 0, y: 0 })
    expect(closestPathPoint([[0, 0]], false, 1, 1)).toBeNull()
  })

  it('follows the flattened curve and maps back to the spline segment', () => {
    const segs = getCurveSegments(pts)
    const on0 = bezierAt(segs[0], 0.5)
    const on1 = bezierAt(segs[1], 0.3)
    const a = closestPathPoint(pts, true, on0.x, on0.y)!
    expect(a.segment).toBe(0)
    expect(a.distance).toBeLessThan(0.5)
    const b = closestPathPoint(pts, true, on1.x, on1.y)!
    expect(b.segment).toBe(1)
    expect(b.distance).toBeLessThan(0.5)
  })
})

describe('insertNodeAt', () => {
  it('inserts between the nodes of the clicked segment, in scene coordinates', () => {
    const el = withAbsolutePoints(createLinear('line', 10, 10), [[10, 10], [110, 10], [110, 110]])
    const r = insertNodeAt(el, 110, 60)!
    expect(r.index).toBe(2)
    expect(r.element.points).toHaveLength(4)
    expect(r.element.x + r.element.points[2][0]).toBeCloseTo(110)
    expect(r.element.y + r.element.points[2][1]).toBeCloseTo(60)
  })

  it('puts the new node on the original curve at the right index', () => {
    const el = { ...withAbsolutePoints(createLinear('line', 0, 0), pts), roundness: { type: 2 } }
    const segs = getCurveSegments(el.points)
    const on = bezierAt(segs[1], 0.6)
    const r = insertNodeAt(el, el.x + on.x + 0.5, el.y + on.y)!
    expect(r.index).toBe(2)
    expect(r.element.points).toHaveLength(4)
    const [nx, ny] = r.element.points[2]
    // within the flattening tolerance of the old curve
    const d = Math.min(...Array.from({ length: 401 }, (_, i) => bezierAt(segs[1], i / 400)).map((q) => Math.hypot(q.x - nx, q.y - ny)))
    expect(d).toBeLessThan(0.5)
  })

  it('keeps the node under the click on a rotated element', () => {
    const base = withAbsolutePoints(createLinear('line', 0, 0), [[0, 0], [100, 0], [100, 100]])
    const el = { ...base, angle: Math.PI / 6 }
    const c = getBoxCenter(getElementBox(el))
    // the rotated first segment, midway
    const click = rotatePoint(50, 0, c.x, c.y, el.angle)
    const r = insertNodeAt(el, click.x, click.y)!
    expect(r.index).toBe(1)
    expect(r.element.angle).toBe(0)
    expect(r.element.x + r.element.points[1][0]).toBeCloseTo(click.x)
    expect(r.element.y + r.element.points[1][1]).toBeCloseTo(click.y)
    const xs = r.element.points.map((p) => p[0])
    const ys = r.element.points.map((p) => p[1])
    expect(r.element.points[0]).toEqual([0, 0])
    expect(r.element.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs))
    expect(r.element.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys))
  })
})

describe('node handles', () => {
  it('a line shows a handle on every node and no midpoint handles', () => {
    const el = withAbsolutePoints(createLinear('line', 0, 0), pts)
    const kinds = getHandlePositions(el, 1).map((h) => h.handle.kind)
    expect(kinds.filter((k) => k === 'point')).toHaveLength(3)
    expect(kinds).not.toContain('mid')
    expect(hitHandle(el, 100, 2, 1)).toEqual({ kind: 'point', index: 1 })
    expect(hitHandle(el, 50, 0, 1)).toBeNull()
  })
})
