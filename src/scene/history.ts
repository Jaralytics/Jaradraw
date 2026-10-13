import type { SceneElement } from '../element/types'
import { containerIdOf, isBoundText } from '../element/types'
import { expandToWholeGroups } from '../element/group'

/**
 * Selection after an undo or redo: the live elements that differ between the two snapshots
 * (labels mapped to their containers, groups expanded). Empty when nothing live changed.
 */
export function selectionAfterRestore(before: readonly SceneElement[], after: readonly SceneElement[]): string[] {
  const prev = new Map(before.map((e) => [e.id, e]))
  const live = new Map(after.filter((e) => !e.isDeleted).map((e) => [e.id, e]))
  const ids = new Set<string>()
  for (const e of live.values()) {
    if (prev.get(e.id) === e) continue
    const id = isBoundText(e) ? (containerIdOf(e) as string) : e.id
    const target = live.get(id)
    if (target && !isBoundText(target)) ids.add(id)
  }
  const expanded = expandToWholeGroups(after, ids)
  return after.filter((e) => !e.isDeleted && !isBoundText(e) && expanded.has(e.id)).map((e) => e.id)
}

export interface History<T> {
  readonly stack: readonly T[]
  readonly index: number
}

export const HISTORY_LIMIT = 200

export const createHistory = <T>(initial: T): History<T> => ({ stack: [initial], index: 0 })

export function pushHistory<T>(h: History<T>, entry: T, limit = HISTORY_LIMIT): History<T> {
  let stack = [...h.stack.slice(0, h.index + 1), entry]
  if (stack.length > limit) stack = stack.slice(stack.length - limit)
  return { stack, index: stack.length - 1 }
}

/** Replaces the current entry (used to coalesce bursts such as a color drag). */
export function replaceCurrent<T>(h: History<T>, entry: T): History<T> {
  const stack = h.stack.slice()
  stack[h.index] = entry
  return { stack, index: h.index }
}

export const canUndo = <T>(h: History<T>): boolean => h.index > 0
export const canRedo = <T>(h: History<T>): boolean => h.index < h.stack.length - 1
export const currentEntry = <T>(h: History<T>): T => h.stack[h.index]

export const undoHistory = <T>(h: History<T>): History<T> =>
  canUndo(h) ? { stack: h.stack, index: h.index - 1 } : h

export const redoHistory = <T>(h: History<T>): History<T> =>
  canRedo(h) ? { stack: h.stack, index: h.index + 1 } : h
