import type { Box, SceneElement } from './types'
import { isBoundText, isLinear, isRenderable } from './types'
import { getElementBounds } from './geometry'
import type { Vec } from './geometry'
import { bindingTarget } from './relations'
import type { Dir } from './resize'

export const GRID_SIZE = 20
export const GRID_STEP = 5
/** Smart guides snapping tolerance in screen pixels. */
export const SNAP_TOLERANCE_PX = 8

export function snapValue(v: number, size: number): number {
  return Math.round(v / size) * size
}

export function snapPointToGrid(p: Vec, size: number): Vec {
  return { x: snapValue(p.x, size), y: snapValue(p.y, size) }
}

/** Offset that puts the box's top-left corner on the grid. */
export function gridMoveDelta(box: Box, size: number): Vec {
  return { x: snapValue(box.x, size) - box.x, y: snapValue(box.y, size) - box.y }
}

/** Transient UI guide; never stored in elements nor exported. */
export type SnapGuide =
  | {
      kind: 'align'
      x1: number
      y1: number
      x2: number
      y2: number
      /** Aligned reference points (edge corners or centers) of every shape involved. */
      marks: readonly Vec[]
    }
  | {
      kind: 'gap'
      axis: 'x' | 'y'
      x1: number
      y1: number
      x2: number
      y2: number
      size: number
      /** Only one gap per snap carries its size label. */
      label: boolean
    }

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
}

/** Candidate boxes plus copies sorted along each axis, built once per gesture. */
export interface SnapIndex {
  boxes: readonly Box[]
  byX: readonly Box[]
  byY: readonly Box[]
}

export function buildSnapIndex(boxes: readonly Box[]): SnapIndex {
  return {
    boxes,
    byX: [...boxes].sort((a, b) => a.x - b.x),
    byY: [...boxes].sort((a, b) => a.y - b.y),
  }
}

const asIndex = (c: SnapIndex | readonly Box[]): SnapIndex => (Array.isArray(c) ? buildSnapIndex(c) : (c as SnapIndex))

type Axis = 'x' | 'y'
const EPS = 1e-6
const GAP_EPS = 1e-3

const lo = (b: Box, a: Axis) => (a === 'x' ? b.x : b.y)
const len = (b: Box, a: Axis) => (a === 'x' ? b.width : b.height)
const hi = (b: Box, a: Axis) => lo(b, a) + len(b, a)
const other = (a: Axis): Axis => (a === 'x' ? 'y' : 'x')

/** Signed offset to the closest reference-line coincidence within `tol` (3 lines against 3 lines), or null. */
function alignDelta(m: Box, boxes: readonly Box[], axis: Axis, tol: number): number | null {
  const m0 = lo(m, axis)
  const half = len(m, axis) / 2
  let best = Infinity
  let bestD = 0
  for (const c of boxes) {
    const c0 = lo(c, axis)
    const ch = len(c, axis) / 2
    for (let j = 0; j < 3; j++) {
      const t = c0 + ch * j
      for (let i = 0; i < 3; i++) {
        const d = t - (m0 + half * i)
        const ad = Math.abs(d)
        if (ad <= tol && ad < best) {
          best = ad
          bestD = d
        }
      }
    }
  }
  return best === Infinity ? null : bestD
}

/** Candidates overlapping `m` on the perpendicular axis, in along-axis order. */
function overlapRow(m: Box, sorted: readonly Box[], axis: Axis): Box[] {
  const p = other(axis)
  const p0 = lo(m, p)
  const p1 = hi(m, p)
  const row: Box[] = []
  for (const c of sorted) if (lo(c, p) < p1 - EPS && hi(c, p) > p0 + EPS) row.push(c)
  return row
}

interface SpaceMatch {
  d: number
  /** The equal gap size. */
  g: number
}

/** Closest equal-spacing snap on one axis: between two neighbours or extending an existing gap. */
function spacingMatch(m: Box, idx: SnapIndex, axis: Axis, tol: number): SpaceMatch | null {
  const row = overlapRow(m, axis === 'x' ? idx.byX : idx.byY, axis)
  if (row.length === 0) return null
  const s = lo(m, axis)
  const size = len(m, axis)
  let found = false
  let bestD = 0
  let bestG = 0
  const consider = (d: number, g: number) => {
    if (g <= EPS || Math.abs(d) > tol) return
    if (!found || Math.abs(d) < Math.abs(bestD)) {
      found = true
      bestD = d
      bestG = g
    }
  }

  let left: Box | null = null
  let right: Box | null = null
  for (const c of row) {
    if (hi(c, axis) <= s + tol && (!left || hi(c, axis) > hi(left, axis))) left = c
    if (lo(c, axis) >= s + size - tol && (!right || lo(c, axis) < lo(right, axis))) right = c
  }
  if (left && right) {
    const free = lo(right, axis) - hi(left, axis) - size
    if (free > 0) consider(hi(left, axis) + free / 2 - s, free / 2)
  }

  const blocked = (t: number) => row.some((c) => lo(c, axis) < t + size - EPS && hi(c, axis) > t + EPS)
  for (let i = 0; i + 1 < row.length; i++) {
    const g = lo(row[i + 1], axis) - hi(row[i], axis)
    if (g <= EPS) continue
    const after = hi(row[i + 1], axis) + g
    if (Math.abs(after - s) <= tol && !blocked(after)) consider(after - s, g)
    const before = lo(row[i], axis) - g - size
    if (Math.abs(before - s) <= tol && !blocked(before)) consider(before - s, g)
  }
  return found ? { d: bestD, g: bestG } : null
}

function gapGuide(a: Box, b: Box, axis: Axis, label: boolean): SnapGuide {
  const p = other(axis)
  const pos = (Math.max(lo(a, p), lo(b, p)) + Math.min(hi(a, p), hi(b, p))) / 2
  const from = hi(a, axis)
  const to = lo(b, axis)
  return axis === 'x'
    ? { kind: 'gap', axis, x1: from, y1: pos, x2: to, y2: pos, size: to - from, label }
    : { kind: 'gap', axis, x1: pos, y1: from, x2: pos, y2: to, size: to - from, label }
}

/** Gap indicators for every equal gap of size `g` at the snapped position of `m`, existing rhythm included. */
function spacingGuides(m: Box, idx: SnapIndex, axis: Axis, g: number): SnapGuide[] {
  const row = overlapRow(m, axis === 'x' ? idx.byX : idx.byY, axis)
  const pairs: [Box, Box][] = []
  for (let i = 0; i + 1 < row.length; i++) {
    if (Math.abs(lo(row[i + 1], axis) - hi(row[i], axis) - g) < GAP_EPS) pairs.push([row[i], row[i + 1]])
  }
  const mine: [Box, Box][] = []
  for (const c of row) {
    if (Math.abs(lo(m, axis) - hi(c, axis) - g) < GAP_EPS) mine.push([c, m])
    if (Math.abs(lo(c, axis) - hi(m, axis) - g) < GAP_EPS) mine.push([m, c])
  }
  return [...mine, ...pairs].map(([a, b], i) => gapGuide(a, b, axis, i === 0))
}

const ALL: readonly number[] = [0, 1, 2]
const EDGES: readonly number[] = [0, 2]

/**
 * Alignment guides for the given reference lines of `box` (0 start, 1 center, 2 end) wherever they coincide
 * exactly with a line of another box. Each line spans from the farthest involved shape to the box.
 */
export function alignGuides(
  box: Box,
  boxes: readonly Box[],
  lines: { x: readonly number[]; y: readonly number[] },
): SnapGuide[] {
  const guides: SnapGuide[] = []
  for (const axis of ['x', 'y'] as const) {
    const p = other(axis)
    const seen: number[] = []
    for (const i of lines[axis]) {
      const v = lo(box, axis) + (len(box, axis) / 2) * i
      if (seen.some((s) => Math.abs(s - v) < EPS)) continue
      seen.push(v)
      let a = lo(box, p)
      let b = hi(box, p)
      const marks: Vec[] = []
      const mark = (at: number, t: number) => marks.push(axis === 'x' ? { x: at, y: t } : { x: t, y: at })
      let hits = 0
      for (const c of boxes) {
        let j = -1
        for (let k = 0; k < 3; k++) {
          if (Math.abs(lo(c, axis) + (len(c, axis) / 2) * k - v) < EPS) {
            j = k
            break
          }
        }
        if (j < 0) continue
        hits++
        a = Math.min(a, lo(c, p))
        b = Math.max(b, hi(c, p))
        if (j === 1) mark(v, lo(c, p) + len(c, p) / 2)
        else {
          mark(v, lo(c, p))
          mark(v, hi(c, p))
        }
      }
      if (hits === 0) continue
      if (i === 1) mark(v, lo(box, p) + len(box, p) / 2)
      else {
        mark(v, lo(box, p))
        mark(v, hi(box, p))
      }
      guides.push(
        axis === 'x'
          ? { kind: 'align', x1: v, y1: a, x2: v, y2: b, marks }
          : { kind: 'align', x1: a, y1: v, x2: b, y2: v, marks },
      )
    }
  }
  return guides
}

/**
 * Snaps a moving box on each axis independently: alignment (start, center, end lines against the lines of
 * other boxes, adjacency included) and equal spacing; the closer wins and alignment wins ties.
 */
export function snapBoxToObjects(moving: Box, candidates: SnapIndex | readonly Box[], tol: number): SnapResult {
  const idx = asIndex(candidates)
  const pick = (al: number | null, sp: SpaceMatch | null): number | null => {
    if (al === null) return sp ? sp.d : null
    return sp && Math.abs(sp.d) < Math.abs(al) ? sp.d : al
  }
  const alX = alignDelta(moving, idx.boxes, 'x', tol)
  const alY = alignDelta(moving, idx.boxes, 'y', tol)
  const spX = spacingMatch(moving, idx, 'x', tol)
  const spY = spacingMatch(moving, idx, 'y', tol)
  const dx = pick(alX, spX)
  const dy = pick(alY, spY)
  if (dx === null && dy === null) return { dx: 0, dy: 0, guides: [] }
  const box: Box = { ...moving, x: moving.x + (dx ?? 0), y: moving.y + (dy ?? 0) }
  const guides = alignGuides(box, idx.boxes, { x: dx === null ? [] : ALL, y: dy === null ? [] : ALL })
  if (spX && dx !== null && Math.abs(spX.d - dx) < EPS) guides.push(...spacingGuides(box, idx, 'x', spX.g))
  if (spY && dy !== null && Math.abs(spY.d - dy) < EPS) guides.push(...spacingGuides(box, idx, 'y', spY.g))
  return { dx: dx ?? 0, dy: dy ?? 0, guides }
}

/** Snaps a single point to the x and y reference lines of other boxes; returns which axes snapped. */
export function snapPointToObjects(
  p: Vec,
  candidates: SnapIndex | readonly Box[],
  tol: number,
): { point: Vec; snapX: boolean; snapY: boolean } {
  const idx = asIndex(candidates)
  const probe: Box = { x: p.x, y: p.y, width: 0, height: 0 }
  const dx = alignDelta(probe, idx.boxes, 'x', tol)
  const dy = alignDelta(probe, idx.boxes, 'y', tol)
  return { point: { x: p.x + (dx ?? 0), y: p.y + (dy ?? 0) }, snapX: dx !== null, snapY: dy !== null }
}

/** Guides for a box whose edges (or a lone point) sit on other shapes' lines. */
export function edgeGuides(box: Box, candidates: SnapIndex | readonly Box[]): SnapGuide[] {
  return alignGuides(box, asIndex(candidates).boxes, { x: EDGES, y: EDGES })
}

/**
 * Snaps the dragged edge(s) of a resize by adjusting the pointer. With `lockBox` (aspect ratio kept) only the
 * dominant axis of a corner drag snaps, and only if it stays dominant.
 */
export function snapResizePointer(
  p: Vec,
  dir: Dir,
  candidates: SnapIndex | readonly Box[],
  tol: number,
  lockBox: Box | null = null,
): Vec {
  const idx = asIndex(candidates)
  const east = dir.includes('e')
  const west = dir.includes('w')
  const north = dir.includes('n')
  const south = dir.includes('s')
  let doX = east || west
  let doY = north || south
  const corner = doX && doY
  const probe: Box = { x: p.x, y: p.y, width: 0, height: 0 }
  const dx = doX ? alignDelta(probe, idx.boxes, 'x', tol) : null
  const dy = doY ? alignDelta(probe, idx.boxes, 'y', tol) : null
  if (corner && lockBox && lockBox.width > 1e-6 && lockBox.height > 1e-6) {
    const ax = west ? lockBox.x + lockBox.width : lockBox.x
    const ay = north ? lockBox.y + lockBox.height : lockBox.y
    const sx = Math.abs(p.x - ax) / lockBox.width
    const sy = Math.abs(p.y - ay) / lockBox.height
    doX = sx >= sy
    doY = !doX
    if (doX && dx !== null && Math.abs(p.x + dx - ax) / lockBox.width < sy) return p
    if (doY && dy !== null && Math.abs(p.y + dy - ay) / lockBox.height < sx) return p
  }
  return { x: p.x + (doX ? (dx ?? 0) : 0), y: p.y + (doY ? (dy ?? 0) : 0) }
}

/** Guides for the dragged edges of a resized box. */
export function resizeGuides(box: Box, dir: Dir, candidates: SnapIndex | readonly Box[]): SnapGuide[] {
  const x = dir.includes('e') ? [2] : dir.includes('w') ? [0] : []
  const y = dir.includes('s') ? [2] : dir.includes('n') ? [0] : []
  return alignGuides(box, asIndex(candidates).boxes, { x, y })
}

/**
 * Reference boxes that a gesture can snap to: live, visible elements inside `view` (scene rectangle),
 * without the moving elements, labels, or arrows bound to a moving element.
 */
export function snapCandidateBoxes(
  elements: readonly SceneElement[],
  exclude: ReadonlySet<string>,
  view: { x1: number; y1: number; x2: number; y2: number },
): Box[] {
  const out: Box[] = []
  for (const el of elements) {
    if (el.isDeleted || !isRenderable(el) || isBoundText(el) || exclude.has(el.id)) continue
    if (isLinear(el)) {
      const s0 = bindingTarget(el.startBinding)
      const e0 = bindingTarget(el.endBinding)
      if ((s0 && exclude.has(s0)) || (e0 && exclude.has(e0))) continue
    }
    const [x1, y1, x2, y2] = getElementBounds(el)
    if (x2 < view.x1 || x1 > view.x2 || y2 < view.y1 || y1 > view.y2) continue
    out.push({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 })
  }
  return out
}
