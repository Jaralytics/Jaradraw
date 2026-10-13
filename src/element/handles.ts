import type { Box, SceneElement } from './types'
import { isLinear, isText } from './types'
import type { Dir } from './resize'
import { getAbsolutePoints, getBoxCenter, getElementBox, rotatePoint } from './geometry'
import { isCurved, segmentMidpoint } from './path'
import type { Vec } from './geometry'

/** `mid` is the insertion handle of segment `index` (between points index and index + 1). */
export type HandleHit = { kind: 'box'; dir: Dir } | { kind: 'rotate' } | { kind: 'point'; index: number } | { kind: 'mid'; index: number }

export const HANDLE_RADIUS_PX = 8
export const ROTATE_OFFSET_PX = 24

/** Position of the rotation handle: above the top-center of the box, following its angle. */
export function rotationHandlePosition(box: Box, angle: number, zoom: number): Vec {
  const c = getBoxCenter(box)
  return rotatePoint(c.x, box.y - ROTATE_OFFSET_PX / zoom, c.x, c.y, angle)
}

export function hitRotationHandle(box: Box, angle: number, x: number, y: number, zoom: number): boolean {
  const h = rotationHandlePosition(box, angle, zoom)
  const r = HANDLE_RADIUS_PX / zoom
  return Math.hypot(h.x - x, h.y - y) <= r
}

const ALL_DIRS: Dir[] = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w']
const CORNER_DIRS: Dir[] = ['nw', 'ne', 'se', 'sw']

export function getHandlePositions(
  el: SceneElement,
  pointEdit = false,
  zoom = 1,
): { handle: HandleHit; x: number; y: number }[] {
  const b = getElementBox(el)
  const c = getBoxCenter(b)
  const rotate = pointEdit
    ? []
    : [{ handle: { kind: 'rotate' } as HandleHit, ...rotationHandlePosition(b, el.angle, zoom) }]
  if (isLinear(el)) {
    const pts = getAbsolutePoints(el)
    const idx = pointEdit ? pts.map((_, i) => i) : pts.length > 1 ? [0, pts.length - 1] : [0]
    const out = idx.map((index) => {
      const p = rotatePoint(pts[index][0], pts[index][1], c.x, c.y, el.angle)
      return { handle: { kind: 'point', index } as HandleHit, x: p.x, y: p.y }
    })
    if (pointEdit) {
      const curved = isCurved(el)
      for (let i = 0; i < pts.length - 1; i++) {
        const m = segmentMidpoint(el.points, i, curved)
        const p = rotatePoint(el.x + m.x, el.y + m.y, c.x, c.y, el.angle)
        out.push({ handle: { kind: 'mid', index: i } as HandleHit, x: p.x, y: p.y })
      }
    }
    return [...out, ...rotate]
  }
  const pos: Record<Dir, Vec> = {
    nw: { x: b.x, y: b.y },
    n: { x: c.x, y: b.y },
    ne: { x: b.x + b.width, y: b.y },
    e: { x: b.x + b.width, y: c.y },
    se: { x: b.x + b.width, y: b.y + b.height },
    s: { x: c.x, y: b.y + b.height },
    sw: { x: b.x, y: b.y + b.height },
    w: { x: b.x, y: c.y },
  }
  const dirs = isText(el) ? CORNER_DIRS : ALL_DIRS
  return [
    ...dirs.map((dir) => {
      const p = rotatePoint(pos[dir].x, pos[dir].y, c.x, c.y, el.angle)
      return { handle: { kind: 'box', dir } as HandleHit, x: p.x, y: p.y }
    }),
    ...rotate,
  ]
}

const GROUP_DIRS: Dir[] = ['nw', 'ne', 'se', 'sw']

/** Corner handles of a multi-selection's common box. */
export function getGroupHandlePositions(box: Box): { dir: Dir; x: number; y: number }[] {
  const pos: Record<string, Vec> = {
    nw: { x: box.x, y: box.y },
    ne: { x: box.x + box.width, y: box.y },
    se: { x: box.x + box.width, y: box.y + box.height },
    sw: { x: box.x, y: box.y + box.height },
  }
  return GROUP_DIRS.map((dir) => ({ dir, ...pos[dir] }))
}

export function hitGroupRotation(box: Box, x: number, y: number, zoom: number): boolean {
  return hitRotationHandle(box, 0, x, y, zoom)
}

export function hitGroupHandle(box: Box, x: number, y: number, zoom: number): Dir | null {
  const r = HANDLE_RADIUS_PX / zoom
  for (const h of getGroupHandlePositions(box)) {
    if (Math.abs(h.x - x) <= r && Math.abs(h.y - y) <= r) return h.dir
  }
  return null
}

export function hitHandle(
  el: SceneElement,
  x: number,
  y: number,
  zoom: number,
  pointEdit = false,
): HandleHit | null {
  const r = HANDLE_RADIUS_PX / zoom
  // points win over midpoints when they overlap
  const all = getHandlePositions(el, pointEdit, zoom)
  for (const h of all) {
    if (h.handle.kind !== 'mid' && Math.abs(h.x - x) <= r && Math.abs(h.y - y) <= r) return h.handle
  }
  for (const h of all) {
    if (h.handle.kind === 'mid' && Math.abs(h.x - x) <= r && Math.abs(h.y - y) <= r) return h.handle
  }
  return null
}

export function cursorForHandle(h: HandleHit): string {
  if (h.kind === 'point' || h.kind === 'mid') return 'crosshair'
  if (h.kind === 'rotate') return 'grab'
  switch (h.dir) {
    case 'n':
    case 's':
      return 'ns-resize'
    case 'e':
    case 'w':
      return 'ew-resize'
    case 'nw':
    case 'se':
      return 'nwse-resize'
    default:
      return 'nesw-resize'
  }
}
