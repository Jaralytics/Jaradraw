import type { LinearElement, SceneElement } from './types'
import { isImage, isShape, isText } from './types'
import { getAbsolutePoints, getBoxCenter, getElementBox, rotatePoint, withAbsolutePoints } from './geometry'
import type { Vec } from './geometry'
import { hitTestElement } from './hit'

export const BIND_DISTANCE = 10
export const BIND_GAP = 4

export function isBindTarget(el: SceneElement): boolean {
  return !el.isDeleted && (isShape(el) || isImage(el) || (isText(el) && el.containerId == null))
}

/**
 * Distance from the center of the element to its outline along the unit direction (ux, uy),
 * expressed in the element's unrotated frame. Rectangles ignore their rounding.
 */
function radiusAlong(el: SceneElement, ux: number, uy: number): number {
  const hw = Math.max(el.width / 2, 1e-6)
  const hh = Math.max(el.height / 2, 1e-6)
  if (el.type === 'ellipse') return 1 / Math.sqrt((ux / hw) ** 2 + (uy / hh) ** 2)
  if (el.type === 'diamond') return 1 / (Math.abs(ux) / hw + Math.abs(uy) / hh)
  const tx = ux === 0 ? Infinity : hw / Math.abs(ux)
  const ty = uy === 0 ? Infinity : hh / Math.abs(uy)
  return Math.min(tx, ty)
}

/**
 * Point on the shape's outline (plus `gap`) on the line from `from` to the shape's center,
 * honoring the shape's angle.
 */
export function outlinePointToward(el: SceneElement, from: Vec, gap = BIND_GAP): Vec {
  const c = getBoxCenter(getElementBox(el))
  const local = el.angle === 0 ? from : rotatePoint(from.x, from.y, c.x, c.y, -el.angle)
  let dx = local.x - c.x
  let dy = local.y - c.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) {
    dx = 1
    dy = 0
  } else {
    dx /= len
    dy /= len
  }
  const r = radiusAlong(el, dx, dy) + gap
  const p = { x: c.x + dx * r, y: c.y + dy * r }
  return el.angle === 0 ? p : rotatePoint(p.x, p.y, c.x, c.y, el.angle)
}

/**
 * Preview of a non-elbow arrow with its first and last points moved onto the given shapes' outlines,
 * the same anchors the committed arrow gets. Elbow arrows are returned unchanged.
 */
export function anchorArrowPreview(
  arrow: LinearElement,
  start: SceneElement | null | undefined,
  end: SceneElement | null | undefined,
): LinearElement {
  if (arrow.elbowed === true || (!start && !end)) return arrow
  const src = getAbsolutePoints(arrow)
  const n = src.length
  if (n < 2) return arrow
  const abs = src.map((p) => [p[0], p[1]] as const)
  const at = (i: number): Vec => ({ x: src[i][0], y: src[i][1] })
  const center = (el: SceneElement): Vec => getBoxCenter(getElementBox(el))
  if (start) {
    const p = outlinePointToward(start, n === 2 && end ? center(end) : at(1))
    abs[0] = [p.x, p.y]
  }
  if (end) {
    const p = outlinePointToward(end, n === 2 && start ? center(start) : at(n - 2))
    abs[n - 1] = [p.x, p.y]
  }
  return withAbsolutePoints(arrow, abs)
}

/**
 * Whether a click while placing an arrow ends it on the shape under the pointer: only arrows, only
 * on a bind target, and never on the start shape while the arrow still has just its first point.
 */
export function clickEndsArrow(o: {
  tool: 'line' | 'arrow'
  elbowed: boolean
  target: string | null
  startTarget: string | null
  fixedCount: number
  noBind: boolean
}): boolean {
  if (o.tool !== 'arrow' || o.elbowed || o.noBind || !o.target) return false
  return !(o.fixedCount < 2 && o.target === o.startTarget)
}

/** True when the scene point lies inside the element's area (rotation aware). */
export function pointInsideElement(el: SceneElement, x: number, y: number): boolean {
  const c = getBoxCenter(getElementBox(el))
  const p = el.angle === 0 ? { x, y } : rotatePoint(x, y, c.x, c.y, -el.angle)
  const hw = el.width / 2
  const hh = el.height / 2
  const dx = Math.abs(p.x - c.x)
  const dy = Math.abs(p.y - c.y)
  if (el.type === 'ellipse') return (dx / Math.max(hw, 1e-6)) ** 2 + (dy / Math.max(hh, 1e-6)) ** 2 <= 1
  if (el.type === 'diamond') return dx / Math.max(hw, 1e-6) + dy / Math.max(hh, 1e-6) <= 1
  return dx <= hw && dy <= hh
}

/**
 * Bind candidate under the point: the topmost element whose outline is within `distance`, else the
 * smallest element containing the point. Elements that also contain `otherEnd` (the arrow's other
 * endpoint) are skipped, so an arrow drawn inside a large shape does not bind to it.
 */
export function findBindTarget(
  elements: readonly SceneElement[],
  x: number,
  y: number,
  distance = BIND_DISTANCE,
  otherEnd?: Vec | null,
): SceneElement | null {
  let smallest: SceneElement | null = null
  let smallestArea = Infinity
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]
    if (!isBindTarget(el)) continue
    if (otherEnd && pointInsideElement(el, otherEnd.x, otherEnd.y)) continue
    if (hitTestElement({ ...el, backgroundColor: 'transparent' }, x, y, distance)) return el
    if (pointInsideElement(el, x, y)) {
      const area = el.width * el.height
      if (area < smallestArea) {
        smallest = el
        smallestArea = area
      }
    }
  }
  return smallest
}
