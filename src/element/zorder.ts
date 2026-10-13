import type { SceneElement } from './types'
import { containerIdOf, isBoundText, isRenderable } from './types'

export type ZOrderOp = 'forward' | 'backward' | 'front' | 'back'

/**
 * Reorders the selected elements, keeping their relative order. Deleted and non-rendered elements
 * are ignored so every step is visible, and labels stay directly above their container.
 * Returns the same array when nothing changes.
 */
export function reorderElements(
  elements: readonly SceneElement[],
  selectedIds: readonly string[],
  op: ZOrderOp,
): readonly SceneElement[] {
  const liveIds = new Set(elements.filter((e) => !e.isDeleted).map((e) => e.id))
  const isLabel = (e: SceneElement) => !e.isDeleted && isBoundText(e) && liveIds.has(containerIdOf(e) as string)
  const base = elements.filter((e) => !isLabel(e))
  const moved = reorderBase(base, selectedIds, op)
  if (moved === base) return elements
  const labels = new Map<string, SceneElement[]>()
  for (const e of elements) {
    if (isLabel(e)) {
      const id = (e as { containerId: string }).containerId
      labels.set(id, [...(labels.get(id) ?? []), e])
    }
  }
  const out: SceneElement[] = []
  for (const e of moved) {
    out.push(e)
    const l = labels.get(e.id)
    if (l) out.push(...l)
  }
  return out
}

function reorderBase(
  elements: readonly SceneElement[],
  selectedIds: readonly string[],
  op: ZOrderOp,
): readonly SceneElement[] {
  const sel = new Set(selectedIds)
  const isSel = (e: SceneElement) => sel.has(e.id)
  const liveIdx: number[] = []
  elements.forEach((e, i) => {
    if (!e.isDeleted && isRenderable(e)) liveIdx.push(i)
  })
  const live = liveIdx.map((i) => elements[i])
  let out = live.slice()
  const n = out.length

  if (op === 'front') {
    out = [...live.filter((e) => !isSel(e)), ...live.filter(isSel)]
  } else if (op === 'back') {
    out = [...live.filter(isSel), ...live.filter((e) => !isSel(e))]
  } else if (op === 'forward') {
    for (let i = n - 2; i >= 0; i--) {
      if (isSel(out[i]) && !isSel(out[i + 1])) [out[i], out[i + 1]] = [out[i + 1], out[i]]
    }
  } else {
    for (let i = 1; i < n; i++) {
      if (isSel(out[i]) && !isSel(out[i - 1])) [out[i], out[i - 1]] = [out[i - 1], out[i]]
    }
  }

  if (out.every((e, i) => e === live[i])) return elements
  const result = elements.slice()
  liveIdx.forEach((idx, k) => {
    result[idx] = out[k]
  })
  return result
}
