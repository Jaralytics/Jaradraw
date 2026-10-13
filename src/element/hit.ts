import { FRAME_NAME_HEIGHT, frameNameWidth } from './frame'
import type { FrameElement } from './types'
import type { SceneElement, ShapeElement } from './types'
import { isFreedraw, isLinear, isShape, isText } from './types'
import { getBoxCenter, getElementBox, rotatePoint } from './geometry'
import { flattenElementPath } from './path'

type Poly = readonly (readonly [number, number])[]

export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function pointInPolygon(px: number, py: number, poly: Poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function polygonOutlineDistance(px: number, py: number, poly: Poly) {
  let d = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    d = Math.min(d, distanceToSegment(px, py, a[0], a[1], b[0], b[1]))
  }
  return d
}

export function isFilled(el: { backgroundColor: string }): boolean {
  return el.backgroundColor !== 'transparent' && el.backgroundColor !== ''
}

function hitShape(el: ShapeElement, lx: number, ly: number, tol: number): boolean {
  const box = getElementBox(el)
  const c = getBoxCenter(box)
  const hw = box.width / 2
  const hh = box.height / 2
  const filled = isFilled(el)

  if (el.type === 'rectangle') {
    const ox = Math.max(Math.abs(lx - c.x) - hw, 0)
    const oy = Math.max(Math.abs(ly - c.y) - hh, 0)
    const outside = ox > 0 || oy > 0
    const dist = outside
      ? Math.hypot(ox, oy)
      : Math.min(hw - Math.abs(lx - c.x), hh - Math.abs(ly - c.y))
    if (filled && !outside) return true
    return dist <= tol
  }

  if (el.type === 'diamond') {
    const poly: Poly = [
      [c.x, box.y],
      [box.x + box.width, c.y],
      [c.x, box.y + box.height],
      [box.x, c.y],
    ]
    if (filled && pointInPolygon(lx, ly, poly)) return true
    return polygonOutlineDistance(lx, ly, poly) <= tol
  }

  // ellipse: first-order distance estimate to the outline
  const a = Math.max(hw, 1e-4)
  const b = Math.max(hh, 1e-4)
  const x = lx - c.x
  const y = ly - c.y
  const f = Math.sqrt((x / a) ** 2 + (y / b) ** 2)
  if (filled && f <= 1) return true
  let dist: number
  if (f < 1e-9) {
    dist = Math.min(a, b)
  } else {
    const gx = x / (a * a) / f
    const gy = y / (b * b) / f
    dist = Math.abs(f - 1) / Math.hypot(gx, gy)
  }
  return dist <= tol
}

/** Frames are selected by their border or name, never by their interior. */
function hitFrame(el: FrameElement, x: number, y: number, tol: number): boolean {
  const t = tol + el.strokeWidth / 2 + 2
  const inOuter = x >= el.x - t && x <= el.x + el.width + t && y >= el.y - t && y <= el.y + el.height + t
  const inInner = x > el.x + t && x < el.x + el.width - t && y > el.y + t && y < el.y + el.height - t
  if (inOuter && !inInner) return true
  return x >= el.x && x <= el.x + frameNameWidth(el) && y >= el.y - FRAME_NAME_HEIGHT && y <= el.y
}

/** Hit test in scene space. `tol` is in scene units (callers divide pixels by zoom). */
export function hitTestElement(el: SceneElement, x: number, y: number, tol: number): boolean {
  if (el.isDeleted) return false
  const box = getElementBox(el)
  const c = getBoxCenter(box)
  const local = el.angle === 0 ? { x, y } : rotatePoint(x, y, c.x, c.y, -el.angle)
  const t = tol + el.strokeWidth / 2
  const m = tol + el.strokeWidth * 2
  if (local.x < box.x - m || local.x > box.x + box.width + m || local.y < box.y - m - (el.type === 'frame' ? FRAME_NAME_HEIGHT : 0) || local.y > box.y + box.height + m) {
    return false
  }

  if (el.type === 'image') {
    return local.x >= box.x - tol && local.x <= box.x + box.width + tol && local.y >= box.y - tol && local.y <= box.y + box.height + tol
  }
  if (el.type === 'frame') return hitFrame(el as FrameElement, local.x, local.y, tol)

  if (isShape(el)) return hitShape(el, local.x, local.y, t)

  if (isLinear(el)) {
    const pts = flattenElementPath(el)
    for (let i = 0; i < pts.length - 1; i++) {
      if (
        distanceToSegment(local.x, local.y, el.x + pts[i].x, el.y + pts[i].y, el.x + pts[i + 1].x, el.y + pts[i + 1].y) <= t
      )
        return true
    }
    return false
  }

  if (isFreedraw(el)) {
    // the stroke is drawn about strokeWidth * 4.25 wide at full pressure
    const reach = tol + el.strokeWidth * 1.5
    const pts = el.points
    if (pts.length === 1) return Math.hypot(local.x - el.x - pts[0][0], local.y - el.y - pts[0][1]) <= reach
    for (let i = 0; i < pts.length - 1; i++) {
      if (
        distanceToSegment(local.x, local.y, el.x + pts[i][0], el.y + pts[i][1], el.x + pts[i + 1][0], el.y + pts[i + 1][1]) <=
        reach
      )
        return true
    }
    return false
  }

  if (isText(el)) {
    const b = getElementBox(el)
    return (
      local.x >= b.x - tol &&
      local.x <= b.x + b.width + tol &&
      local.y >= b.y - tol &&
      local.y <= b.y + b.height + tol
    )
  }

  return false
}

/** Topmost renderable element under the point, or null. A label hit resolves to its container. */
export function hitTestScene(
  elements: readonly SceneElement[],
  x: number,
  y: number,
  tol: number,
  skipId?: string | null,
): SceneElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]
    if (el.id === skipId) continue
    if (hitTestElement(el, x, y, tol)) {
      if (isText(el) && el.containerId != null) {
        const container = elements.find((c) => c.id === el.containerId && !c.isDeleted)
        if (container) return container
        continue
      }
      return el
    }
  }
  return null
}
