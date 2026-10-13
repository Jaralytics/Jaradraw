import { nanoid } from 'nanoid'
import type { FrameElement, LinearElement, SceneElement } from './types'
import { isBoundText, isFrame } from './types'
import { baseDefaults, updateElement } from './factory'
import { getCommonBounds, rotatePoint } from './geometry'
import { bindingTarget } from './relations'

export const FRAME_DEFAULT_NAME = 'Marco'
export const FRAME_NAME_HEIGHT = 22
export const FRAME_NAME_SIZE = 14
export const FRAME_RADIUS = 6

export function createFrame(x: number, y: number): FrameElement {
  return { ...baseDefaults(), id: nanoid(), type: 'frame', name: null, x, y, strokeColor: '#bbbbbb', strokeWidth: 2 }
}

export function frameLabel(el: FrameElement): string {
  return el.name && el.name.trim() !== '' ? el.name : FRAME_DEFAULT_NAME
}

/** Approximate width of the name drawn above the frame (scene units). */
export function frameNameWidth(el: FrameElement): number {
  return frameLabel(el).length * FRAME_NAME_SIZE * 0.6 + 8
}

const sameRef = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Sets each element's frameId from where its center lies (topmost frame wins, else null). Groups
 * decide as a unit by the center of their common bounds; labels follow their container. With `ids`,
 * only units containing one of them are re-evaluated; a frame in `ids` re-evaluates everything.
 */
export function assignFrames(elements: readonly SceneElement[], ids?: ReadonlySet<string>): readonly SceneElement[] {
  const frames = elements.filter((e) => isFrame(e) && !e.isDeleted)
  // With a frame among the ids (created, resized, duplicated), loose elements and that frame's own
  // children are re-evaluated too; children of other frames are left alone.
  const touched = new Set(ids ? elements.filter((e) => isFrame(e) && ids.has(e.id)).map((e) => e.id) : [])
  const wants = (m: SceneElement) =>
    !ids || ids.has(m.id) || (touched.size > 0 && (m.frameId === null || touched.has(m.frameId)))
  const labelsOf = new Map<string, SceneElement[]>()
  for (const e of elements) {
    const cid = (e as { containerId?: string | null }).containerId
    if (isBoundText(e) && cid) labelsOf.set(cid, [...(labelsOf.get(cid) ?? []), e])
  }
  const units = new Map<string, SceneElement[]>()
  for (const e of elements) {
    if (e.isDeleted || e.locked || isFrame(e) || isBoundText(e)) continue
    const key = e.groupIds.length ? `g:${e.groupIds[e.groupIds.length - 1]}` : `e:${e.id}`
    units.set(key, [...(units.get(key) ?? []), e])
  }
  // containment is tested in the frame's own (unrotated) space
  const frameAt = (cx: number, cy: number): string | null => {
    let found: string | null = null
    for (const f of frames) {
      const p = f.angle ? rotatePoint(cx, cy, f.x + f.width / 2, f.y + f.height / 2, -f.angle) : { x: cx, y: cy }
      if (p.x >= f.x && p.x <= f.x + f.width && p.y >= f.y && p.y <= f.y + f.height) found = f.id
    }
    return found
  }
  const target = new Map<string, string | null>()
  const setUnit = (unit: SceneElement[], frameId: string | null) => {
    for (const m of unit) {
      target.set(m.id, frameId)
      for (const l of labelsOf.get(m.id) ?? []) target.set(l.id, frameId)
    }
  }
  const centerOf = (unit: SceneElement[]) => {
    const b = getCommonBounds(unit)
    return b ? { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2 } : null
  }
  const arrows: SceneElement[] = []
  for (const unit of units.values()) {
    if (unit.length === 1 && unit[0].type === 'arrow') {
      arrows.push(unit[0])
      continue
    }
    if (!unit.some(wants)) continue
    const c = centerOf(unit)
    if (c) setUnit(unit, frameAt(c.x, c.y))
  }
  // arrows follow the frame of the element they are bound to when that element was re-evaluated
  for (const a of arrows) {
    const l = a as LinearElement
    const via = [bindingTarget(l.startBinding), bindingTarget(l.endBinding)].find((id) => id && target.has(id))
    if (!via && !wants(a)) continue
    if (via) setUnit([a], target.get(via) ?? null)
    else {
      const c = centerOf([a])
      if (c) setUnit([a], frameAt(c.x, c.y))
    }
  }
  const next = elements.map((e) =>
    target.has(e.id) && e.frameId !== target.get(e.id) ? updateElement(e, { frameId: target.get(e.id) as string | null }) : e,
  )
  return sameRef(next, elements) ? elements : next
}

/** Clears the frameId of elements whose frame is gone or deleted. */
export function releaseFrameChildren(elements: readonly SceneElement[]): readonly SceneElement[] {
  const live = new Set(elements.filter((e) => isFrame(e) && !e.isDeleted).map((e) => e.id))
  const next = elements.map((e) => (!e.isDeleted && e.frameId && !live.has(e.frameId) ? updateElement(e, { frameId: null }) : e))
  return sameRef(next, elements) ? elements : next
}

/** The given elements plus the children (and labels) of any frame among them. */
export function withFrameChildren(all: readonly SceneElement[], els: readonly SceneElement[]): SceneElement[] {
  const frameIds = new Set(els.filter(isFrame).map((e) => e.id))
  if (frameIds.size === 0) return [...els]
  const have = new Set(els.map((e) => e.id))
  const extra = all.filter((e) => !e.isDeleted && e.frameId && frameIds.has(e.frameId) && !have.has(e.id))
  return [...els, ...extra]
}
