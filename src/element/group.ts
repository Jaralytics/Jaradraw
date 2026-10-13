import { nanoid } from 'nanoid'
import type { Box, SceneElement } from './types'
import { containerIdOf, isBoundText, isFreedraw, isLinear, isRenderable, isText } from './types'
import { updateElement } from './factory'
import { bakeAngle, getCommonBounds, getElementBounds } from './geometry'
import type { Vec } from './geometry'

export function getSelectionBounds(elements: readonly SceneElement[]): Box | null {
  const b = getCommonBounds(elements)
  return b ? { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] } : null
}

export function normalizeRect(a: Vec, b: Vec): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

/** Elements whose (rotation-aware) bounds lie fully inside the rectangle. */
export function elementsInRect(elements: readonly SceneElement[], rect: Box): SceneElement[] {
  return elements.filter((el) => {
    if (el.isDeleted || el.locked || !isRenderable(el) || isBoundText(el)) return false
    const [x1, y1, x2, y2] = getElementBounds(el)
    return (
      x1 >= rect.x &&
      y1 >= rect.y &&
      x2 <= rect.x + rect.width &&
      y2 <= rect.y + rect.height
    )
  })
}

/**
 * Uniformly scales elements from the `from` box into the `to` box. Positions, sizes,
 * line/arrow points and text fontSize all scale by `scale`.
 */
export function scaleElements(
  originals: readonly SceneElement[],
  from: Box,
  to: Box,
  scale: number,
): SceneElement[] {
  const mapX = (x: number) => to.x + (x - from.x) * scale
  const mapY = (y: number) => to.y + (y - from.y) * scale

  return originals.map((original) => {
    const el = bakeAngle(original)
    if (isLinear(el) || isFreedraw(el)) {
      return updateElement(el, {
        x: mapX(el.x),
        y: mapY(el.y),
        width: el.width * scale,
        height: el.height * scale,
        points: el.points.map(([px, py]) => [px * scale, py * scale] as const),
      } as Partial<typeof el>)
    }
    const width = el.width * scale
    const height = el.height * scale
    const cx = mapX(el.x + el.width / 2)
    const cy = mapY(el.y + el.height / 2)
    const patch: Record<string, number> = { x: cx - width / 2, y: cy - height / 2, width, height }
    if (isText(el)) patch.fontSize = Math.max(1, el.fontSize * scale)
    return updateElement(el, patch)
  })
}

/** Live, non-label elements: the ones that take part in selection logic. */
const selectable = (e: SceneElement) => !e.isDeleted && isRenderable(e) && !isBoundText(e)

/**
 * The group that clicking `el` selects: the outermost one, or, while `editingGroupId` is entered,
 * the group one level inside it (null selects the element itself).
 */
export function selectableGroupId(el: SceneElement, editingGroupId: string | null = null): string | null {
  const ids = el.groupIds
  if (ids.length === 0) return null
  if (editingGroupId) {
    const k = ids.indexOf(editingGroupId)
    if (k >= 0) return k > 0 ? ids[k - 1] : null
  }
  return ids[ids.length - 1]
}

export function groupMembers(elements: readonly SceneElement[], groupId: string): SceneElement[] {
  return elements.filter((e) => selectable(e) && e.groupIds.includes(groupId))
}

/** Ids selected by picking `id`: its whole selectable group, or just itself. */
export function selectionForClick(
  elements: readonly SceneElement[],
  id: string,
  editingGroupId: string | null = null,
): string[] {
  const el = elements.find((e) => e.id === id)
  if (!el) return []
  const g = selectableGroupId(el, editingGroupId)
  return g ? groupMembers(elements, g).map((e) => e.id) : [id]
}

/** Elements inside the rectangle, where a group counts only when all of its members are inside. */
export function selectionInRect(
  elements: readonly SceneElement[],
  rect: Box,
  editingGroupId: string | null = null,
): SceneElement[] {
  const inside = elementsInRect(elements, rect)
  const insideIds = new Set(inside.map((e) => e.id))
  return inside.filter((e) => {
    const g = selectableGroupId(e, editingGroupId)
    return g === null || groupMembers(elements, g).every((m) => insideIds.has(m.id) || m.locked)
  })
}

/** Groups of the elements to move, kept in order: units are a group (by selectable id) or a single element. */
export function selectionUnits(
  elements: readonly SceneElement[],
  ids: readonly string[],
  editingGroupId: string | null = null,
): SceneElement[][] {
  const chosen = new Set(ids)
  const units = new Map<string, SceneElement[]>()
  for (const e of elements) {
    if (!chosen.has(e.id) || !selectable(e)) continue
    const key = selectableGroupId(e, editingGroupId) ?? e.id
    units.set(key, [...(units.get(key) ?? []), e])
  }
  return [...units.values()]
}

const labelsOf = (elements: readonly SceneElement[], ids: ReadonlySet<string>) =>
  elements.filter((e) => !e.isDeleted && isBoundText(e) && ids.has(containerIdOf(e) as string))

/**
 * Appends a new group id to the selected elements and their labels, and gathers the members
 * contiguously at the position of the frontmost one. Returns the same array when nothing changes.
 */
export function groupElements(
  elements: readonly SceneElement[],
  ids: readonly string[],
  groupId: string = nanoid(),
): readonly SceneElement[] {
  const chosen = new Set(ids)
  const targets = elements.filter((e) => chosen.has(e.id) && selectable(e) && !e.locked)
  if (targets.length < 2) return elements
  const outer = new Set(targets.map((e) => e.groupIds[e.groupIds.length - 1] ?? e.id))
  if (outer.size < 2) return elements
  const memberIds = new Set([...targets.map((e) => e.id), ...labelsOf(elements, new Set(targets.map((e) => e.id))).map((e) => e.id)])
  const grouped = elements.map((e) => (memberIds.has(e.id) ? updateElement(e, { groupIds: [...e.groupIds, groupId] }) : e))
  const members = grouped.filter((e) => memberIds.has(e.id))
  let lastIndex = -1
  grouped.forEach((e, i) => {
    if (memberIds.has(e.id)) lastIndex = i
  })
  const out: SceneElement[] = []
  grouped.forEach((e, i) => {
    if (memberIds.has(e.id)) {
      if (i === lastIndex) out.push(...members)
    } else out.push(e)
  })
  return out
}

/**
 * Removes the outermost group of every selected group that is selected entirely.
 * Returns the same array when nothing changes.
 */
export function ungroupElements(elements: readonly SceneElement[], ids: readonly string[]): readonly SceneElement[] {
  const chosen = new Set(ids)
  const selected = elements.filter((e) => chosen.has(e.id) && selectable(e) && !e.locked)
  const drop = new Set<string>()
  for (const g of new Set(selected.map((e) => e.groupIds[e.groupIds.length - 1]).filter(Boolean))) {
    if (groupMembers(elements, g).every((m) => chosen.has(m.id))) drop.add(g)
  }
  if (drop.size === 0) return elements
  return elements.map((e) => {
    const last = e.groupIds[e.groupIds.length - 1]
    return last && drop.has(last) && !e.isDeleted ? updateElement(e, { groupIds: e.groupIds.slice(0, -1) }) : e
  })
}

const outermost = (e: SceneElement) => e.groupIds[e.groupIds.length - 1]

/** A group is locked as a unit: if any member is locked, all its members are. */
export function lockWholeGroups(elements: readonly SceneElement[]): SceneElement[] {
  const locked = new Set(elements.filter((e) => !e.isDeleted && e.locked && e.groupIds.length).map(outermost))
  return elements.map((e) =>
    locked.size && !e.locked && !e.isDeleted && e.groupIds.length && locked.has(outermost(e))
      ? updateElement(e, { locked: true })
      : e,
  )
}

/** Ids of every element in the outermost groups of the given ids (plus the ids themselves). */
export function expandToWholeGroups(elements: readonly SceneElement[], ids: ReadonlySet<string>): Set<string> {
  const outer = new Set(elements.filter((e) => ids.has(e.id) && e.groupIds.length).map(outermost))
  const out = new Set(ids)
  if (outer.size) for (const e of elements) if (e.groupIds.length && outer.has(outermost(e))) out.add(e.id)
  return out
}
