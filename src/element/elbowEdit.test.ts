import { describe, expect, it } from 'vitest'
import { ELBOW_PADDING } from './elbow'
import { dragElbow, isCorner } from './elbowEdit'

type V = { x: number; y: number }
const v = (x: number, y: number): V => ({ x, y })
const free = { start: false, end: false }
const bound = { start: true, end: true }

function expectOrthogonal(poly: V[]) {
  poly.forEach((q, i) => {
    if (i === 0) return
    const p = poly[i - 1]
    expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeGreaterThan(0)
    expect(Math.abs(q.x - p.x) < 1e-9 || Math.abs(q.y - p.y) < 1e-9).toBe(true)
  })
}

describe('dragElbow', () => {
  const z = [v(0, 0), v(100, 0), v(100, 100), v(200, 100), v(200, 200)]

  it('moves a middle segment between two real corners by changing only the shared coordinate', () => {
    const out = dragElbow(z, { kind: 'segment', index: 2 }, v(0, 30), free)
    expect(out).toEqual([v(0, 0), v(100, 0), v(100, 130), v(200, 130), v(200, 200)])
    expectOrthogonal(out)
  })

  it('moves a corner with both adjacent segments', () => {
    const out = dragElbow(z, { kind: 'node', index: 0 }, v(20, -20), free)
    expect(out).toEqual([v(0, -20), v(120, -20), v(120, 100), v(200, 100), v(200, 200)])
    expectOrthogonal(out)
  })

  it('keeps the anchor of a bound start and inserts a stub plus a connector', () => {
    const poly = [v(0, 25), v(200, 25), v(200, 125)]
    const out = dragElbow(poly, { kind: 'segment', index: 0 }, v(0, -40), { start: true, end: false })
    expect(out).toEqual([v(0, 25), v(ELBOW_PADDING, 25), v(ELBOW_PADDING, -15), v(200, -15), v(200, 125)])
    expectOrthogonal(out)
  })

  it('shortens the stub to half the segment on a short bound segment', () => {
    const poly = [v(0, 25), v(20, 25), v(20, 125)]
    const out = dragElbow(poly, { kind: 'segment', index: 0 }, v(0, -40), { start: true, end: false })
    expect(out[1]).toEqual(v(10, 25))
  })

  it('moves a free end with its segment', () => {
    const poly = [v(0, 0), v(0, 100), v(200, 100)]
    const out = dragElbow(poly, { kind: 'segment', index: 1 }, v(0, 50), free)
    expect(out).toEqual([v(0, 0), v(0, 150), v(200, 150)])
  })

  it('slides a split node only along its run, never past its neighbours', () => {
    const poly = [v(0, 0), v(100, 0), v(300, 0)]
    expect(isCorner(poly, 1)).toBe(false)
    expect(dragElbow(poly, { kind: 'node', index: 0 }, v(50, 50), free)).toEqual([v(0, 0), v(150, 0), v(300, 0)])
    expect(dragElbow(poly, { kind: 'node', index: 0 }, v(900, 0), free)).toEqual([v(0, 0), v(300, 0)])
  })

  it('builds the bump over an obstacle and flattens it back', () => {
    const line = [v(0, 25), v(100, 25), v(200, 25), v(300, 25)]
    const up = dragElbow(line, { kind: 'segment', index: 1 }, v(0, -50), bound)
    expect(up).toEqual([v(0, 25), v(100, 25), v(100, -25), v(200, -25), v(200, 25), v(300, 25)])
    expectOrthogonal(up)
    expect(dragElbow(up, { kind: 'segment', index: 2 }, v(0, 50), bound)).toEqual(line)
  })

  it('applies grid snapping to the dragged coordinate', () => {
    const out = dragElbow(z, { kind: 'segment', index: 2 }, v(0, 33), free, (p) => ({ x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 }))
    expect(out[2]).toEqual(v(100, 140))
  })
  it('drags vertical segments, the first and the last', () => {
    const poly = [v(0, 0), v(0, 100), v(100, 100), v(100, 200)]
    expect(dragElbow(poly, { kind: 'segment', index: 2 }, v(40, 0), free)).toEqual([v(0, 0), v(0, 100), v(140, 100), v(140, 200)])
    expect(dragElbow(poly, { kind: 'segment', index: 0 }, v(30, 0), free)).toEqual([v(30, 0), v(30, 100), v(100, 100), v(100, 200)])
  })

  it('keeps a bound last end anchored with a stub and a connector', () => {
    const poly = [v(0, 0), v(0, 100), v(200, 100)]
    const out = dragElbow(poly, { kind: 'segment', index: 1 }, v(0, -40), { start: false, end: true })
    expect(out).toEqual([v(0, 0), v(0, 60), v(200 - ELBOW_PADDING, 60), v(200 - ELBOW_PADDING, 100), v(200, 100)])
  })

  it('moves the middle third of a short segment bound at both ends', () => {
    const out = dragElbow([v(0, 0), v(40, 0)], { kind: 'segment', index: 0 }, v(0, 30), bound)
    const want = [v(0, 0), v(40 / 3, 0), v(40 / 3, 30), v(80 / 3, 30), v(80 / 3, 0), v(40, 0)]
    expect(out).toHaveLength(6)
    out.forEach((q, i) => {
      expect(q.x).toBeCloseTo(want[i].x)
      expect(q.y).toBeCloseTo(want[i].y)
    })
  })

  it('returns the input for a zero delta', () => {
    expect(dragElbow(z, { kind: 'segment', index: 2 }, v(0, 0), free)).toEqual(z)
    const line = [v(0, 25), v(100, 25), v(200, 25), v(300, 25)]
    expect(dragElbow(line, { kind: 'segment', index: 1 }, v(0, 0), bound)).toEqual(line)
    expect(dragElbow(z, { kind: 'node', index: 0 }, v(0, 0), bound)).toEqual(z)
  })

  it('does not let a drag cross the anchor of a bound end', () => {
    const poly = [v(0, 0), v(100, 0), v(100, 100), v(200, 100)]
    const seg = dragElbow(poly, { kind: 'segment', index: 1 }, v(-150, 0), { start: true, end: false })
    expect(seg).toEqual([v(0, 0), v(8, 0), v(8, 100), v(200, 100)])
    const corner = dragElbow(poly, { kind: 'node', index: 0 }, v(-150, 30), { start: true, end: false })
    expect(corner.slice(0, 4).map((q) => q.x)).toEqual([0, 4, 4, 8])
    expectOrthogonal(corner)
    // the end that is free is not constrained
    expect(dragElbow(poly, { kind: 'segment', index: 1 }, v(-150, 0), free)[1].x).toBe(-50)
  })

  it('drags a corner next to a split node', () => {
    const poly = [v(0, 0), v(100, 0), v(200, 0), v(200, 100)]
    const out = dragElbow(poly, { kind: 'node', index: 1 }, v(60, -30), free)
    expect(out).toEqual([v(0, 0), v(100, 0), v(100, -30), v(260, -30), v(260, 100)])
    expectOrthogonal(out)
  })
})
