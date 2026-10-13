import { getStroke } from 'perfect-freehand'
import type { FreedrawElement, Point } from './types'
import { baseDefaults, updateElement } from './factory'
import { getPointsBounds } from './geometry'
import { nanoid } from 'nanoid'

export const FREEDRAW_SIZE_FACTOR = 4.25

export function createFreedraw(
  x: number,
  y: number,
  style: Partial<ReturnType<typeof baseDefaults>> = {},
  pen: { pressure: number } | null = null,
): FreedrawElement {
  return {
    ...baseDefaults(),
    ...style,
    id: nanoid(),
    type: 'freedraw',
    x,
    y,
    points: [[0, 0]],
    pressures: pen ? [pen.pressure] : [],
    simulatePressure: !pen,
    lastCommittedPoint: null,
  }
}

/** Appends a scene-space point to a stroke, keeping width/height equal to the points' bounds. */
export function appendFreedrawPoint(el: FreedrawElement, sx: number, sy: number, pressure?: number): FreedrawElement {
  const rel: Point = [sx - el.x, sy - el.y]
  const last = el.points[el.points.length - 1]
  if (last && last[0] === rel[0] && last[1] === rel[1]) return el
  const points = [...el.points, rel]
  const b = getPointsBounds(points)
  return updateElement(el, {
    points,
    pressures: el.simulatePressure ? el.pressures : [...el.pressures, pressure ?? 0.5],
    width: b.maxX - b.minX,
    height: b.maxY - b.minY,
  })
}

/**
 * Appends several scene-space points with one copy of the arrays. Points closer than `minDist`
 * to the previous one are skipped.
 */
export function appendFreedrawPoints(
  el: FreedrawElement,
  pts: readonly { x: number; y: number; pressure?: number }[],
  minDist = 0,
): FreedrawElement {
  const points = el.points.slice() as Point[]
  const pressures = el.pressures.slice()
  let added = false
  for (const q of pts) {
    const rel: Point = [q.x - el.x, q.y - el.y]
    const last = points[points.length - 1]
    if (last && Math.hypot(rel[0] - last[0], rel[1] - last[1]) <= Math.max(minDist, 1e-9)) continue
    points.push(rel)
    if (!el.simulatePressure) pressures.push(q.pressure ?? 0.5)
    added = true
  }
  if (!added) return el
  const b = getPointsBounds(points)
  return updateElement(el, { points, pressures, width: b.maxX - b.minX, height: b.maxY - b.minY })
}

/** A click without movement produces a dot, as in Excalidraw. */
export function finishFreedraw(el: FreedrawElement): FreedrawElement {
  if (el.points.length > 1) return el
  return updateElement(el, {
    points: [
      [0, 0],
      [0.0001, 0.0001],
    ],
    pressures: el.simulatePressure ? el.pressures : [...el.pressures, el.pressures[0] ?? 0.5],
    width: 0.0001,
    height: 0.0001,
  })
}

/** Outline polygon of the stroke in element-local coordinates. */
export function freedrawOutline(el: FreedrawElement): number[][] {
  const input =
    el.simulatePressure || el.pressures.length !== el.points.length
      ? el.points.map((p) => [p[0], p[1]])
      : el.points.map((p, i) => [p[0], p[1], el.pressures[i]])
  return getStroke(input.length ? input : [[0, 0, 0.5]], {
    simulatePressure: el.simulatePressure || el.pressures.length !== el.points.length,
    size: el.strokeWidth * FREEDRAW_SIZE_FACTOR,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    last: true,
  })
}

/** SVG path data of a closed outline, smoothed with quadratic midpoints. */
export function outlineToPath(points: readonly (readonly number[])[]): string {
  const n = points.length
  if (n < 3) return ''
  const mid = (a: readonly number[], b: readonly number[]) => `${(a[0] + b[0]) / 2},${(a[1] + b[1]) / 2}`
  let d = `M${points[0][0]},${points[0][1]} Q${points[1][0]},${points[1][1]} ${mid(points[1], points[2])} T`
  for (let i = 2; i < n - 1; i++) d += `${mid(points[i], points[i + 1])} `
  return d + 'Z'
}
