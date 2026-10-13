import type { LinearElement } from './types'
import { bakeAngle, getAbsolutePoints } from './geometry'
import type { Vec } from './geometry'
import { ELBOW_PADDING } from './elbow'
import { readWaypoints } from './waypoints'

const EPS = 1e-6
/** Least distance kept between a bound anchor and the vertex after it, so the arrow still leaves the shape. */
const MIN_STUB = 8

/** Which ends of the arrow sit on a shape: those anchors never move by hand. */
export interface EditEnds {
  start: boolean
  end: boolean
}

/** A vertex of an edit; `fresh` marks connector vertices created by the edit itself. */
interface Item {
  p: Vec
  fresh: boolean
}

export type ElbowTarget = { kind: 'segment'; index: number } | { kind: 'node'; index: number }

const same = (a: Vec, b: Vec) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
const horizontal = (a: Vec, b: Vec) => Math.abs(a.y - b.y) < EPS
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)

/** Closest point of the polyline to `p`, with its segment and its distance along the path. */
export function closestOnPolyline(poly: readonly Vec[], p: Vec): { segment: number; point: Vec; arc: number; distance: number } {
  let best = { segment: 0, point: poly[0], arc: 0, distance: Infinity }
  let run = 0
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]
    const b = poly[i + 1]
    const len = dist(a, b)
    const t = len < EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)))
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    const distance = dist(p, point)
    if (distance < best.distance - EPS) best = { segment: i, point, arc: run + len * t, distance }
    run += len
  }
  return best
}

/** Nodes of an elbow arrow: the interior vertices of its route plus pinned nodes on a straight run, in path order. */
export function elbowNodes(el: LinearElement): Vec[] {
  const base = bakeAngle(el)
  const pts = getAbsolutePoints(base).map(([x, y]) => ({ x, y }))
  if (pts.length < 2) return []
  const items: { arc: number; p: Vec }[] = []
  let run = 0
  for (let i = 1; i < pts.length - 1; i++) {
    run += dist(pts[i - 1], pts[i])
    items.push({ arc: run, p: pts[i] })
  }
  for (const [wx, wy] of readWaypoints(base)) {
    const w = { x: base.x + wx, y: base.y + wy }
    if (items.some((it) => same(it.p, w)) || same(w, pts[0]) || same(w, pts[pts.length - 1])) continue
    items.push({ arc: closestOnPolyline(pts, w).arc, p: w })
  }
  return items.sort((a, b) => a.arc - b.arc).map((it) => it.p)
}

/** [start, ...nodes, end] in scene coordinates: the polyline the edits operate on. */
export function editPolyline(el: LinearElement): Vec[] {
  const base = bakeAngle(el)
  const pts = getAbsolutePoints(base).map(([x, y]) => ({ x, y }))
  if (pts.length < 2) return pts
  return [pts[0], ...elbowNodes(base), pts[pts.length - 1]]
}

/** True when the vertex joins a horizontal and a vertical segment (a real corner). */
export function isCorner(poly: readonly Vec[], i: number): boolean {
  if (i <= 0 || i >= poly.length - 1) return false
  if (same(poly[i - 1], poly[i]) || same(poly[i], poly[i + 1])) return false
  return horizontal(poly[i - 1], poly[i]) !== horizontal(poly[i], poly[i + 1])
}

/**
 * Replacement of vertex `k` of the segment being moved (`other` is its far vertex, `h` its orientation),
 * ordered from the outside of the polyline towards the moved segment.
 */
function relocate(poly: readonly Vec[], k: number, outer: number, to: Vec, bound: boolean, other: Vec, h: boolean, third = false, limit = Infinity): Item[] {
  const v = poly[k]
  if (outer < 0 || outer >= poly.length) {
    if (!bound) return [{ p: to, fresh: false }]
    // the anchor stays; a stub keeps the arrow leaving the shape along its original direction
    const len = dist(v, other)
    // a short segment bound at both ends gives each stub a third, so its middle third can move
    const stub = third ? len / 3 : Math.min(ELBOW_PADDING, len / 2, limit)
    const u = len < EPS ? { x: 0, y: 0 } : { x: (other.x - v.x) / len, y: (other.y - v.y) / len }
    const s = { x: v.x + u.x * stub, y: v.y + u.y * stub }
    const moved = h ? { x: s.x, y: to.y } : { x: to.x, y: s.y }
    return [{ p: v, fresh: false }, { p: s, fresh: true }, { p: moved, fresh: true }]
  }
  const n = poly[outer]
  const collinear = h ? Math.abs(n.y - v.y) < EPS : Math.abs(n.x - v.x) < EPS
  return collinear ? [{ p: v, fresh: false }, { p: to, fresh: true }] : [{ p: to, fresh: false }]
}

const old = (pts: readonly Vec[]): Item[] => pts.map((p) => ({ p, fresh: false }))

/** Moves segment `i` (between vertices i and i + 1) perpendicular to itself to the coordinate `coord`. */
function moveSegment(poly: readonly Vec[], i: number, coord: number, bound: EditEnds): Item[] {
  const a = poly[i]
  const b = poly[i + 1]
  const h = horizontal(a, b)
  const to = (q: Vec): Vec => (h ? { x: q.x, y: coord } : { x: coord, y: q.y })
  const third = i === 0 && i + 2 >= poly.length && bound.start && bound.end && dist(a, b) < 2 * ELBOW_PADDING
  const left = relocate(poly, i, i - 1, to(a), bound.start, b, h, third)
  const right = relocate(poly, i + 1, i + 2, to(b), bound.end, a, h, third).reverse()
  return [...old(poly.slice(0, i)), ...left, ...right, ...old(poly.slice(i + 2))]
}

/** Moves the corner at vertex `vi` to `target`, dragging both adjacent segments with it. */
function moveCorner(poly: readonly Vec[], vi: number, target: Vec, bound: EditEnds): Item[] {
  const p = poly[vi - 1]
  const v = poly[vi]
  const q = poly[vi + 1]
  const h1 = horizontal(p, v)
  const h2 = horizontal(v, q)
  const line = (h: boolean, c: Vec): Vec => (h ? { x: c.x, y: target.y } : { x: target.x, y: c.y })
  // next to an anchor the stub must end before the corner's new position
  const reach = (a: Vec, h: boolean) => Math.abs(h ? target.x - a.x : target.y - a.y) / 2
  const left = relocate(poly, vi - 1, vi - 2, line(h1, p), bound.start, v, h1, false, reach(p, h1))
  const right = relocate(poly, vi + 1, vi + 2, line(h2, q), bound.end, v, h2, false, reach(q, h2)).reverse()
  return [...old(poly.slice(0, vi - 1)), ...left, { p: target, fresh: false }, ...right, ...old(poly.slice(vi + 2))]
}

/** Slides a node lying on a straight run along that run only. */
function slideNode(poly: readonly Vec[], vi: number, target: Vec): Item[] {
  const p = poly[vi - 1]
  const v = poly[vi]
  const q = poly[vi + 1]
  const clamp = (x: number, a: number, b: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), x))
  const next = horizontal(p, q) ? { x: clamp(target.x, p.x, q.x), y: v.y } : { x: v.x, y: clamp(target.y, p.y, q.y) }
  return old(poly.map((c, i) => (i === vi ? next : c)))
}

const aligned = (a: Vec, b: Vec, c: Vec) =>
  (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS) || (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS)

/**
 * Removes zero-length segments and the connector vertices an edit left collinear (a flattened bump);
 * nodes that existed before the edit stay even when collinear.
 */
function tidy(items: Item[]): Vec[] {
  const out = items.slice()
  for (let k = 1; k < out.length; k++) {
    if (!same(out[k - 1].p, out[k].p)) continue
    // the ends stay; between two inner vertices the connector goes
    if (k - 1 === 0) out.splice(k, 1)
    else if (k === out.length - 1) out.splice(k - 1, 1)
    else out.splice(out[k].fresh || !out[k - 1].fresh ? k : k - 1, 1)
    k = Math.max(0, k - 2)
  }
  for (let again = true; again; ) {
    again = false
    for (let k = 1; k < out.length - 1; k++) {
      if (out[k].fresh && aligned(out[k - 1].p, out[k].p, out[k + 1].p)) {
        out.splice(k, 1)
        again = true
        break
      }
    }
  }
  if (out.length < 2 && items.length >= 2) return [items[0].p, items[items.length - 1].p]
  return out.map((it) => it.p)
}

/**
 * Keeps the vertex after a bound anchor on the side the arrow leaves the shape: `value` is the new
 * coordinate on `axis` of the vertices listed in `moved`.
 */
function clampAway(poly: readonly Vec[], bound: EditEnds, moved: readonly number[], axis: 'x' | 'y', value: number): number {
  let out = value
  const ends = [
    { on: bound.start, e: 0, n: 1 },
    { on: bound.end, e: poly.length - 1, n: poly.length - 2 },
  ]
  for (const { on, e, n } of ends) {
    if (!on || n === e || !moved.includes(n)) continue
    const d = Math.sign(poly[n][axis] - poly[e][axis])
    if (d === 0) continue
    out = d > 0 ? Math.max(out, poly[e][axis] + MIN_STUB) : Math.min(out, poly[e][axis] - MIN_STUB)
  }
  return out
}

/**
 * Polyline after dragging a segment or a node by `delta`. `snap` maps the wanted position of the
 * dragged coordinate (grid snapping); results never contain zero-length segments.
 */
export function dragElbow(poly: readonly Vec[], target: ElbowTarget, delta: Vec, bound: EditEnds, snap: (p: Vec) => Vec = (p) => p): Vec[] {
  if (target.kind === 'segment') {
    const a = poly[target.index]
    const b = poly[target.index + 1]
    if (!a || !b) return poly.slice()
    const want = snap({ x: a.x + delta.x, y: a.y + delta.y })
    const h = horizontal(a, b)
    const axis = h ? 'y' : 'x'
    return tidy(moveSegment(poly, target.index, clampAway(poly, bound, [target.index, target.index + 1], axis, want[axis]), bound))
  }
  const vi = target.index + 1
  const v = poly[vi]
  if (!v || vi >= poly.length - 1) return poly.slice()
  const want = snap({ x: v.x + delta.x, y: v.y + delta.y })
  if (!isCorner(poly, vi)) return tidy(slideNode(poly, vi, want))
  const h1 = horizontal(poly[vi - 1], v)
  const h2 = horizontal(v, poly[vi + 1])
  // the neighbours of the corner move on the axis perpendicular to their segment
  const xs = [vi, ...(h1 ? [] : [vi - 1]), ...(h2 ? [] : [vi + 1])]
  const ys = [vi, ...(h1 ? [vi - 1] : []), ...(h2 ? [vi + 1] : [])]
  const to = { x: clampAway(poly, bound, xs, 'x', want.x), y: clampAway(poly, bound, ys, 'y', want.y) }
  return tidy(moveCorner(poly, vi, to, bound))
}

/** Jogs shorter than this next to a pinned node are the router fixing a fold, not a shape the user built. */
const FOLD_JOG = 16

/** True when the route arrives at the vertex `w` and goes back the way it came, at once or through a short jog. */
export function foldsAt(poly: readonly Vec[], w: Vec): boolean {
  const k = poly.findIndex((q) => same(q, w))
  if (k < 1 || k >= poly.length - 1) return false
  const dir = (a: Vec, b: Vec): Vec => {
    const len = dist(a, b)
    return len < EPS ? { x: 0, y: 0 } : { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  }
  const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y
  const into = dir(poly[k - 1], w)
  const out = dir(w, poly[k + 1])
  if (dot(into, out) < -0.5) return true
  const jog = dist(w, poly[k + 1]) < FOLD_JOG && Math.abs(dot(into, out)) < 0.5
  return jog && k + 2 < poly.length && dot(into, dir(poly[k + 1], poly[k + 2])) < -0.5
}
