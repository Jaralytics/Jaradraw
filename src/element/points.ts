import type { LinearElement, Point } from './types'
import { bakeAngle, getAbsolutePoints, withAbsolutePoints } from './geometry'
import { closestPathPoint, isCurved } from './path'

/**
 * Inserts a node at the closest position of the drawn path to the scene point (x, y).
 * `index` is the new node's position in the result; null when the element has no path.
 */
export function insertNodeAt(el: LinearElement, x: number, y: number): { element: LinearElement; index: number } | null {
  const base = bakeAngle(el)
  const hit = closestPathPoint(base.points, isCurved(base), x - base.x, y - base.y)
  if (!hit) return null
  const abs = getAbsolutePoints(base)
  abs.splice(hit.segment + 1, 0, [base.x + hit.point.x, base.y + hit.point.y] as Point)
  return { element: withAbsolutePoints(base, abs), index: hit.segment + 1 }
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
