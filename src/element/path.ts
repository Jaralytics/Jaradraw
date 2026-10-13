import type { LinearElement, Point } from './types'

export interface Vec2 {
  x: number
  y: number
}

/** Cubic bezier as absolute-or-relative control points, in the coordinates of the input points. */
export type Bezier = readonly [Vec2, Vec2, Vec2, Vec2]

const STEPS = 14

const v = (p: Point): Vec2 => ({ x: p[0], y: p[1] })

/** Catmull-Rom spline through the points expressed as cubic beziers (one per segment). */
export function getCurveSegments(points: readonly Point[]): Bezier[] {
  const n = points.length
  const out: Bezier[] = []
  for (let i = 0; i < n - 1; i++) {
    const p0 = v(points[Math.max(i - 1, 0)])
    const p1 = v(points[i])
    const p2 = v(points[i + 1])
    const p3 = v(points[Math.min(i + 2, n - 1)])
    out.push([
      p1,
      { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    ])
  }
  return out
}

export function bezierAt(b: Bezier, t: number): Vec2 {
  const u = 1 - t
  const a = u * u * u
  const c1 = 3 * u * u * t
  const c2 = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * b[0].x + c1 * b[1].x + c2 * b[2].x + d * b[3].x,
    y: a * b[0].y + c1 * b[1].y + c2 * b[2].y + d * b[3].y,
  }
}

/** A curve is drawn only for roundness-carrying elements with at least three points. */
export function isCurved(el: Pick<LinearElement, 'roundness' | 'points'>): boolean {
  return el.roundness !== null && el.points.length > 2
}

const flatCache = new WeakMap<readonly Point[], Vec2[]>()

/** Polyline approximating the drawn path, in the coordinates of `points` (relative to the element). */
export function flattenPath(points: readonly Point[], curved: boolean): Vec2[] {
  if (!curved) return points.map(v)
  const cached = flatCache.get(points)
  if (cached) return cached
  const out: Vec2[] = [v(points[0])]
  for (const seg of getCurveSegments(points)) {
    for (let k = 1; k <= STEPS; k++) out.push(bezierAt(seg, k / STEPS))
  }
  flatCache.set(points, out)
  return out
}

export function flattenElementPath(el: LinearElement): Vec2[] {
  return flattenPath(el.points, isCurved(el))
}

/** Point at half the length of the path, relative to the element origin. */
export function pathMidpoint(path: readonly Vec2[]): Vec2 {
  if (path.length === 0) return { x: 0, y: 0 }
  let total = 0
  for (let i = 0; i < path.length - 1; i++) {
    total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y)
  }
  let remaining = total / 2
  for (let i = 0; i < path.length - 1; i++) {
    const len = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y)
    if (len >= remaining && len > 0) {
      const t = remaining / len
      return { x: path[i].x + (path[i + 1].x - path[i].x) * t, y: path[i].y + (path[i + 1].y - path[i].y) * t }
    }
    remaining -= len
  }
  return path[path.length - 1]
}

export interface PathHit {
  /** Segment between points `segment` and `segment + 1` that holds the closest position. */
  segment: number
  point: Vec2
  distance: number
}

/** Closest position on the drawn path (flattened for curves) to (x, y), in the coordinates of `points`. */
export function closestPathPoint(points: readonly Point[], curved: boolean, x: number, y: number): PathHit | null {
  if (points.length < 2) return null
  const flat = flattenPath(points, curved)
  const per = curved ? STEPS : 1
  let best: PathHit | null = null
  for (let i = 0; i < flat.length - 1; i++) {
    const a = flat[i]
    const b = flat[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq))
    const point = { x: a.x + t * dx, y: a.y + t * dy }
    const distance = Math.hypot(x - point.x, y - point.y)
    if (!best || distance < best.distance) best = { segment: Math.floor(i / per), point, distance }
  }
  return best
}

/**
 * A point behind the tip along the path tangent: the previous control point for curves,
 * the neighbouring vertex for polylines. `atEnd` selects the last or first point.
 */
export function tangentSource(el: LinearElement, atEnd: boolean): Vec2 {
  const pts = el.points
  const n = pts.length
  if (isCurved(el)) {
    const segs = getCurveSegments(pts)
    const seg = atEnd ? segs[segs.length - 1] : segs[0]
    const c = atEnd ? seg[2] : seg[1]
    const tip = atEnd ? seg[3] : seg[0]
    if (Math.hypot(c.x - tip.x, c.y - tip.y) > 1e-6) return c
  }
  return atEnd ? v(pts[n - 2]) : v(pts[1])
}
