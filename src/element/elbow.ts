import type { SceneElement } from './types'
import { getElementBounds } from './geometry'
import type { Vec } from './geometry'
import { outlinePointToward } from './bind'

export type Heading = 'up' | 'right' | 'down' | 'left'
type Bounds = [number, number, number, number]

export interface ElbowEnd {
  point: Vec
  /** AABB [minX, minY, maxX, maxY] of the bound shape; null for a free end. */
  box: Bounds | null
}

export interface ElbowRoute {
  points: Vec[]
  startHeading: Heading
  endHeading: Heading
  bends: number
  /** No crossing, no reversal and at most two bends. */
  clean: boolean
}

export const ELBOW_PADDING = 24
export const BEND_PENALTY = 30
export const CROSS_PENALTY = 1e6

const MIN_PADDING = 8
const EPS = 1e-9
const SCORE_EPS = 1e-6
const HEADINGS: readonly Heading[] = ['right', 'down', 'left', 'up']
const DIRS: Record<Heading, Vec> = {
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
}
const OPPOSITE: Record<Heading, Heading> = { right: 'left', down: 'up', left: 'right', up: 'down' }

interface Candidate {
  score: number
  flawed: boolean
  points: Vec[]
  si: number
  ei: number
}

function sideMidpoint(b: Bounds, h: Heading): Vec {
  const cx = (b[0] + b[2]) / 2
  const cy = (b[1] + b[3]) / 2
  if (h === 'right') return { x: b[2], y: cy }
  if (h === 'left') return { x: b[0], y: cy }
  if (h === 'down') return { x: cx, y: b[3] }
  return { x: cx, y: b[1] }
}

/** Point on the shape's outline (plus `gap`) at the middle of the given side of its rotated AABB. */
export function sideAnchor(shape: SceneElement, h: Heading, gap?: number): Vec {
  return outlinePointToward(shape, sideMidpoint(getElementBounds(shape), h), gap)
}

function headingOf(a: Vec, b: Vec): Heading {
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) return b.x >= a.x ? 'right' : 'left'
  return b.y >= a.y ? 'down' : 'up'
}

function samePoint(a: Vec, b: Vec): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
}

function dedupe(points: readonly Vec[]): Vec[] {
  const out: Vec[] = []
  for (const p of points) if (out.length === 0 || !samePoint(out[out.length - 1], p)) out.push(p)
  return out
}

/** Drops duplicate and collinear points, including the ones created by a path doubling back. */
function simplify(points: readonly Vec[]): Vec[] {
  const out: Vec[] = []
  for (const p of points) {
    if (out.length > 0 && samePoint(out[out.length - 1], p)) continue
    while (out.length >= 2) {
      const a = out[out.length - 2]
      const b = out[out.length - 1]
      const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - p.x) < EPS
      const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - p.y) < EPS
      if (!sameX && !sameY) break
      out.pop()
    }
    if (out.length > 0 && samePoint(out[out.length - 1], p)) continue
    out.push(p)
  }
  return out
}

/** True when the axis-aligned segment crosses the open interior of the box. */
function segmentCrossesBox(a: Vec, b: Vec, box: Bounds): boolean {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  if (maxY - minY < EPS) return minY > box[1] && minY < box[3] && Math.min(maxX, box[2]) - Math.max(minX, box[0]) > EPS
  return minX > box[0] && minX < box[2] && Math.min(maxY, box[3]) - Math.max(minY, box[1]) > EPS
}

function scorePath(raw: readonly Vec[], solids: readonly Bounds[]): { score: number; flawed: boolean; points: Vec[] } {
  const path = dedupe(raw)
  let score = 0
  let prev: Vec | null = null
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    score += Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    if (solids.some((box) => segmentCrossesBox(a, b, box))) score += CROSS_PENALTY
    const d = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) }
    if (prev && prev.x * d.x + prev.y * d.y < 0) score += CROSS_PENALTY
    prev = d
  }
  const points = simplify(path)
  score += BEND_PENALTY * Math.max(0, points.length - 2)
  return { score, flawed: score >= CROSS_PENALTY, points }
}

/** Stub length: half the gap when the boxes are apart on that axis, a fixed floor when they touch or overlap. */
function padFor(gap: number): number {
  return gap > 0 ? Math.min(ELBOW_PADDING, gap / 2) : MIN_PADDING
}

/** Length of the shorter end segment; a larger value puts the bends away from the shapes. */
function balanceOf(points: readonly Vec[]): number {
  const seg = (a: Vec, b: Vec) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
  const n = points.length
  return Math.min(seg(points[0], points[1]), seg(points[n - 2], points[n - 1]))
}

function isBetter(c: Candidate, best: Candidate | null): boolean {
  if (!best) return true
  if (Math.abs(c.score - best.score) > SCORE_EPS) return c.score < best.score
  if (c.points.length !== best.points.length) return c.points.length < best.points.length
  const balance = balanceOf(c.points) - balanceOf(best.points)
  if (Math.abs(balance) > SCORE_EPS) return balance > 0
  if (c.si !== best.si) return c.si < best.si
  return c.ei < best.ei
}

function stubFor(box: Bounds | null, point: Vec, h: Heading, padX: number, padY: number) {
  if (!box) return { anchor: point, tip: point }
  const anchor = sideMidpoint(box, h)
  const pad = h === 'left' || h === 'right' ? padX : padY
  return { anchor, tip: { x: anchor.x + DIRS[h].x * pad, y: anchor.y + DIRS[h].y * pad } }
}

export interface ElbowOptions {
  /** Pins the side a bound end uses (the side of its box the arrow leaves from or arrives at). */
  start?: Heading
  end?: Heading
  /** The route may not leave the start in this direction (it would double back along the previous leg). */
  forbidStart?: Heading
  /** Extra boxes the route should not cross. */
  obstacles?: readonly Bounds[]
}

export function routeElbow(start: ElbowEnd, end: ElbowEnd, sides: ElbowOptions = {}): ElbowRoute {
  const sp = start.point
  const ep = end.point
  const fallback: ElbowRoute = { points: [{ ...sp }, { ...ep }], startHeading: 'right', endHeading: 'left', bends: 0, clean: true }
  if (!start.box && !end.box && samePoint(sp, ep)) return fallback

  const sBox: Bounds = start.box ?? [sp.x, sp.y, sp.x, sp.y]
  const eBox: Bounds = end.box ?? [ep.x, ep.y, ep.x, ep.y]
  const padX = padFor(Math.max(eBox[0] - sBox[2], sBox[0] - eBox[2]))
  const padY = padFor(Math.max(eBox[1] - sBox[3], sBox[1] - eBox[3]))
  const solids = [start.box, end.box, ...(sides.obstacles ?? [])].filter((b): b is Bounds => b !== null)
  const u: Bounds = [
    Math.min(sBox[0], eBox[0]) - padX,
    Math.min(sBox[1], eBox[1]) - padY,
    Math.max(sBox[2], eBox[2]) + padX,
    Math.max(sBox[3], eBox[3]) + padY,
  ]

  let best: Candidate | null = null
  const sideIdx = (box: Bounds | null, pinned?: Heading) => (!box ? [0] : pinned ? [HEADINGS.indexOf(pinned)] : [0, 1, 2, 3])
  const sIdx = sideIdx(start.box, sides.start)
  const eIdx = sideIdx(end.box, sides.end)
  for (const si of sIdx) {
    const s = stubFor(start.box, sp, HEADINGS[si], padX, padY)
    for (const ei of eIdx) {
      const e = stubFor(end.box, ep, HEADINGS[ei], padX, padY)
      const ts = s.tip
      const te = e.tip
      const mx = (ts.x + te.x) / 2
      const my = (ts.y + te.y) / 2
      const mids: Vec[][] = [
        [{ x: ts.x, y: te.y }],
        [{ x: te.x, y: ts.y }],
        [{ x: mx, y: ts.y }, { x: mx, y: te.y }],
        [{ x: ts.x, y: my }, { x: te.x, y: my }],
        [{ x: u[0], y: ts.y }, { x: u[0], y: te.y }],
        [{ x: u[2], y: ts.y }, { x: u[2], y: te.y }],
        [{ x: ts.x, y: u[1] }, { x: te.x, y: u[1] }],
        [{ x: ts.x, y: u[3] }, { x: te.x, y: u[3] }],
      ]
      for (const mid of mids) {
        let r = scorePath([s.anchor, ts, ...mid, te, e.anchor], solids)
        if (r.points.length < 2) continue
        if (sides.forbidStart && headingOf(r.points[0], r.points[1]) === sides.forbidStart) {
          r = { ...r, score: r.score + CROSS_PENALTY, flawed: true }
        }
        const c: Candidate = { ...r, si, ei }
        if (isBetter(c, best)) best = c
      }
    }
  }

  if (!best) return { ...fallback, clean: false }
  const points = best.points
  return {
    points,
    startHeading: headingOf(points[0], points[1]),
    endHeading: OPPOSITE[headingOf(points[points.length - 2], points[points.length - 1])],
    bends: points.length - 2,
    clean: !best.flawed && points.length - 2 <= 2,
  }
}

/**
 * Routes through ordered waypoints: one `routeElbow` leg per pair, each waypoint a free end, joined
 * into one polyline. A leg never leaves a waypoint back along the previous leg, and the legs avoid
 * the box of the bound shape they do not touch. With no waypoints this is `routeElbow`.
 */
export function routeElbowVia(start: ElbowEnd, waypoints: readonly Vec[], end: ElbowEnd, sides: ElbowOptions = {}): ElbowRoute {
  if (waypoints.length === 0) return routeElbow(start, end, sides)
  const nodes: ElbowEnd[] = [start, ...waypoints.map((point) => ({ point, box: null })), end]
  let raw: Vec[] = []
  let forbid: Heading | undefined
  let clean = true
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]
    const b = nodes[i + 1]
    // only the first and last legs avoid the shape they do not touch; a leg between two waypoints is what the user built
    const obstacles = [i === nodes.length - 2 ? start.box : null, i === 0 ? end.box : null].filter((x): x is Bounds => x !== null)
    const leg = routeElbow(a, b, {
      start: i === 0 ? sides.start : undefined,
      end: i === nodes.length - 2 ? sides.end : undefined,
      forbidStart: forbid,
      obstacles,
    })
    clean = clean && leg.clean
    raw = raw.length === 0 ? leg.points : [...raw, ...leg.points.slice(1)]
    const n = leg.points.length
    if (n >= 2 && !samePoint(leg.points[n - 2], leg.points[n - 1])) forbid = OPPOSITE[headingOf(leg.points[n - 2], leg.points[n - 1])]
  }
  const points = simplify(raw)
  if (points.length < 2) return { points: [{ ...start.point }, { ...end.point }], startHeading: 'right', endHeading: 'left', bends: 0, clean: false }
  return {
    points,
    startHeading: headingOf(points[0], points[1]),
    endHeading: OPPOSITE[headingOf(points[points.length - 2], points[points.length - 1])],
    bends: points.length - 2,
    clean,
  }
}
