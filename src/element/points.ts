import type { LinearElement, Point } from './types'
import { getAbsolutePoints, withAbsolutePoints } from './geometry'
import { isCurved, segmentMidpoint } from './path'

/** Inserts a point at the drawn midpoint of segment `segment` (between points `segment` and `segment + 1`). */
export function insertMidpoint(el: LinearElement, segment: number): LinearElement {
  if (segment < 0 || segment >= el.points.length - 1) return el
  const mid = segmentMidpoint(el.points, segment, isCurved(el))
  const abs = getAbsolutePoints(el)
  abs.splice(segment + 1, 0, [el.x + mid.x, el.y + mid.y] as Point)
  return withAbsolutePoints(el, abs)
}

/** Removes a point; returns null when the element would drop below two points. */
export function removePoint(el: LinearElement, index: number): LinearElement | null {
  if (el.points.length <= 2 || index < 0 || index >= el.points.length) return null
  const abs = getAbsolutePoints(el)
  abs.splice(index, 1)
  return withAbsolutePoints(el, abs)
}

/** Appends a point in scene coordinates. */
export function appendPoint(el: LinearElement, x: number, y: number): LinearElement {
  return withAbsolutePoints(el, [...getAbsolutePoints(el), [x, y] as Point])
}

/** Drops consecutive points closer than `eps` (e.g. the extra point a double click adds). */
export function dedupePoints(el: LinearElement, eps = 1): LinearElement {
  const abs = getAbsolutePoints(el)
  const out: Point[] = []
  for (const p of abs) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= eps) out.push(p)
  }
  return out.length === abs.length ? el : withAbsolutePoints(el, out)
}
