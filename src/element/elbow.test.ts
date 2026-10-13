import { describe, expect, it } from 'vitest'
import { createShape } from './factory'
import { ELBOW_PADDING, routeElbow, sideAnchor } from './elbow'
import type { ElbowEnd, ElbowRoute, Heading } from './elbow'
import { getElementCenter } from './geometry'
import type { Vec } from './geometry'

type Bounds = [number, number, number, number]

const bound = (box: Bounds): ElbowEnd => ({ point: { x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 }, box })
const free = (x: number, y: number): ElbowEnd => ({ point: { x, y }, box: null })

const shape = (type: 'rectangle' | 'ellipse' | 'diamond', x: number, y: number, w: number, h: number, angle = 0) => ({
  ...createShape(type, x, y),
  width: w,
  height: h,
  angle,
})

const travel = (a: Vec, b: Vec): Heading => (b.x > a.x ? 'right' : b.x < a.x ? 'left' : b.y > a.y ? 'down' : 'up')
const opposite = (h: Heading): Heading => ({ right: 'left', left: 'right', up: 'down', down: 'up' })[h] as Heading
const sideMids = (b: Bounds): Vec[] => [
  { x: b[2], y: (b[1] + b[3]) / 2 },
  { x: (b[0] + b[2]) / 2, y: b[3] },
  { x: b[0], y: (b[1] + b[3]) / 2 },
  { x: (b[0] + b[2]) / 2, y: b[1] },
]
const zero = (n: number) => n + 0

function expectOnSideMid(p: Vec, box: Bounds) {
  expect(sideMids(box)).toContainEqual(p)
}

function expectClean(route: ElbowRoute) {
  const pts = route.points
  expect(pts.length).toBeGreaterThanOrEqual(2)
  for (let i = 1; i < pts.length; i++) {
    expect(pts[i - 1].x === pts[i].x || pts[i - 1].y === pts[i].y).toBe(true)
    expect(Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y)).toBeGreaterThan(0)
  }
  for (let i = 2; i < pts.length; i++) {
    const collinear = (pts[i - 2].x === pts[i - 1].x && pts[i - 1].x === pts[i].x) || (pts[i - 2].y === pts[i - 1].y && pts[i - 1].y === pts[i].y)
    expect(collinear).toBe(false)
  }
  expect(route.startHeading).toBe(travel(pts[0], pts[1]))
  expect(route.endHeading).toBe(opposite(travel(pts[pts.length - 2], pts[pts.length - 1])))
}

function crossesInterior(route: ElbowRoute, box: Bounds): boolean {
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]
    const b = route.points[i]
    const ox = Math.min(Math.max(a.x, b.x), box[2]) - Math.max(Math.min(a.x, b.x), box[0])
    const oy = Math.min(Math.max(a.y, b.y), box[3]) - Math.max(Math.min(a.y, b.y), box[1])
    if (ox > 1e-6 && oy > 1e-6) return true
    if (a.y === b.y && a.y > box[1] && a.y < box[3] && ox > 1e-6) return true
    if (a.x === b.x && a.x > box[0] && a.x < box[2] && oy > 1e-6) return true
  }
  return false
}

const mirrorBox = (b: Bounds): Bounds => [-b[2], b[1], -b[0], b[3]]
const mirrorHeading = (h: Heading): Heading => (h === 'left' ? 'right' : h === 'right' ? 'left' : h)

describe('routeElbow placement', () => {
  const A: Bounds = [0, 0, 100, 60]

  it('goes straight when the target is to the right', () => {
    const r = routeElbow(bound(A), bound([300, 0, 400, 60]))
    expect(r.points).toEqual([
      { x: 100, y: 30 },
      { x: 300, y: 30 },
    ])
    expect(r.startHeading).toBe('right')
    expect(r.endHeading).toBe('left')
  })

  it('goes straight when the target is below', () => {
    const r = routeElbow(bound(A), bound([0, 200, 100, 260]))
    expect(r.points).toEqual([
      { x: 50, y: 60 },
      { x: 50, y: 200 },
    ])
    expect(r.startHeading).toBe('down')
    expect(r.endHeading).toBe('up')
  })

  it('uses a single bend for a diagonal target', () => {
    const r = routeElbow(bound(A), bound([300, 200, 400, 260]))
    expectClean(r)
    expect(r.points).toHaveLength(3)
    expectOnSideMid(r.points[0], A)
    expectOnSideMid(r.points[2], [300, 200, 400, 260])
    const pair = `${r.startHeading}-${r.endHeading}`
    expect(['right-up', 'down-left']).toContain(pair)
  })

  it('uses a Z for a diagonal target with a clear lateral gap', () => {
    const r = routeElbow(bound([0, 0, 100, 60]), bound([300, 8, 400, 68]))
    expectClean(r)
    expect(r.startHeading).toBe('right')
    expect(r.endHeading).toBe('left')
    expect(r.points).toHaveLength(4)
    expect(r.points[0]).toEqual({ x: 100, y: 30 })
    expect(r.points[3]).toEqual({ x: 300, y: 38 })
  })

  it('goes straight through a small gap between side by side boxes', () => {
    const b1: Bounds = [0, 0, 100, 60]
    const b2: Bounds = [110, 0, 210, 60]
    const r = routeElbow(bound(b1), bound(b2))
    expect(r.points).toEqual([
      { x: 100, y: 30 },
      { x: 110, y: 30 },
    ])
    expect(r.startHeading).toBe('right')
    expect(r.endHeading).toBe('left')
    expectClean(r)
  })

  it('goes straight for gaps of 1, 5 and 15 px', () => {
    for (const gap of [1, 5, 15]) {
      const r = routeElbow(bound([0, 0, 100, 60]), bound([100 + gap, 0, 200 + gap, 60]))
      expect(r.points).toEqual([
        { x: 100, y: 30 },
        { x: 100 + gap, y: 30 },
      ])
    }
  })

  it('bends through the gap when a small gap has a vertical offset', () => {
    const b1: Bounds = [0, 0, 100, 60]
    const b2: Bounds = [110, 10, 210, 70]
    const r = routeElbow(bound(b1), bound(b2))
    expectClean(r)
    expect(r.points).toEqual([
      { x: 100, y: 30 },
      { x: 105, y: 30 },
      { x: 105, y: 40 },
      { x: 110, y: 40 },
    ])
    expect(r.startHeading).toBe('right')
    expect(r.endHeading).toBe('left')
  })

  it('wraps around touching boxes without crossing them', () => {
    const b1: Bounds = [0, 0, 100, 60]
    const b2: Bounds = [100, 0, 200, 60]
    const r = routeElbow(bound(b1), bound(b2))
    expectClean(r)
    expect(crossesInterior(r, b1)).toBe(false)
    expect(crossesInterior(r, b2)).toBe(false)
  })

  it('routes zero-size boxes', () => {
    expectClean(routeElbow(bound([0, 0, 0, 0]), bound([100, 50, 100, 50])))
    expectClean(routeElbow(bound([0, 0, 0, 0]), bound([0, 0, 0, 0])))
  })

  it('routes boxes in negative coordinates', () => {
    const r = routeElbow(bound([-300, -200, -200, -140]), bound([-100, -300, 0, -240]))
    expectClean(r)
    expectOnSideMid(r.points[0], [-300, -200, -200, -140])
    expectOnSideMid(r.points[r.points.length - 1], [-100, -300, 0, -240])
  })

  it('returns an axis-aligned route for overlapping and nested boxes', () => {
    const overlap = routeElbow(bound([0, 0, 100, 100]), bound([50, 50, 150, 150]))
    expectClean(overlap)
    const nested = routeElbow(bound([0, 0, 200, 200]), bound([50, 50, 100, 100]))
    expectClean(nested)
    const same = routeElbow(bound([0, 0, 100, 100]), bound([0, 0, 100, 100]))
    expectClean(same)
  })
})

describe('routeElbow free ends', () => {
  it('starts at a free start point', () => {
    const r = routeElbow(free(0, 0), bound([200, 100, 300, 160]))
    expectClean(r)
    expect(r.points[0]).toEqual({ x: 0, y: 0 })
    const last = r.points[r.points.length - 1]
    expect([
      { x: 200, y: 130 },
      { x: 300, y: 130 },
      { x: 250, y: 100 },
      { x: 250, y: 160 },
    ]).toContainEqual(last)
  })

  it('ends at a free end point', () => {
    const r = routeElbow(bound([0, 0, 100, 60]), free(300, 200))
    expectClean(r)
    expect(r.points[r.points.length - 1]).toEqual({ x: 300, y: 200 })
    expect(r.endHeading).toBe('up')
    expect(r.startHeading).toBe('right')
  })

  it('connects two free ends', () => {
    const r = routeElbow(free(0, 0), free(100, 50))
    expectClean(r)
    expect(r.points[0]).toEqual({ x: 0, y: 0 })
    expect(r.points[r.points.length - 1]).toEqual({ x: 100, y: 50 })
    expect(r.points).toHaveLength(3)
    expect(r.startHeading).toBe('down')
    expect(r.endHeading).toBe('left')
  })

  it('handles a free end inside the other box', () => {
    const box: Bounds = [0, 0, 100, 60]
    const r = routeElbow(free(50, 30), bound(box))
    expectClean(r)
    expect(r.points[0]).toEqual({ x: 50, y: 30 })
    expectOnSideMid(r.points[r.points.length - 1], box)
    const r2 = routeElbow(bound(box), free(50, 30))
    expectClean(r2)
    expect(r2.points[r2.points.length - 1]).toEqual({ x: 50, y: 30 })
  })

  it('keeps a near-coincident free pair axis-aligned', () => {
    const r = routeElbow(free(5, 5), free(5.4, 5.4))
    expectClean(r)
    expect(r.points[0]).toEqual({ x: 5, y: 5 })
    expect(r.points[r.points.length - 1]).toEqual({ x: 5.4, y: 5.4 })
  })

  it('returns two identical points when both free ends are exactly equal', () => {
    const r = routeElbow(free(5, 5), free(5, 5))
    expect(r.points).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ])
    expect(r.startHeading).toBe('right')
    expect(r.endHeading).toBe('left')
  })
})

describe('sideAnchor', () => {
  it('lies on a rotated diamond outline plus gap', () => {
    const el = shape('diamond', 100, 100, 120, 80, Math.PI / 5)
    const c = getElementCenter(el)
    for (const h of ['right', 'down', 'left', 'up'] as const) {
      const p0 = sideAnchor(el, h, 0)
      const local = {
        x: Math.cos(-el.angle) * (p0.x - c.x) - Math.sin(-el.angle) * (p0.y - c.y),
        y: Math.sin(-el.angle) * (p0.x - c.x) + Math.cos(-el.angle) * (p0.y - c.y),
      }
      expect(Math.abs(local.x) / 60 + Math.abs(local.y) / 40).toBeCloseTo(1, 6)
      const p6 = sideAnchor(el, h, 6)
      expect(Math.hypot(p6.x - p0.x, p6.y - p0.y)).toBeCloseTo(6, 6)
    }
  })

  it('lies on an ellipse outline plus gap', () => {
    const el = shape('ellipse', 0, 0, 200, 100)
    const c = getElementCenter(el)
    for (const h of ['right', 'down', 'left', 'up'] as const) {
      const p0 = sideAnchor(el, h, 0)
      expect(((p0.x - c.x) / 100) ** 2 + ((p0.y - c.y) / 50) ** 2).toBeCloseTo(1, 6)
      const p5 = sideAnchor(el, h, 5)
      expect(Math.hypot(p5.x - p0.x, p5.y - p0.y)).toBeCloseTo(5, 6)
    }
    expect(sideAnchor(el, 'right', 0).x).toBeCloseTo(200, 6)
    expect(sideAnchor(el, 'up', 0).y).toBeCloseTo(0, 6)
  })

  it('uses the project default gap on a rectangle', () => {
    const el = shape('rectangle', 0, 0, 100, 60)
    expect(sideAnchor(el, 'right').x).toBeGreaterThan(100)
    expect(sideAnchor(el, 'right', 0)).toEqual({ x: 100, y: 30 })
  })
})

describe('routeElbow properties', () => {
  const pad2 = 2 * ELBOW_PADDING
  const base: Bounds = [0, 0, 100, 60]
  const separated: Bounds[] = [
    [100 + pad2, 0, 200 + pad2, 60],
    [-100 - pad2, 0, -pad2, 60],
    [0, 60 + pad2, 100, 120 + pad2],
    [0, -60 - pad2, 100, -pad2],
    [100 + pad2, 60 + pad2, 200 + pad2, 120 + pad2],
    [-100 - pad2, -60 - pad2, -pad2, -pad2],
    [100 + pad2, -40, 160 + pad2, 20],
    [30, 60 + pad2, 70, 200],
    [-300, 200, -20, 400],
  ]

  it('never crosses a box when boxes are separated by twice the padding', () => {
    for (const other of separated) {
      for (const [a, b] of [
        [base, other],
        [other, base],
      ]) {
        const r = routeElbow(bound(a), bound(b))
        expectClean(r)
        expect(crossesInterior(r, a)).toBe(false)
        expect(crossesInterior(r, b)).toBe(false)
      }
    }
  })

  it('is deterministic', () => {
    for (const other of separated) {
      expect(routeElbow(bound(base), bound(other))).toEqual(routeElbow(bound(base), bound(other)))
    }
  })

  it('mirrors horizontally', () => {
    const cases: [ElbowEnd, ElbowEnd][] = [
      [bound(base), bound([300, 0, 400, 60])],
      [bound(base), bound([0, 200, 100, 260])],
      [bound(base), bound([300, 8, 400, 68])],
      [bound(base), bound([320, 200, 460, 260])],
      [bound(base), bound([110, 0, 210, 60])],
      [free(0, 0), bound([200, 100, 300, 160])],
    ]
    const mirrorEnd = (e: ElbowEnd): ElbowEnd => ({ point: { x: -e.point.x, y: e.point.y }, box: e.box && mirrorBox(e.box) })
    for (const [s, e] of cases) {
      const r = routeElbow(s, e)
      const m = routeElbow(mirrorEnd(s), mirrorEnd(e))
      expect(m.points.map((p: Vec) => ({ x: zero(p.x), y: p.y }))).toEqual(r.points.map((p: Vec) => ({ x: zero(-p.x), y: p.y })))
      expect(m.startHeading).toBe(mirrorHeading(r.startHeading))
      expect(m.endHeading).toBe(mirrorHeading(r.endHeading))
    }
  })

  it('always returns clean axis-aligned routes on a grid', () => {
    const coords = [-120, -40, 0, 30, 90, 160]
    for (const x of coords) {
      for (const y of coords) {
        const target: Bounds = [x, y, x + 80, y + 50]
        const r = routeElbow(bound(base), bound(target))
        expectClean(r)
        expectOnSideMid(r.points[0], base)
        expectOnSideMid(r.points[r.points.length - 1], target)
        const r2 = routeElbow(bound(base), free(x, y))
        expectClean(r2)
        expectOnSideMid(r2.points[0], base)
        expect(r2.points[r2.points.length - 1]).toEqual({ x, y })
        const r3 = routeElbow(free(x, y), bound(base))
        expectClean(r3)
        expect(r3.points[0]).toEqual({ x, y })
        expectOnSideMid(r3.points[r3.points.length - 1], base)
      }
    }
  })
})

describe('routeElbow balance and flags', () => {
  it('puts the bend in the middle of the gap', () => {
    const down = routeElbow(bound([560, 120, 700, 190]), bound([380, 290, 520, 360]), { start: 'down', end: 'up' })
    expect(down.points).toEqual([
      { x: 630, y: 190 },
      { x: 630, y: 240 },
      { x: 450, y: 240 },
      { x: 450, y: 290 },
    ])
    const right = routeElbow(bound([300, 300, 440, 370]), bound([540, 500, 680, 570]))
    expect(right.points).toEqual([
      { x: 440, y: 335 },
      { x: 490, y: 335 },
      { x: 490, y: 535 },
      { x: 540, y: 535 },
    ])
  })

  it('reports bends and whether the route is clean', () => {
    const z = routeElbow(bound([0, 0, 100, 60]), bound([300, 8, 400, 68]))
    expect(z.bends).toBe(2)
    expect(z.clean).toBe(true)
    const pinned = routeElbow(bound([0, 0, 100, 60]), bound([0, -200, 100, -140]), { start: 'down', end: 'down' })
    expect(pinned.clean).toBe(false)
  })

  it('pins the sides of bound ends', () => {
    const r = routeElbow(bound([0, 0, 100, 60]), bound([300, 200, 400, 260]), { start: 'down', end: 'left' })
    expect(r.startHeading).toBe('down')
    expect(r.endHeading).toBe('left')
  })
})
