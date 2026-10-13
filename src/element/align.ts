import type { SceneElement } from './types'
import { getCommonBounds } from './geometry'
import { moveElement } from './resize'

export type AlignKind = 'left' | 'centerH' | 'right' | 'top' | 'middle' | 'bottom'
export type DistributeAxis = 'horizontal' | 'vertical'

interface Unit {
  elements: SceneElement[]
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function toUnits(units: readonly (readonly SceneElement[])[]): Unit[] {
  const out: Unit[] = []
  for (const u of units) {
    const b = getCommonBounds(u)
    if (b) out.push({ elements: [...u], minX: b[0], minY: b[1], maxX: b[2], maxY: b[3] })
  }
  return out
}

const shift = (u: Unit, dx: number, dy: number): SceneElement[] =>
  dx === 0 && dy === 0 ? [] : u.elements.map((e) => moveElement(e, dx, dy))

/** Aligns each unit (a group counts as one) to the bounds of the whole selection, using rotated bounds. */
export function alignUnits(units: readonly (readonly SceneElement[])[], kind: AlignKind): SceneElement[] {
  const us = toUnits(units)
  if (us.length < 2) return []
  const minX = Math.min(...us.map((u) => u.minX))
  const maxX = Math.max(...us.map((u) => u.maxX))
  const minY = Math.min(...us.map((u) => u.minY))
  const maxY = Math.max(...us.map((u) => u.maxY))
  return us.flatMap((u) => {
    switch (kind) {
      case 'left':
        return shift(u, minX - u.minX, 0)
      case 'right':
        return shift(u, maxX - u.maxX, 0)
      case 'centerH':
        return shift(u, (minX + maxX) / 2 - (u.minX + u.maxX) / 2, 0)
      case 'top':
        return shift(u, 0, minY - u.minY)
      case 'bottom':
        return shift(u, 0, maxY - u.maxY)
      case 'middle':
        return shift(u, 0, (minY + maxY) / 2 - (u.minY + u.maxY) / 2)
    }
  })
}

/** Spaces three or more units so that the gaps between them are equal; the outer two stay in place. */
export function distributeUnits(units: readonly (readonly SceneElement[])[], axis: DistributeAxis): SceneElement[] {
  const us = toUnits(units)
  if (us.length < 3) return []
  const h = axis === 'horizontal'
  const lo = (u: Unit) => (h ? u.minX : u.minY)
  const hi = (u: Unit) => (h ? u.maxX : u.maxY)
  const sorted = [...us].sort((a, b) => lo(a) - lo(b) || hi(a) - hi(b))
  const start = lo(sorted[0])
  const end = Math.max(...sorted.map(hi))
  const total = sorted.reduce((sum, u) => sum + (hi(u) - lo(u)), 0)
  const gap = (end - start - total) / (sorted.length - 1)
  let pos = start
  const out: SceneElement[] = []
  for (const u of sorted) {
    const d = pos - lo(u)
    out.push(...(h ? shift(u, d, 0) : shift(u, 0, d)))
    pos += hi(u) - lo(u) + gap
  }
  return out
}
