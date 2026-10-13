import type { Box, FreedrawElement, LinearElement, Point, SceneElement, TextElement } from './types'
import { isFreedraw, isImage, isText } from './types'
import { updateElement } from './factory'
import {
  bakeAngle,
  getAbsolutePoints,
  getPointsBounds,
  getBoxCenter,
  getElementBox,
  rotatePoint,
  withAbsolutePoints,
} from './geometry'

export type Dir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const MIN_SIZE = 1
const NEAR_ZERO = 1e-2

/**
 * Pure box resize. The side(s) opposite to the dragged handle stay fixed; the result is
 * always normalized to positive width/height (dragging through zero flips the box).
 * With keepAspect (corner handles only) the box is scaled uniformly from the opposite corner.
 */
export function resizeBox(
  box: Box,
  dir: Dir,
  px: number,
  py: number,
  keepAspect = false,
): { box: Box; scale: number } {
  const left = dir.includes('w')
  const right = dir.includes('e')
  const top = dir.includes('n')
  const bottom = dir.includes('s')

  if (keepAspect && (left || right) && (top || bottom)) {
    const ax = left ? box.x + box.width : box.x
    const ay = top ? box.y + box.height : box.y
    // a degenerate axis (zero width or height) cannot drive the scale
    const sx = box.width > 1e-6 ? Math.abs(px - ax) / box.width : 0
    const sy = box.height > 1e-6 ? Math.abs(py - ay) / box.height : 0
    const scale = Math.max(sx, sy, MIN_SIZE / Math.max(box.width, box.height, MIN_SIZE))
    const width = box.width * scale
    const height = box.height * scale
    return {
      box: {
        x: px >= ax ? ax : ax - width,
        y: py >= ay ? ay : ay - height,
        width,
        height,
      },
      scale,
    }
  }

  let x1 = box.x
  let x2 = box.x + box.width
  let y1 = box.y
  let y2 = box.y + box.height
  if (left) x1 = px
  if (right) x2 = px
  if (top) y1 = py
  if (bottom) y2 = py

  const width = Math.max(Math.abs(x2 - x1), MIN_SIZE)
  const height = Math.max(Math.abs(y2 - y1), MIN_SIZE)
  const nx = x2 >= x1 ? x1 : x1 - width
  const ny = y2 >= y1 ? y1 : y1 - height
  return {
    box: { x: nx, y: ny, width, height },
    scale: box.width > 0 ? width / box.width : 1,
  }
}

/** Resize that keeps the aspect ratio from any handle; edge handles scale about the opposite edge's midpoint. */
export function resizeKeepingAspect(box: Box, dir: Dir, px: number, py: number): { box: Box; scale: number } {
  const corner = (dir.includes('w') || dir.includes('e')) && (dir.includes('n') || dir.includes('s'))
  if (corner) return resizeBox(box, dir, px, py, true)
  const ratio = box.width / Math.max(box.height, 1e-6)
  const r = resizeBox(box, dir, px, py, false).box
  let out: Box
  if (dir === 'e' || dir === 'w') {
    const h = r.width / ratio
    out = { x: r.x, y: box.y + box.height / 2 - h / 2, width: r.width, height: h }
  } else {
    const w = r.height * ratio
    out = { x: box.x + box.width / 2 - w / 2, y: r.y, width: w, height: r.height }
  }
  return { box: out, scale: box.width > 0 ? out.width / box.width : 1 }
}

/** Offset that keeps a rotated element's rotated geometry consistent after its center moved. */
function worldShift(original: SceneElement, newLocalCenter: { x: number; y: number }) {
  if (original.angle === 0) return { dx: 0, dy: 0 }
  const c = getBoxCenter(getElementBox(original))
  const world = rotatePoint(newLocalCenter.x, newLocalCenter.y, c.x, c.y, original.angle)
  return { dx: world.x - newLocalCenter.x, dy: world.y - newLocalCenter.y }
}

function toLocal(original: SceneElement, x: number, y: number) {
  if (original.angle === 0) return { x, y }
  const c = getBoxCenter(getElementBox(original))
  return rotatePoint(x, y, c.x, c.y, -original.angle)
}

/** Resizes a rectangle/ellipse/diamond/text from `original` (snapshot at drag start). */
export function resizeElement<T extends SceneElement>(
  original: T,
  dir: Dir,
  sceneX: number,
  sceneY: number,
  free = false,
): T {
  const p = toLocal(original, sceneX, sceneY)
  const text = isText(original)
  const { box, scale } =
    isImage(original) && !free
      ? resizeKeepingAspect(getElementBox(original), dir, p.x, p.y)
      : resizeBox(getElementBox(original), dir, p.x, p.y, text)
  const { dx, dy } = worldShift(original, getBoxCenter(box))
  if (isFreedraw(original)) {
    return updateElement(original, fitFreedraw(original, { ...box, x: box.x + dx, y: box.y + dy }) as unknown as Partial<T>)
  }
  const patch: { -readonly [K in keyof TextElement]?: TextElement[K] } = {
    x: box.x + dx,
    y: box.y + dy,
    width: box.width,
    height: box.height,
  }
  if (isText(original)) patch.fontSize = Math.max(1, original.fontSize * scale)
  return updateElement(original, patch as Partial<T>)
}

/** Scales a freedraw's points so that their bounds fill `box`; the first point stays the origin. */
export function fitFreedraw(el: FreedrawElement, box: Box) {
  const b = getPointsBounds(el.points)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const sx = w > NEAR_ZERO ? box.width / w : 1
  const sy = h > NEAR_ZERO ? box.height / h : 1
  const p0 = el.points[0] ?? [0, 0]
  return {
    x: box.x + (p0[0] - b.minX) * sx,
    y: box.y + (p0[1] - b.minY) * sy,
    width: w > NEAR_ZERO ? box.width : w,
    height: h > NEAR_ZERO ? box.height : h,
    points: el.points.map(([px, py]) => [(px - p0[0]) * sx, (py - p0[1]) * sy] as Point),
  }
}

/** Moves one point of a line/arrow to a scene position. */
export function moveLinearPoint(
  original: LinearElement,
  index: number,
  sceneX: number,
  sceneY: number,
): LinearElement {
  const p = toLocal(original, sceneX, sceneY)
  const abs: Point[] = getAbsolutePoints(original)
  abs[index] = [p.x, p.y]
  const next = withAbsolutePoints(original, abs)
  const { dx, dy } = worldShift(original, getBoxCenter(getElementBox(next)))
  return dx === 0 && dy === 0 ? next : { ...next, x: next.x + dx, y: next.y + dy }
}

export function moveElement<T extends SceneElement>(original: T, dx: number, dy: number): T {
  const el = bakeAngle(original)
  return updateElement(el, { x: el.x + dx, y: el.y + dy } as Partial<T>)
}
