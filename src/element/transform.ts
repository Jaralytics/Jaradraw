import type { Point, SceneElement } from './types'
import { isBoundText, isFreedraw, isImage, isLinear } from './types'
import { updateElement } from './factory'
import { carryWaypoints } from './elbowWaypoints'
import type { Vec } from './geometry'
import {
  bakeAngle,
  getAbsolutePoints,
  getBoxCenter,
  getCommonBounds,
  getElementBox,
  rotatePoint,
  withAbsolutePoints,
} from './geometry'

export const ROTATION_SNAP = (15 * Math.PI) / 180

export function normalizeAngle(a: number): number {
  const t = Math.PI * 2
  const n = ((a % t) + t) % t
  // -0 and values within float noise of a full turn collapse to 0
  return n < 1e-12 || t - n < 1e-12 ? 0 : n
}

/**
 * Rotation applied by dragging the handle: the angle between the start and current pointer around
 * `center`. With `snap`, the resulting absolute angle (base + delta) lands on 15 degree steps.
 */
export function rotationDelta(center: Vec, start: Vec, current: Vec, baseAngle = 0, snap = false): number {
  let delta =
    Math.atan2(current.y - center.y, current.x - center.x) - Math.atan2(start.y - center.y, start.x - center.x)
  if (snap) delta = Math.round((baseAngle + delta) / ROTATION_SNAP) * ROTATION_SNAP - baseAngle
  return delta
}

/** Center of the rotation-aware common bounds of the elements (labels do not count). */
export function selectionCenter(elements: readonly SceneElement[]): Vec | null {
  const b = getCommonBounds(elements.filter((e) => !isBoundText(e)))
  return b ? { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 } : null
}

/**
 * Rotates elements by `delta` around `center`. Positions orbit the center; boxes, text and freedraw
 * accumulate the angle; lines and arrows bake the rotation into their points. Labels are skipped:
 * reconcile re-lays them out with their container.
 */
export function rotateElements(elements: readonly SceneElement[], center: Vec, delta: number): SceneElement[] {
  return elements
    .filter((e) => !isBoundText(e))
    .map((original) => {
      const el = bakeAngle(original)
      if (isLinear(el)) {
        const abs = getAbsolutePoints(el).map((p) => {
          const r = rotatePoint(p[0], p[1], center.x, center.y, delta)
          return [r.x, r.y] as Point
        })
        return carryWaypoints(el, withAbsolutePoints(el, abs), (w) => rotatePoint(w.x, w.y, center.x, center.y, delta))
      }
      const c = getBoxCenter(getElementBox(el))
      const n = rotatePoint(c.x, c.y, center.x, center.y, delta)
      return updateElement(el, { x: el.x + n.x - c.x, y: el.y + n.y - c.y, angle: normalizeAngle(el.angle + delta) })
    })
}

export type FlipAxis = 'horizontal' | 'vertical'

/** Mirrors elements around the center of their common bounds. Text keeps its glyphs unmirrored. */
export function flipElements(elements: readonly SceneElement[], axis: FlipAxis): SceneElement[] {
  const targets = elements.filter((e) => !isBoundText(e))
  const center = selectionCenter(targets)
  if (!center) return []
  const horizontal = axis === 'horizontal'
  const mirror = (x: number, y: number): Vec =>
    horizontal ? { x: 2 * center.x - x, y } : { x, y: 2 * center.y - y }

  return targets.map((original) => {
    const el = bakeAngle(original)
    if (isLinear(el)) {
      const abs = getAbsolutePoints(el).map((p) => {
        const m = mirror(p[0], p[1])
        return [m.x, m.y] as Point
      })
      return carryWaypoints(el, withAbsolutePoints(el, abs), (w) => mirror(w.x, w.y))
    }
    if (isFreedraw(el)) {
      const o = mirror(el.x, el.y)
      return updateElement(el, {
        x: o.x,
        y: o.y,
        points: el.points.map(([px, py]) => (horizontal ? [0 - px, py] : [px, 0 - py]) as Point),
        angle: normalizeAngle(-el.angle),
      })
    }
    const c = getBoxCenter(getElementBox(el))
    const m = mirror(c.x, c.y)
    const patch: Record<string, unknown> = { x: el.x + m.x - c.x, y: el.y + m.y - c.y, angle: normalizeAngle(-el.angle) }
    if (isImage(el)) patch.scale = horizontal ? [-el.scale[0], el.scale[1]] : [el.scale[0], -el.scale[1]]
    return updateElement(el, patch as Partial<typeof el>)
  })
}
