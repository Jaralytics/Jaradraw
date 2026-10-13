import type { Binding, LinearElement, Point, SceneElement, TextElement } from './types'
import { containerIdOf, isBoundText, isLinear, isText } from './types'
import { updateElement } from './factory'
import { bakeAngle, getAbsolutePoints, getBoxCenter, getElementBounds, getElementBox, rotatePoint, withAbsolutePoints } from './geometry'
import type { Vec } from './geometry'
import { BIND_GAP, isBindTarget, outlinePointToward, pointInsideElement } from './bind'
import { layoutLabel } from './label'
import { routeElbow, routeElbowVia, sideAnchor } from './elbow'
import { customDataWith, readWaypoints } from './waypoints'
import type { ElbowEnd, Heading } from './elbow'

export interface BoundRef {
  type: string
  id: string
}

export type ArrowEnd = 'start' | 'end'
const BINDING_KEY = { start: 'startBinding', end: 'endBinding' } as const

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isBinding = (b: unknown): b is Binding => isObject(b) && typeof b.elementId === 'string'

export function getBoundRefs(el: SceneElement): BoundRef[] {
  if (!Array.isArray(el.boundElements)) return []
  return el.boundElements.filter(
    (r): r is BoundRef => isObject(r) && typeof r.id === 'string' && typeof r.type === 'string',
  )
}

/** Id an arrow binding points to, or null. Other fields (focus, gap...) are not interpreted. */
export function bindingTarget(b: unknown): string | null {
  return isObject(b) && typeof b.elementId === 'string' ? b.elementId : null
}

export function makeBinding(elementId: string, previous?: unknown) {
  const rest = isObject(previous) ? previous : {}
  return { ...rest, elementId, focus: 0, gap: BIND_GAP, fixedPoint: null }
}

function withRef(el: SceneElement, ref: BoundRef): SceneElement {
  if (getBoundRefs(el).some((r) => r.id === ref.id && r.type === ref.type)) return el
  return updateElement(el, { boundElements: [...(el.boundElements ?? []), ref] })
}

function withoutRef(el: SceneElement, id: string): SceneElement {
  if (!Array.isArray(el.boundElements)) return el
  const kept = el.boundElements.filter((r) => !(isObject(r) && r.id === id))
  if (kept.length === el.boundElements.length) return el
  return updateElement(el, { boundElements: kept.length ? kept : null })
}

export function getLabel(elements: readonly SceneElement[], containerId: string): TextElement | undefined {
  return elements.find((e): e is TextElement => !e.isDeleted && isText(e) && e.containerId === containerId)
}

/** The given elements plus the labels of any container among them, in scene order. */
export function expandWithLabels(all: readonly SceneElement[], chosen: readonly SceneElement[]): SceneElement[] {
  const ids = new Set(chosen.map((e) => e.id))
  return all.filter(
    (e) => !e.isDeleted && (ids.has(e.id) || (isBoundText(e) && ids.has(containerIdOf(e) as string))),
  )
}

function replaceAll(elements: readonly SceneElement[], repl: Map<string, SceneElement>) {
  return repl.size === 0 ? elements : elements.map((e) => repl.get(e.id) ?? e)
}

export function unbindArrowEnd(
  elements: readonly SceneElement[],
  arrowId: string,
  end: ArrowEnd,
): readonly SceneElement[] {
  const arrow = elements.find((e) => e.id === arrowId)
  if (!arrow || !isLinear(arrow)) return elements
  const current = arrow[BINDING_KEY[end]]
  if (current === null || current === undefined) return elements
  const targetId = bindingTarget(current)
  const repl = new Map<string, SceneElement>()
  repl.set(arrow.id, updateElement(arrow, { [BINDING_KEY[end]]: null } as Partial<LinearElement>))
  const otherKey = BINDING_KEY[end === 'start' ? 'end' : 'start']
  if (targetId && bindingTarget(arrow[otherKey]) !== targetId) {
    const shape = elements.find((e) => e.id === targetId)
    if (shape) {
      const s = withoutRef(shape, arrowId)
      if (s !== shape) repl.set(shape.id, s)
    }
  }
  return replaceAll(elements, repl)
}

/** Binds one end of an arrow to a shape on both sides (the endpoint moves on the next reconcile). */
export function bindArrowEnd(
  elements: readonly SceneElement[],
  arrowId: string,
  end: ArrowEnd,
  shapeId: string,
): readonly SceneElement[] {
  const base = unbindArrowEnd(elements, arrowId, end)
  const arrow = base.find((e) => e.id === arrowId)
  const shape = base.find((e) => e.id === shapeId)
  if (!arrow || !isLinear(arrow) || arrow.type !== 'arrow' || !shape || !isBindTarget(shape)) return base
  // an arrow never binds both ends to the same shape
  if (bindingTarget(arrow[BINDING_KEY[end === 'start' ? 'end' : 'start']]) === shapeId) return base
  const repl = new Map<string, SceneElement>()
  repl.set(arrow.id, updateElement(arrow, { [BINDING_KEY[end]]: makeBinding(shapeId) } as Partial<LinearElement>))
  repl.set(shape.id, withRef(shape, { type: 'arrow', id: arrowId }))
  return replaceAll(base, repl)
}

/** Unbinds every end of the given arrows whose shape is not in `keep`. */
export function detachArrows(
  elements: readonly SceneElement[],
  arrowIds: ReadonlySet<string>,
  keep: ReadonlySet<string>,
): readonly SceneElement[] {
  let out = elements
  for (const id of arrowIds) {
    const arrow = out.find((e) => e.id === id)
    if (!arrow || !isLinear(arrow)) continue
    for (const end of ['start', 'end'] as const) {
      const t = bindingTarget(arrow[BINDING_KEY[end]])
      if (t !== null && !keep.has(t)) out = unbindArrowEnd(out, id, end)
    }
  }
  return out
}

/** Inserts a new label directly above its container and registers it in the container's boundElements. */
export function attachLabel(
  elements: readonly SceneElement[],
  container: SceneElement,
  label: TextElement,
): readonly SceneElement[] {
  const out: SceneElement[] = []
  for (const e of elements) {
    if (e.id === container.id) out.push(withRef(container, { type: 'text', id: label.id }), label)
    else out.push(e)
  }
  return out
}

const EPS = 1e-6

function geometryChanged(a: SceneElement | undefined, b: SceneElement): boolean {
  if (!a) return true
  if (a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height || a.angle !== b.angle) return true
  return isLinear(a) && isLinear(b) && a.points !== b.points
}

function bindingsChanged(a: SceneElement | undefined, b: SceneElement): boolean {
  if (!a) return true
  return isLinear(a) && isLinear(b) && (a.startBinding !== b.startBinding || a.endBinding !== b.endBinding)
}

/** The end that was just bound, or undefined when the arrow's bindings did not change. */
function placingEnd(was: SceneElement | undefined, a: LinearElement): ArrowEnd | undefined {
  if (!was) return 'end'
  if (!isLinear(was)) return undefined
  const s = was.startBinding !== a.startBinding
  const e = was.endBinding !== a.endBinding
  if (s && !e) return 'start'
  return s || e ? 'end' : undefined
}

/**
 * Recomputes the bound endpoints of an arrow; returns the same object when nothing moves.
 * With `placing`, the end that was just bound stays free when binding it would reverse the arrow
 * or put an end inside the other bound shape.
 */
export function recomputeBoundEnds(
  arrow: LinearElement,
  lookup: (id: string) => SceneElement | undefined,
  placing?: ArrowEnd,
): LinearElement {
  const find = (b: unknown) => {
    const id = bindingTarget(b)
    const el = id ? lookup(id) : undefined
    return el && isBindTarget(el) ? el : undefined
  }
  if (arrow.elbowed === true) return arrow
  let sShape = find(arrow.startBinding)
  let eShape = find(arrow.endBinding)
  if (!sShape && !eShape) return arrow
  const src = getAbsolutePoints(arrow)
  const n = src.length
  if (n < 2) return arrow
  const center = (el: SceneElement): Vec => getBoxCenter(getElementBox(el))
  const pt = (p: Point): Vec => ({ x: p[0], y: p[1] })
  const attempt = (s: SceneElement | undefined, e: SceneElement | undefined) => {
    const abs: Point[] = src.map((p) => [p[0], p[1]] as Point)
    const patch: Record<string, unknown> = {}
    let moved = false
    const apply = (end: ArrowEnd, shape: SceneElement, from: Vec, index: number) => {
      const p = outlinePointToward(shape, from)
      if (Math.abs(p.x - src[index][0]) < EPS && Math.abs(p.y - src[index][1]) < EPS) return
      abs[index] = [p.x, p.y]
      moved = true
      patch[BINDING_KEY[end]] = makeBinding(shape.id, arrow[BINDING_KEY[end]])
    }
    if (s) apply('start', s, n === 2 && e ? center(e) : pt(src[1]), 0)
    if (e) apply('end', e, n === 2 && s ? center(s) : pt(src[n - 2]), n - 1)
    return { abs, patch, moved }
  }
  let r = attempt(sShape, eShape)
  if (placing && r.moved) {
    const dot =
      (r.abs[n - 1][0] - r.abs[0][0]) * (src[n - 1][0] - src[0][0]) +
      (r.abs[n - 1][1] - r.abs[0][1]) * (src[n - 1][1] - src[0][1])
    const crossed =
      !!sShape && !!eShape && (pointInsideElement(sShape, r.abs[n - 1][0], r.abs[n - 1][1]) || pointInsideElement(eShape, r.abs[0][0], r.abs[0][1]))
    if (dot < 0 || crossed) {
      if (placing === 'start') sShape = undefined
      else eShape = undefined
      r = attempt(sShape, eShape)
      r.patch[BINDING_KEY[placing]] = null
      r.moved = true
    }
  }
  const { abs, patch } = r
  if (!r.moved) return arrow
  // never produce a zero-length arrow: ends that would coincide stay unbound where the user put them
  if (Math.hypot(abs[n - 1][0] - abs[0][0], abs[n - 1][1] - abs[0][1]) < 1) {
    const cleared: Record<string, unknown> = {}
    if (sShape) cleared[BINDING_KEY.start] = null
    if (eShape) cleared[BINDING_KEY.end] = null
    return { ...arrow, ...cleared } as LinearElement
  }
  return { ...withAbsolutePoints(arrow, abs), ...patch } as LinearElement
}

const near = (a: number, b: number) => Math.abs(a - b) < EPS

/** Side of the shape a binding's fixedPoint sits on (world frame), when the binding targets that shape. */
export function storedSide(binding: unknown, shape: SceneElement): Heading | undefined {
  if (!isBinding(binding) || binding.elementId !== shape.id) return undefined
  const f = binding.fixedPoint
  if (!f || !Number.isFinite(f[0]) || !Number.isFinite(f[1])) return undefined
  // side in the shape's own frame by normalised offsets, then turned by its angle
  const dx = f[0] - 0.5
  const dy = f[1] - 0.5
  const local = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) }
  const v = rotatePoint(local.x, local.y, 0, 0, shape.angle)
  if (Math.abs(v.x) >= Math.abs(v.y)) return v.x >= 0 ? 'right' : 'left'
  return v.y >= 0 ? 'down' : 'up'
}

const HEADING_VEC: Record<Heading, Vec> = { right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 } }

/** True when every pinned side of the route points towards the other end. */
function sidesFaceEachOther(
  route: { points: Vec[]; endHeading: Heading; startHeading: Heading },
  keep: { start?: Heading; end?: Heading },
  waypoints: readonly Vec[] = [],
): boolean {
  const first = route.points[0]
  const last = route.points[route.points.length - 1]
  const dot = (a: Vec, b: Vec, h: Heading) => (b.x - a.x) * HEADING_VEC[h].x + (b.y - a.y) * HEADING_VEC[h].y
  // with waypoints, each pinned side must face the waypoint nearest to its end
  if (keep.start && dot(first, waypoints[0] ?? last, route.startHeading) <= 0) return false
  if (keep.end && dot(last, waypoints[waypoints.length - 1] ?? first, route.endHeading) <= 0) return false
  return true
}

/** Anchor normalised in the shape's unrotated box, clamped to 0..1; exactly 0.5 is nudged as Excalidraw does. */
function fixedPointOf(shape: SceneElement, p: Vec): [number, number] {
  const box = getElementBox(shape)
  const c = getBoxCenter(box)
  const l = shape.angle === 0 ? p : rotatePoint(p.x, p.y, c.x, c.y, -shape.angle)
  const norm = (v: number, size: number) => {
    // the clamp is deliberate: the anchor sits `gap` px outside the box
    const n = size > EPS ? Math.min(1, Math.max(0, v / size)) : 0.5
    return Math.abs(n - 0.5) < 1e-9 ? 0.5001 : n
  }
  return [norm(l.x - box.x, box.width), norm(l.y - box.y, box.height)]
}

/**
 * Routes an elbow arrow between its bound shapes (or its current free endpoints) as orthogonal
 * segments. `override` replaces the shape an end is bound to; null forces a free end. Returns the
 * same object when nothing changes.
 */
export function rerouteElbowArrow(
  arrow: LinearElement,
  lookup: (id: string) => SceneElement | undefined,
  override?: { start?: string | null; end?: string | null },
  sides?: { start?: Heading; end?: Heading },
): LinearElement {
  const base = bakeAngle(arrow)
  const src = getAbsolutePoints(base)
  if (src.length === 0) return arrow
  const shapeFor = (end: ArrowEnd) => {
    const id = override && override[end] !== undefined ? override[end] : bindingTarget(arrow[BINDING_KEY[end]])
    const el = id ? lookup(id) : undefined
    return el && isBindTarget(el) ? el : undefined
  }
  const sShape = shapeFor('start')
  const eShape = shapeFor('end')
  if (!sShape && !eShape && src.length < 2) return arrow
  const first = src[0]
  const last = src[src.length - 1]
  const endOf = (shape: SceneElement | undefined, p: Point): ElbowEnd => ({
    point: { x: p[0], y: p[1] },
    box: shape ? getElementBounds(shape) : null,
  })
  const sEnd = endOf(sShape, first)
  const eEnd = endOf(eShape, last)
  // an arrow keeps its stored exit and entry sides while the route stays clean and the sides face each other
  const keep = sides
    ? {}
    : {
        start: sShape && !(override && override.start !== undefined) ? storedSide(arrow.startBinding, sShape) : undefined,
        end: eShape && !(override && override.end !== undefined) ? storedSide(arrow.endBinding, eShape) : undefined,
      }
  // waypoints are stored relative to x/y; the route is computed in scene coordinates
  const stored = readWaypoints(base).map(([wx, wy]) => ({ x: base.x + wx, y: base.y + wy }))
  // a waypoint sitting on an end point is invisible and could never be deleted: drop it
  const atEnd = (w: Vec) => (near(w.x, first[0]) && near(w.y, first[1])) || (near(w.x, last[0]) && near(w.y, last[1]))
  const waypoints = stored.filter((w) => !atEnd(w))
  const pruned = waypoints.length !== stored.length
  const go = (o?: { start?: Heading; end?: Heading }) => (waypoints.length ? routeElbowVia(sEnd, waypoints, eEnd, o) : routeElbow(sEnd, eEnd, o))
  const pinned = keep.start || keep.end ? go(keep) : null
  const route = pinned && pinned.clean && sidesFaceEachOther(pinned, keep, waypoints) ? pinned : go(sides)
  const pts: Vec[] = route.points.map((p) => ({ ...p }))
  // a degenerate route (coincident or non-finite points) is never written
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || pts.every((p) => near(p.x, pts[0].x) && near(p.y, pts[0].y))) {
    return arrow
  }
  const patch: Record<string, unknown> = {
    roundness: null,
    angle: 0,
    fixedSegments: null,
    startIsSpecial: null,
    endIsSpecial: null,
  }
  let bindingsSame = true
  const anchorEnd = (end: ArrowEnd, shape: SceneElement, h: Heading, index: number) => {
    const prev = arrow[BINDING_KEY[end]]
    const pb = isBinding(prev) ? prev : null
    const gap = typeof pb?.gap === 'number' ? pb.gap : BIND_GAP
    const a = sideAnchor(shape, h, gap)
    // only the coordinate along the heading moves, so the route stays axis-aligned
    const p = pts[index]
    pts[index] = h === 'left' || h === 'right' ? { x: a.x, y: p.y } : { x: p.x, y: a.y }
    const fixedPoint = fixedPointOf(shape, pts[index])
    const old = pb?.fixedPoint
    const same =
      !!pb && pb.elementId === shape.id && !!old && near(old[0], fixedPoint[0]) && near(old[1], fixedPoint[1])
    if (!same) bindingsSame = false
    const focus = typeof pb?.focus === 'number' ? pb.focus : 0
    patch[BINDING_KEY[end]] = same ? prev : { ...pb, elementId: shape.id, focus, gap, fixedPoint }
  }
  if (sShape) anchorEnd('start', sShape, route.startHeading, 0)
  if (eShape) anchorEnd('end', eShape, route.endHeading, pts.length - 1)

  const same =
    !pruned &&
    bindingsSame &&
    base === arrow &&
    arrow.roundness === null &&
    (arrow.fixedSegments ?? null) === null &&
    (arrow.startIsSpecial ?? null) === null &&
    (arrow.endIsSpecial ?? null) === null &&
    pts.length === src.length &&
    pts.every((p, i) => near(p.x, src[i][0]) && near(p.y, src[i][1]))
  if (same) return arrow
  const out = { ...withAbsolutePoints(base, pts.map((p) => [p.x, p.y] as Point)), ...patch } as LinearElement
  if (!pruned) return out
  return { ...out, customData: customDataWith(out, waypoints.map((w) => [w.x - out.x, w.y - out.y] as Point)) }
}

/** Recomputes an arrow after its shapes or itself changed: elbow arrows are re-routed, others re-snapped. */
export function recomputeArrow(
  arrow: LinearElement,
  lookup: (id: string) => SceneElement | undefined,
  placing?: ArrowEnd,
): LinearElement {
  return arrow.elbowed === true ? rerouteElbowArrow(arrow, lookup) : recomputeBoundEnds(arrow, lookup, placing)
}

function sameValues(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((p, i) => near(p[0], b[i][0]) && near(p[1], b[i][1]))
}

/** Own-change trigger for an arrow in reconcile; unbound elbow arrows keep their shape when merely moved. */
function arrowNeedsRecompute(
  was: SceneElement | undefined,
  el: LinearElement,
  live: (id: string) => SceneElement | undefined,
): boolean {
  const elbow = el.elbowed === true
  if (!was) return !elbow
  if (!isLinear(was)) return true
  if ((was.elbowed === true) !== elbow) return true
  if (!elbow) return bindingsChanged(was, el) || geometryChanged(was, el)
  if (!bindingsChanged(was, el) && !geometryChanged(was, el)) return false
  const bound = (['start', 'end'] as const).some((end) => {
    const t = bindingTarget(el[BINDING_KEY[end]])
    const s = t ? live(t) : undefined
    return !!s && isBindTarget(s)
  })
  return bound || el.angle !== was.angle || !sameValues(was.points, el.points)
}

function labelOf(container: SceneElement, cur: Map<string, SceneElement>): TextElement | undefined {
  for (const r of getBoundRefs(container)) {
    const t = cur.get(r.id)
    if (r.type === 'text' && t && !t.isDeleted && isText(t) && t.containerId === container.id) return t
  }
  return undefined
}

/**
 * Brings derived data back in sync after `prev` became `next`: labels follow their containers,
 * bound arrow ends follow their shapes, and deletions cascade. Only elements whose object
 * changed are considered, so unrelated elements keep their identity.
 */
export function reconcile(prev: readonly SceneElement[], next: readonly SceneElement[]): readonly SceneElement[] {
  if (prev === next) return next
  const prevById = new Map(prev.map((e) => [e.id, e]))
  const changed = next.filter((e) => prevById.get(e.id) !== e)
  if (changed.length === 0) return next
  const cur = new Map(next.map((e) => [e.id, e]))
  const put = (e: SceneElement) => cur.set(e.id, e)
  const live = (id: string) => {
    const e = cur.get(id)
    return e && !e.isDeleted ? e : undefined
  }

  // 1. Deletion cascade: labels go with their container, bindings and back-references are cleared
  const cleared = new Set<string>()
  const cascade = (el: SceneElement) => {
    for (const r of getBoundRefs(el)) {
      const t = cur.get(r.id)
      if (!t) continue
      if (r.type === 'text' && isText(t) && t.containerId === el.id && !t.isDeleted) {
        const d = updateElement(t, { isDeleted: true })
        put(d)
        cascade(d)
      } else if (r.type === 'arrow' && isLinear(t)) {
        let a: LinearElement = t
        if (bindingTarget(a.startBinding) === el.id) a = updateElement(a, { startBinding: null })
        if (bindingTarget(a.endBinding) === el.id) a = updateElement(a, { endBinding: null })
        if (a !== t) {
          put(a)
          if (a.elbowed === true) cleared.add(a.id)
        }
      }
    }
    if (isBoundText(el)) {
      const c = cur.get(containerIdOf(el) as string)
      if (c) {
        const w = withoutRef(c, el.id)
        if (w !== c) put(w)
      }
    }
    if (isLinear(el)) {
      for (const end of ['start', 'end'] as const) {
        const t = bindingTarget(el[BINDING_KEY[end]])
        const shape = t ? cur.get(t) : undefined
        if (shape) {
          const w = withoutRef(shape, el.id)
          if (w !== shape) put(w)
        }
      }
    }
  }
  for (const e of changed) {
    const was = prevById.get(e.id)
    if (e.isDeleted && was && !was.isDeleted) cascade(e)
  }

  // 2. Labels of shapes; their containers may grow
  const arrowLabelsDirty = new Set<string>()
  const laidOut = new Set<string>()
  const relayout = (container: SceneElement, label: TextElement) => {
    laidOut.add(container.id)
    const r = layoutLabel(container, label)
    if (r.container !== container) put(r.container)
    if (r.label !== label) put(r.label)
  }
  for (const e of changed) {
    const el = live(e.id)
    if (!el) continue
    if (isBoundText(el)) {
      const c = live(containerIdOf(el) as string)
      if (!c) continue
      if (isLinear(c)) arrowLabelsDirty.add(c.id)
      else if (!laidOut.has(c.id)) relayout(c, el as TextElement)
    } else if (!isLinear(el) && getBoundRefs(el).length) {
      const label = labelOf(el, cur)
      if (label && !laidOut.has(el.id)) relayout(el, label)
    }
  }

  // 3. Bound arrow ends follow shapes whose geometry changed, and arrows whose geometry changed
  const arrows = new Set<string>()
  for (const id of cleared) if (live(id)) arrows.add(id)
  const shapesToCheck = new Set<string>([...changed.map((e) => e.id), ...laidOut])
  for (const id of shapesToCheck) {
    const el = live(id)
    if (!el) continue
    if (isLinear(el)) {
      const was = prevById.get(id)
      if (el.type === 'arrow' && arrowNeedsRecompute(was, el, live)) arrows.add(id)
      else if (was && JSON.stringify(was.roundness) !== JSON.stringify(el.roundness)) arrowLabelsDirty.add(id)
    } else if (geometryChanged(prevById.get(id), el)) {
      for (const r of getBoundRefs(el)) if (r.type === 'arrow' && live(r.id)) arrows.add(r.id)
    }
  }
  for (const id of arrows) {
    const a = live(id)
    if (!a || !isLinear(a)) continue
    const r = recomputeArrow(a, live, placingEnd(prevById.get(id), a))
    if (r !== a) {
      put(r)
      for (const end of ['start', 'end'] as const) {
        const was = bindingTarget(a[BINDING_KEY[end]])
        if (was && bindingTarget(r[BINDING_KEY[end]]) === null && bindingTarget(r[BINDING_KEY[end === 'start' ? 'end' : 'start']]) !== was) {
          const sh = cur.get(was)
          if (sh) put(withoutRef(sh, id))
        }
      }
    }
    arrowLabelsDirty.add(id)
  }

  // 4. Arrow labels
  for (const id of arrowLabelsDirty) {
    const a = live(id)
    const label = a ? labelOf(a, cur) : undefined
    if (!a || !label) continue
    const r = layoutLabel(a, label)
    if (r.label !== label) put(r.label)
  }

  const out = next.map((e) => cur.get(e.id) ?? e)
  return out.every((e, i) => e === next[i]) ? next : out
}

/**
 * Makes relations consistent after loading: dangling bindings and boundElements entries are dropped
 * silently and missing back-references are restored. Unknown entries and element types stay.
 */
export function sanitizeRelations(elements: readonly SceneElement[]): SceneElement[] {
  const liveIds = new Set(elements.filter((e) => !e.isDeleted).map((e) => e.id))

  // Phase 1: arrow bindings and text containers must point to live elements
  const phase1 = elements.map((el) => {
    if (el.isDeleted) return el
    if (isLinear(el)) {
      const patch: Record<string, unknown> = {}
      for (const end of ['start', 'end'] as const) {
        const key = BINDING_KEY[end]
        const t = bindingTarget(el[key])
        if (t !== null && !liveIds.has(t)) patch[key] = null
      }
      return Object.keys(patch).length ? updateElement(el, patch as Partial<LinearElement>) : el
    }
    if (isBoundText(el) && !liveIds.has(containerIdOf(el) as string)) {
      return updateElement(el as unknown as TextElement, { containerId: null }) as SceneElement
    }
    return el
  })

  // Phase 2: boundElements follows the truth held by texts and arrows
  const texts = new Map<string, string[]>()
  const arrowsTo = new Map<string, string[]>()
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v])
  for (const el of phase1) {
    if (el.isDeleted) continue
    if (isBoundText(el)) push(texts, containerIdOf(el) as string, el.id)
    if (isLinear(el)) {
      const targets = new Set([bindingTarget(el.startBinding), bindingTarget(el.endBinding)])
      for (const t of targets) if (t) push(arrowsTo, t, el.id)
    }
  }
  const fixed = phase1.map((el) => {
    if (el.isDeleted) return el
    const wantText = texts.get(el.id) ?? []
    const wantArrow = arrowsTo.get(el.id) ?? []
    const existing: unknown[] = Array.isArray(el.boundElements) ? el.boundElements : []
    const kept: unknown[] = []
    const seen = new Set<string>()
    for (const r of existing) {
      if (!isObject(r) || typeof r.id !== 'string' || typeof r.type !== 'string') {
        kept.push(r)
        continue
      }
      const key = `${r.type}:${r.id}`
      if (seen.has(key)) continue
      let ok: boolean
      if (r.type === 'text') ok = wantText.includes(r.id)
      else if (r.type === 'arrow') ok = wantArrow.includes(r.id)
      else ok = liveIds.has(r.id)
      if (ok) {
        kept.push(r)
        seen.add(key)
      }
    }
    for (const id of wantText) if (!seen.has(`text:${id}`)) kept.push({ type: 'text', id })
    for (const id of wantArrow) if (!seen.has(`arrow:${id}`)) kept.push({ type: 'arrow', id })
    const same = kept.length === existing.length && kept.every((r, i) => r === existing[i])
    if (same) return el
    return updateElement(el, { boundElements: kept.length ? kept : null })
  })
  return labelsAfterContainers(fixed)
}

/** Moves labels that precede their container to directly after it, so they are not drawn underneath. */
function labelsAfterContainers(elements: SceneElement[]): SceneElement[] {
  const index = new Map(elements.map((e, i) => [e.id, i]))
  const early = new Map<string, SceneElement[]>()
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i]
    if (e.isDeleted || !isBoundText(e)) continue
    const c = index.get(containerIdOf(e) as string)
    if (c !== undefined && c > i) early.set(elements[c].id, [...(early.get(elements[c].id) ?? []), e])
  }
  if (early.size === 0) return elements
  const moving = new Set([...early.values()].flat().map((e) => e.id))
  const out: SceneElement[] = []
  for (const e of elements) {
    if (moving.has(e.id)) continue
    out.push(e)
    const l = early.get(e.id)
    if (l) out.push(...l)
  }
  return out
}
