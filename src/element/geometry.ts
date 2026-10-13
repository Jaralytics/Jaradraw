import type { Box, LinearElement, Point, SceneElement } from './types'
import { isFreedraw, isLinear } from './types'
import { updateElement } from './factory'
import { flattenElementPath, isCurved } from './path'

export interface Vec {
  x: number
  y: number
}

export function rotatePoint(px: number, py: number, cx: number, cy: number, angle: number): Vec {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = px - cx
  const dy = py - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

export function getPointsBounds(points: readonly Point[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

/** Unrotated bounding box of an element in scene space. */
const boxCache = new WeakMap<object, Box>()

export function getElementBox(el: SceneElement): Box {
  if (isLinear(el) || (isFreedraw(el) && el.points.length > 0)) {
    const cached = boxCache.get(el)
    if (cached) return cached
    const b =
      isLinear(el) && isCurved(el)
        ? getPointsBounds(flattenElementPath(el).map((p) => [p.x, p.y] as Point))
        : getPointsBounds((el as { points: readonly Point[] }).points)
    const box = { x: el.x + b.minX, y: el.y + b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY }
    boxCache.set(el, box)
    return box
  }
  return { x: el.x, y: el.y, width: el.width, height: el.height }
}

export function getBoxCenter(box: Box): Vec {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export function getElementCenter(el: SceneElement): Vec {
  return getBoxCenter(getElementBox(el))
}

/** Four corners of the rotated box: nw, ne, se, sw. */
export function getElementCorners(el: SceneElement): Vec[] {
  const b = getElementBox(el)
  const c = getBoxCenter(b)
  return [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x + b.width, b.y + b.height],
    [b.x, b.y + b.height],
  ].map(([x, y]) => rotatePoint(x, y, c.x, c.y, el.angle))
}

/** Axis-aligned bounds in scene space, honoring rotation. */
export function getElementBounds(el: SceneElement): [number, number, number, number] {
  const corners = getElementCorners(el)
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export function getCommonBounds(
  elements: readonly SceneElement[],
): [number, number, number, number] | null {
  if (elements.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const el of elements) {
    const [x1, y1, x2, y2] = getElementBounds(el)
    minX = Math.min(minX, x1)
    minY = Math.min(minY, y1)
    maxX = Math.max(maxX, x2)
    maxY = Math.max(maxY, y2)
  }
  return [minX, minY, maxX, maxY]
}

export function getAbsolutePoints(el: LinearElement): Point[] {
  return el.points.map(([px, py]) => [el.x + px, el.y + py] as Point)
}

/**
 * Rebuilds a linear element from absolute points: first point becomes the origin,
 * points become relative, width/height equal the points' bounding box.
 */
export function withAbsolutePoints(el: LinearElement, abs: readonly Point[]): LinearElement {
  const origin = abs[0]
  const points = abs.map(([x, y]) => [x - origin[0], y - origin[1]] as Point)
  const b = getPointsBounds(points)
  return updateElement(el, {
    x: origin[0],
    y: origin[1],
    points,
    width: b.maxX - b.minX,
    height: b.maxY - b.minY,
  })
}

/**
 * Lines and arrows do not keep a rotation: a non-zero angle (from a loaded file) is applied to
 * their points the first time they are modified, leaving angle at 0.
 */
export function bakeAngle<T extends SceneElement>(el: T): T {
  if (!isLinear(el) || el.angle === 0) return el
  const c = getBoxCenter(getElementBox(el))
  const abs = getAbsolutePoints(el).map(([x, y]) => {
    const r = rotatePoint(x, y, c.x, c.y, el.angle)
    return [r.x, r.y] as Point
  })
  return updateElement(withAbsolutePoints(el, abs), { angle: 0 }) as unknown as T
}
