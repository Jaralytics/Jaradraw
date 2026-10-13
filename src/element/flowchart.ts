import type { Box, LinearElement, SceneElement, ShapeElement } from './types'
import { isBoundText, isFrame, isLinear, isShape } from './types'
import { createLinear, createShape, updateElement } from './factory'
import { getBoxCenter, getElementBounds, getElementBox, withAbsolutePoints } from './geometry'
import { bindingTarget, bindArrowEnd, reconcile, recomputeArrow } from './relations'
import { roundnessFor, styleForNew } from './style'
import type { Edges, StyleDefaults } from './style'
import { snapPointToGrid } from './snap'

export type Direction = 'left' | 'right' | 'up' | 'down'

/** Distance between the outlines of a node and the node created next to it. */
export const FLOW_GAP = 100
/** Extra space between siblings when a new node is shifted sideways to a free slot. */
export const SLOT_SPACING = 40
export const SLOT_MARGIN = 10
export const MAX_SLOT_TRIES = 20

export const DIRECTION_BY_KEY: Record<string, Direction> = {
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
}

const AXIS: Record<Direction, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
}

/** A rectangle, ellipse or diamond that is alive and not locked. */
export function isNode(el: SceneElement | undefined): el is ShapeElement {
  return !!el && !el.isDeleted && !el.locked && isShape(el)
}

const centerOf = (el: SceneElement) => getBoxCenter(getElementBox(el))

/** Top-left corner of the new node before grid snapping and collision handling. */
export function targetPosition(source: SceneElement, dir: Direction): { x: number; y: number } {
  const [x1, y1, x2, y2] = getElementBounds(source)
  const c = centerOf(source)
  const w = source.width
  const h = source.height
  switch (dir) {
    case 'right':
      return { x: x2 + FLOW_GAP, y: c.y - h / 2 }
    case 'left':
      return { x: x1 - FLOW_GAP - w, y: c.y - h / 2 }
    case 'down':
      return { x: c.x - w / 2, y: y2 + FLOW_GAP }
    case 'up':
      return { x: c.x - w / 2, y: y1 - FLOW_GAP - h }
  }
}

function overlaps(a: readonly [number, number, number, number], b: readonly [number, number, number, number]): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
}

/** Elements a new node must not sit on: everything visible except labels, frames and arrows of the source. */
function obstacles(elements: readonly SceneElement[], source: SceneElement): SceneElement[] {
  return elements.filter((e) => {
    if (e.isDeleted || isBoundText(e) || isFrame(e)) return false
    if (isLinear(e) && (bindingTarget(e.startBinding) === source.id || bindingTarget(e.endBinding) === source.id)) return false
    return true
  })
}

const boxAt = (p: { x: number; y: number }, w: number, h: number): [number, number, number, number] => [
  p.x - SLOT_MARGIN,
  p.y - SLOT_MARGIN,
  p.x + w + SLOT_MARGIN,
  p.y + h + SLOT_MARGIN,
]

/** Slot `shift` px sideways from `base` (perpendicular to the direction), snapped to the grid. */
function slotAt(base: { x: number; y: number }, horizontal: boolean, shift: number, gridSize: number | null) {
  const p = horizontal ? { x: base.x, y: base.y + shift } : { x: base.x + shift, y: base.y }
  return gridSize ? snapPointToGrid(p, gridSize) : p
}

/** Position for a new node next to `source`: the straight slot, else the first free one beside it. */
export function findFreeSlot(
  elements: readonly SceneElement[],
  source: SceneElement,
  dir: Direction,
  gridSize: number | null,
): { x: number; y: number } {
  const base = targetPosition(source, dir)
  const horizontal = dir === 'left' || dir === 'right'
  const step = (horizontal ? source.height : source.width) + SLOT_SPACING
  const blockers = obstacles(elements, source).map((e) => getElementBounds(e))
  let candidate = base
  for (let i = 0; i < MAX_SLOT_TRIES; i++) {
    const shift = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * step
    candidate = slotAt(base, horizontal, shift, gridSize)
    const box = boxAt(candidate, source.width, source.height)
    if (!blockers.some((b) => overlaps(box, b))) return candidate
  }
  return candidate
}

/** Most nodes one preview can hold. */
export const MAX_FLOW_COUNT = 9

export interface FlowPlan {
  /** The whole scene with the new nodes and arrows added and bound. */
  elements: readonly SceneElement[]
  nodeIds: string[]
  arrowIds: string[]
  /** The new node on or nearest the axis; it becomes the selection. */
  primaryId: string
}

/**
 * Plans `count` parallel children of `source` in direction `dir`, each with its own arrow bound at
 * both ends. They sit side by side, centered on the source's center line; if any such slot is
 * taken they fill the free slots in alternating order instead. Labels are not copied.
 */
export function planConnectedNodes(
  elements: readonly SceneElement[],
  source: ShapeElement,
  dir: Direction,
  count: number,
  defaults: StyleDefaults,
  gridSize: number | null,
): FlowPlan {
  const n = Math.max(1, Math.min(MAX_FLOW_COUNT, Math.floor(count) || 1))
  const base = targetPosition(source, dir)
  const horizontal = dir === 'left' || dir === 'right'
  const step = (horizontal ? source.height : source.width) + SLOT_SPACING
  const blockers = obstacles(elements, source).map((e) => getElementBounds(e))
  const isFree = (p: { x: number; y: number }, placed: readonly { x: number; y: number }[]) => {
    const box = boxAt(p, source.width, source.height)
    return !blockers.some((b) => overlaps(box, b)) && !placed.some((q) => overlaps(box, boxAt(q, source.width, source.height)))
  }

  let slots: { pos: { x: number; y: number }; rank: number }[] = []
  const centered = Array.from({ length: n }, (_, i) => {
    const offset = i - (n - 1) / 2
    return { pos: slotAt(base, horizontal, offset * step, gridSize), rank: Math.abs(offset) }
  })
  if (centered.every((s, i) => isFree(s.pos, centered.slice(0, i).map((q) => q.pos)))) {
    slots = centered
  } else {
    const placed: { x: number; y: number }[] = []
    for (let i = 0; i < MAX_SLOT_TRIES + MAX_FLOW_COUNT * 2 && slots.length < n; i++) {
      const shift = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * step
      const pos = slotAt(base, horizontal, shift, gridSize)
      if (!isFree(pos, placed)) continue
      placed.push(pos)
      slots.push({ pos, rank: slots.length })
    }
    if (slots.length === 0) slots = [{ pos: base, rank: 0 }]
  }

  const style = {
    strokeColor: source.strokeColor,
    backgroundColor: source.backgroundColor,
    fillStyle: source.fillStyle,
    strokeWidth: source.strokeWidth,
    strokeStyle: source.strokeStyle,
    roughness: source.roughness,
    opacity: source.opacity,
    roundness: source.roundness,
  }
  let out: readonly SceneElement[] = elements
  const nodeIds: string[] = []
  const arrowIds: string[] = []
  for (const { pos } of slots) {
    const node: ShapeElement = {
      ...createShape(source.type, pos.x, pos.y, style),
      width: source.width,
      height: source.height,
    }
    const made = connectNodes([...out, node], source.id, node.id, defaults, true)
    out = made?.elements ?? [...out, node]
    nodeIds.push(node.id)
    if (made) arrowIds.push(made.arrowId)
  }
  const best = slots.reduce((bi, s, i) => (s.rank < slots[bi].rank ? i : bi), 0)
  return { elements: out, nodeIds, arrowIds, primaryId: nodeIds[best] }
}

/**
 * Adds an arrow from node `sourceId` to node `targetId`, bound at both ends. Returns null when
 * either is not a node, or when their boxes overlap (the arrow would have no room) unless allowed.
 */
export function connectNodes(
  elements: readonly SceneElement[],
  sourceId: string,
  targetId: string,
  defaults: StyleDefaults,
  allowOverlap = false,
): { elements: readonly SceneElement[]; arrowId: string } | null {
  const source = elements.find((e) => e.id === sourceId)
  const target = elements.find((e) => e.id === targetId)
  if (!isNode(source) || !isNode(target) || source.id === target.id) return null
  if (!allowOverlap && overlaps(getElementBounds(source), getElementBounds(target))) return null
  const from = centerOf(source)
  const to = centerOf(target)
  const base = createLinear('arrow', from.x, from.y, styleForNew(defaults, 'arrow'))
  const arrow = {
    ...withAbsolutePoints(base, [
      [from.x, from.y],
      [to.x, to.y],
    ]),
    endArrowhead: defaults.endArrowhead ?? 'arrow',
  }
  let next: readonly SceneElement[] = [...elements, arrow]
  next = bindArrowEnd(next, arrow.id, 'start', source.id)
  next = bindArrowEnd(next, arrow.id, 'end', target.id)
  return { elements: reconcile(elements, next), arrowId: arrow.id }
}

/** Nodes linked to `id` by a live arrow bound to it, in either direction of the arrow. */
export function connectedNodes(elements: readonly SceneElement[], id: string): ShapeElement[] {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const out = new Map<string, ShapeElement>()
  for (const a of elements) {
    if (a.isDeleted || !isLinear(a) || a.type !== 'arrow') continue
    const s = bindingTarget(a.startBinding)
    const e = bindingTarget(a.endBinding)
    const other = s === id ? e : e === id ? s : null
    if (!other || other === id) continue
    const node = byId.get(other)
    if (isNode(node)) out.set(node.id, node)
  }
  return [...out.values()]
}

/** The connected node lying most along `dir` (smallest angle to the axis, then nearest). */
export function nearestConnected(elements: readonly SceneElement[], id: string, dir: Direction): ShapeElement | null {
  const from = elements.find((e) => e.id === id)
  if (!from) return null
  const c = centerOf(from)
  const axis = AXIS[dir]
  let best: { node: ShapeElement; angle: number; dist: number } | null = null
  for (const node of connectedNodes(elements, id)) {
    const n = centerOf(node)
    const dx = n.x - c.x
    const dy = n.y - c.y
    const along = dx * axis.x + dy * axis.y
    if (along <= 0) continue
    const across = Math.abs(dx * axis.y - dy * axis.x)
    const angle = Math.atan2(across, along)
    const dist = Math.hypot(dx, dy)
    if (!best || angle < best.angle - 1e-9 || (Math.abs(angle - best.angle) <= 1e-9 && dist < best.dist)) {
      best = { node, angle, dist }
    }
  }
  return best ? best.node : null
}

const CYCLE: ShapeElement['type'][] = ['rectangle', 'diamond', 'ellipse']

export function nextShapeType(type: ShapeElement['type'], reverse = false): ShapeElement['type'] {
  const i = CYCLE.indexOf(type)
  return CYCLE[(i + (reverse ? CYCLE.length - 1 : 1)) % CYCLE.length]
}

/**
 * Converts the given nodes to the next type of the cycle, keeping everything else. Sharp or round
 * edges carry over; an ellipse has no roundness of its own, so leaving one uses `fallbackEdges`.
 */
export function convertNodeTypes(
  elements: readonly SceneElement[],
  ids: ReadonlySet<string>,
  reverse: boolean,
  fallbackEdges: Edges,
): readonly SceneElement[] {
  const byId = new Map<string, SceneElement>()
  for (const el of elements) {
    if (!ids.has(el.id) || !isNode(el)) continue
    const type = nextShapeType(el.type, reverse)
    const edges: Edges = el.type === 'ellipse' ? fallbackEdges : el.roundness ? 'round' : 'sharp'
    byId.set(el.id, updateElement(el, { type, roundness: roundnessFor(type, edges) ?? null }))
  }
  if (byId.size === 0) return elements
  // an outline change moves bound arrow ends even though the box stays put
  const arrows = new Map<string, LinearElement>()
  for (const a of elements) {
    if (a.isDeleted || !isLinear(a) || a.type !== 'arrow') continue
    if (byId.has(bindingTarget(a.startBinding) ?? '') || byId.has(bindingTarget(a.endBinding) ?? '')) arrows.set(a.id, a)
  }
  const lookup = (id: string) => byId.get(id) ?? elements.find((e) => e.id === id)
  for (const a of arrows.values()) {
    const r = recomputeArrow(a, lookup)
    if (r !== a) byId.set(a.id, r)
  }
  return elements.map((e) => byId.get(e.id) ?? e)
}

/**
 * Viewport scroll that brings `box` fully on screen with `margin` px to spare, panning as little
 * as possible; the zoom never changes. Returns the same viewport when nothing needs to move.
 */
export function revealBox<V extends { scrollX: number; scrollY: number; zoom: number }>(
  vp: V,
  box: Box,
  width: number,
  height: number,
  margin = 60,
): V {
  const z = vp.zoom
  const axis = (start: number, size: number, scroll: number, extent: number) => {
    const s1 = (start + scroll) * z
    const s2 = (start + size + scroll) * z
    if (s1 < margin) return scroll + (margin - s1) / z
    if (s2 > extent - margin) return scroll - (s2 - (extent - margin)) / z
    return scroll
  }
  const scrollX = axis(box.x, box.width, vp.scrollX, width)
  const scrollY = axis(box.y, box.height, vp.scrollY, height)
  return scrollX === vp.scrollX && scrollY === vp.scrollY ? vp : { ...vp, scrollX, scrollY }
}
