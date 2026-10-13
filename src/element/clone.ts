import { nanoid } from 'nanoid'
import type { SceneElement } from './types'
import { isLinear, isText } from './types'
import { randomInt } from './factory'
import { getCommonBounds } from './geometry'
import { bindingTarget, getBoundRefs } from './relations'

/**
 * Copies elements with new ids and seeds, offset by (dx, dy). Group ids are remapped consistently.
 * Relations (labels, arrow bindings, boundElements, frameId) are kept only between elements that
 * are both in the copied set, with ids remapped; everything else is cleared.
 */
export function cloneElements(elements: readonly SceneElement[], dx: number, dy: number): SceneElement[] {
  const groupMap = new Map<string, string>()
  const mapGroup = (g: string) => {
    let id = groupMap.get(g)
    if (!id) {
      id = nanoid()
      groupMap.set(g, id)
    }
    return id
  }
  const idMap = new Map(elements.map((el) => [el.id, nanoid()]))
  const mapId = (id: string | null | undefined): string | null => (id ? (idMap.get(id) ?? null) : null)
  const now = Date.now()
  return elements.map((el) => {
    const refs = getBoundRefs(el)
      .filter((r) => idMap.has(r.id))
      .map((r) => ({ ...r, id: idMap.get(r.id) as string }))
    const copy: SceneElement = {
      ...el,
      id: idMap.get(el.id) as string,
      x: el.x + dx,
      y: el.y + dy,
      seed: randomInt(),
      version: 1,
      versionNonce: randomInt(),
      updated: now,
      isDeleted: false,
      groupIds: el.groupIds.map(mapGroup),
      frameId: mapId(el.frameId),
      boundElements: refs.length ? refs : null,
    }
    if (isLinear(copy)) {
      const remap = (b: unknown) => {
        const t = mapId(bindingTarget(b))
        return t ? { ...(b as object), elementId: t } : null
      }
      return { ...copy, startBinding: remap(copy.startBinding), endBinding: remap(copy.endBinding) }
    }
    if (isText(copy)) return { ...copy, containerId: mapId(copy.containerId) }
    return copy
  })
}

/** Clones elements so that the center of their common bounds lands on (cx, cy). */
export function cloneCentered(elements: readonly SceneElement[], cx: number, cy: number): SceneElement[] {
  const b = getCommonBounds(elements)
  if (!b) return []
  return cloneElements(elements, cx - (b[0] + b[2]) / 2, cy - (b[1] + b[3]) / 2)
}
