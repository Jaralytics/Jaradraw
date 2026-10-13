import { useStore, getSelectedElements } from '../scene/store'
import type { DrawTool } from '../scene/store'
import { clampZoom, screenToScene, zoomViewportAt } from '../scene/viewport'
import { setLastPointerScene } from '../scene/pointer'
import { createLinear, createShape, updateElement } from '../element/factory'
import { anchorArrowPreview, clickEndsArrow, findBindTarget, pointInsideElement } from '../element/bind'
import { bindingTarget, expandWithLabels, rerouteElbowArrow } from '../element/relations'
import { layoutLabel } from '../element/label'
import { dedupePoints } from '../element/points'
import { pinElbow } from '../element/elbowWaypoints'
import { closestOnPolyline, dragElbow, editPolyline, elbowNodes } from '../element/elbowEdit'
import type { EditEnds, ElbowTarget } from '../element/elbowEdit'
import { MIN_CROP_PX, dragCropHandle, fullCrop, moveCropWindow, parseCrop, pointInCropWindow } from '../element/crop'
import { getBoxCenter, getElementBounds, getElementBox, rotatePoint, withAbsolutePoints } from '../element/geometry'
import { createFreedraw, appendFreedrawPoints, finishFreedraw } from '../element/freedraw'
import { rotateElements, rotationDelta, selectionCenter } from '../element/transform'
import { gridSettings, smartGuidesEnabled } from '../scene/serialize'
import {
  SNAP_TOLERANCE_PX,
  buildSnapIndex,
  edgeGuides,
  gridMoveDelta,
  resizeGuides,
  snapBoxToObjects,
  snapCandidateBoxes,
  snapPointToGrid,
  snapPointToObjects,
  snapResizePointer,
} from '../element/snap'
import type { SnapGuide, SnapIndex } from '../element/snap'
import { styleForNew } from '../element/style'
import { hitTestElement, hitTestScene } from '../element/hit'
import { cursorForHandle, getHandlePositions, hitGroupHandle, hitGroupRotation, hitHandle } from '../element/handles'
import type { HandleHit } from '../element/handles'
import { createFrame } from '../element/frame'
import { withFrameChildren } from '../element/frame'
import { moveElement, moveLinearPoint, resizeBox, resizeElement } from '../element/resize'
import type { Dir } from '../element/resize'
import { cloneElements } from '../element/clone'
import {
  getSelectionBounds,
  normalizeRect,
  scaleElements,
  selectableGroupId,
  selectionForClick,
  selectionInRect,
} from '../element/group'
import { containerIdOf, isBoundText, isImage, isLinear, isRenderable, isShape, isText } from '../element/types'
import type { Box, FreedrawElement, ImageCrop, LinearElement, SceneElement } from '../element/types'
import { isTypingTarget, targetOwnsKey } from './dom'
import { dispatchShortcut } from './shortcuts'
import { commitConnectedNodes, toggleCrop } from '../scene/actions'
import { DIRECTION_BY_KEY } from '../element/flowchart'

type Vec = { x: number; y: number }

/** Explicit pointer state machine: exactly one mode is active at a time. */
type Mode =
  | { kind: 'idle' }
  | { kind: 'panning'; startX: number; startY: number; scrollX: number; scrollY: number }
  | {
      kind: 'creating'
      tool: DrawTool
      origin: Vec
      originScreen: Vec
      draft: SceneElement | null
      startTarget: string | null
    }
  | { kind: 'placing'; tool: 'line' | 'arrow'; base: LinearElement; fixed: Vec[]; startTarget: string | null }
  | {
      kind: 'dragging'
      /** Id of the selected line or arrow that gets a node at the press point if the press ends as a click. */
      insertNodeAt: string | null
      originals: SceneElement[]
      sourceIds: readonly string[]
      start: Vec
      startScreen: Vec
      moved: boolean
      duplicate: boolean
      /** Ctrl/Cmd duplicate drag of a single node: link the original to the copy with an arrow. */
      connect: boolean
      collapseTo: string[] | null
      box: Box | null
    }
  | {
      kind: 'resizing'
      original: SceneElement
      handle: HandleHit
      startScreen: Vec
      /** Endpoint to unbind once the pointer passes the drag threshold. */
      pendingUnbind: 'start' | 'end' | null
      /** Interior nodes and waypoints: the pointer has passed the drag threshold. */
      dragged: boolean
    }
  | {
      kind: 'editingElbow'
      original: LinearElement
      poly: Vec[]
      target: ElbowTarget
      bound: EditEnds
      /** Scene position of the press; the drag delta is measured from it. */
      start: Vec
      startScreen: Vec
      dragged: boolean
      /** Where the dragged node ended up, to find it again once the route is rebuilt. */
      lastNode: Vec | null
    }
  | { kind: 'resizingGroup'; originals: SceneElement[]; box: Box; dir: Dir; started: boolean }
  | { kind: 'rotating'; originals: SceneElement[]; center: Vec; start: Vec; base: number; started: boolean }
  | {
      kind: 'cropping'
      /** Dragged handle, or null when the whole window slides over the image. */
      dir: Dir | null
      /** Handle position minus pointer position at the press, so the handle does not jump. */
      grab: Vec
      origin: Vec
      start: ImageCrop
    }
  | { kind: 'drawing'; draft: FreedrawElement }
  | { kind: 'erasing'; ids: Set<string>; last: Vec }
  | { kind: 'marquee'; origin: Vec; base: readonly string[] }

const HIT_TOLERANCE_PX = 6
const MIN_DRAG_PX = 4
const MOVE_THRESHOLD_PX = 3
const SNAP_MARGIN_PX = 120
// Circle matching the eraser hit radius (HIT_TOLERANCE_PX), as an inline cursor.
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="${HIT_TOLERANCE_PX}" fill="none" stroke="#fff" stroke-width="3"/><circle cx="10" cy="10" r="${HIT_TOLERANCE_PX}" fill="none" stroke="#1e1e24" stroke-width="1.25"/></svg>`,
)}") 10 10, crosshair`

export function attachInteraction(canvas: HTMLCanvasElement): () => void {
  let mode: Mode = { kind: 'idle' }
  let last: Vec = { x: 0, y: 0 }
  let activePointerId: number | null = null
  let activeButton = 0
  let gesturePrior: readonly SceneElement[] | null = null
  let pendingBind: string | null = null
  let lastInsert: { id: string; time: number; node: { selected: number | null; waypoint?: number } } | null = null
  const recordInsert = (id: string) => {
    const pe = st().pointEdit
    lastInsert = pe?.id === id ? { id, time: Date.now(), node: { selected: pe.selected, waypoint: pe.waypoint } } : null
  }
  /** True when the handle is the node the last click inserted (the first click of a double click on the body). */
  const isLastInsert = (id: string, h: HandleHit): boolean =>
    lastInsert?.id === id &&
    Date.now() - lastInsert.time < 700 &&
    (h.kind === 'waypoint' ? lastInsert.node.waypoint === h.index : h.kind === 'point' && lastInsert.node.waypoint === undefined && lastInsert.node.selected === h.index)
  let before: { selectedIds: readonly string[]; tool: ReturnType<typeof useStore.getState>['tool'] } | null = null
  const st = () => useStore.getState()

  const toScreen = (e: { clientX: number; clientY: number }): Vec => {
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const toScene = (s: Vec): Vec => screenToScene(st().viewport, s.x, s.y)
  const tolerance = () => HIT_TOLERANCE_PX / st().viewport.zoom
  const hitAt = (p: Vec) => {
    const { elements, textEditor } = st()
    return hitTestScene(elements, p.x, p.y, tolerance(), textEditor?.id)
  }

  type HandleTarget =
    | { kind: 'single'; element: SceneElement; handle: HandleHit }
    | { kind: 'group'; elements: SceneElement[]; box: Box; dir: Dir }
    | { kind: 'groupRotate'; elements: SceneElement[]; box: Box }

  function handleAt(p: Vec): HandleTarget | null {
    const sel = getSelectedElements(st())
    const zoom = st().viewport.zoom
    if (sel.some((e) => e.locked)) return null
    if (sel.length === 1) {
      const handle = hitHandle(sel[0], p.x, p.y, zoom)
      return handle ? { kind: 'single', element: sel[0], handle } : null
    }
    if (sel.length > 1) {
      const box = getSelectionBounds(sel)
      if (box && hitGroupRotation(box, p.x, p.y, zoom)) return { kind: 'groupRotate', elements: sel, box }
      const dir = box ? hitGroupHandle(box, p.x, p.y, zoom) : null
      return box && dir ? { kind: 'group', elements: sel, box, dir } : null
    }
    return null
  }

  const dirCursor = (dir: Dir) => cursorForHandle({ kind: 'box', dir })

  function updateCursor(): void {
    const s = st()
    let cursor = 'default'
    switch (mode.kind) {
      case 'panning':
        cursor = 'grabbing'
        break
      case 'dragging':
        cursor = 'move'
        break
      case 'resizing':
        cursor = cursorForHandle(mode.handle)
        break
      case 'editingElbow':
        cursor = mode.target.kind === 'node' ? 'crosshair' : 'move'
        break
      case 'resizingGroup':
        cursor = dirCursor(mode.dir)
        break
      case 'cropping':
        cursor = mode.dir ? dirCursor(mode.dir) : 'move'
        break
      case 'rotating':
        cursor = 'grabbing'
        break
      case 'erasing':
        cursor = ERASER_CURSOR
        break
      case 'drawing':
      case 'creating':
      case 'placing':
      case 'marquee':
        cursor = 'crosshair'
        break
      case 'idle':
        if (s.spaceHeld || s.tool === 'hand') cursor = 'grab'
        else if (s.tool === 'text') cursor = 'text'
        else if (s.tool === 'eraser') cursor = ERASER_CURSOR
        else if (s.tool !== 'selection') cursor = 'crosshair'
        else if (s.cropping) {
          const el = s.elements.find((x) => x.id === s.cropping?.id)
          const p = toScene(last)
          const handle = el ? hitHandle(el, p.x, p.y, s.viewport.zoom) : null
          if (handle?.kind === 'box') cursor = dirCursor(handle.dir)
          else if (el && isImage(el) && pointInCropWindow(el, p.x, p.y)) cursor = 'move'
        } else {
          const p = toScene(last)
          const target = handleAt(p)
          if (target) {
            cursor =
              target.kind === 'single'
                ? cursorForHandle(target.handle)
                : target.kind === 'groupRotate'
                  ? 'grab'
                  : dirCursor(target.dir)
          } else {
            const hit = hitAt(p)
            if (hit && !hit.locked) cursor = 'move'
          }
        }
    }
    s.setCursor(cursor)
  }

  const noBind = (e: { ctrlKey: boolean; metaKey: boolean }) => e.ctrlKey || e.metaKey

  type Mods = { ctrlKey: boolean; metaKey: boolean }
  /** Grid size to snap to, or null when the grid is off or snapping is suspended with Ctrl/Cmd. */
  function gridFor(e: Mods): number | null {
    const g = gridSettings(st().appState)
    return g.enabled && !noBind(e) ? g.size : null
  }
  const snapPoint = (p: Vec, e: Mods): Vec => {
    const g = gridFor(e)
    return g ? snapPointToGrid(p, g) : p
  }
  const objectSnapOn = (e: Mods) => smartGuidesEnabled(st().appState) && !noBind(e) && gridFor(e) === null

  /** Reference boxes of the other visible elements, indexed once per gesture. */
  let candidateCache: SnapIndex | null = null
  function snapCandidates(excludeIds: () => Iterable<string>, extra: readonly Box[] = []): SnapIndex {
    if (candidateCache) return candidateCache
    const exclude = new Set(excludeIds())
    const { elements, viewport: vp } = st()
    const a = screenToScene(vp, -SNAP_MARGIN_PX, -SNAP_MARGIN_PX)
    const b = screenToScene(vp, canvas.clientWidth + SNAP_MARGIN_PX, canvas.clientHeight + SNAP_MARGIN_PX)
    const out = [...extra, ...snapCandidateBoxes(elements, exclude, { x1: a.x, y1: a.y, x2: b.x, y2: b.y })]
    candidateCache = buildSnapIndex(out)
    return candidateCache
  }
  /**
   * Unbinds the ends of selected arrows whose shapes are not part of the transformed set, so the
   * transform is not undone by re-snapping. Returns the originals refreshed from the store.
   */
  function detachSelectedArrows(originals: SceneElement[]): SceneElement[] {
    const keep = new Set(originals.map((o) => o.id))
    const arrows = new Set(originals.filter((o) => o.type === 'arrow').map((o) => o.id))
    if (arrows.size === 0) return originals
    st().detachArrows(arrows, keep)
    const latest = new Map(st().elements.map((x) => [x.id, x]))
    return originals.map((o) => latest.get(o.id) ?? o)
  }

  const snapTolerance = () => SNAP_TOLERANCE_PX / st().viewport.zoom

  /** Grid snap, else object snap, of a resize pointer; `idx` is set when guides can be drawn for the result. */
  function snapResize(
    p: Vec,
    dir: Dir,
    exclude: () => Iterable<string>,
    e: Mods,
    objects: boolean,
    lockBox: Box | null,
  ): { p: Vec; idx: SnapIndex | null } {
    const g = gridFor(e)
    st().setSnapGuides([])
    if (g) return { p: snapPointToGrid(p, g), idx: null }
    if (objects && objectSnapOn(e)) {
      const idx = snapCandidates(exclude)
      return { p: snapResizePointer(p, dir, idx, snapTolerance(), lockBox), idx }
    }
    return { p, idx: null }
  }

  /** Grid snap, else object snap, of a creation point (`free` false when it will bind to a shape). */
  function snapCreationPoint(p: Vec, e: Mods, free: boolean): Vec {
    const g = gridFor(e)
    if (g) return snapPointToGrid(p, g)
    if (free && objectSnapOn(e)) {
      return snapPointToObjects(p, snapCandidates(() => []), snapTolerance()).point
    }
    return p
  }

  function targetAt(p: Vec, e: { ctrlKey: boolean; metaKey: boolean }, otherEnd?: Vec): string | null {
    if (noBind(e)) return null
    return findBindTarget(st().elements, p.x, p.y, undefined, otherEnd)?.id ?? null
  }

  /** The start target is dropped when its shape also holds the end point (no arrow inside one shape). */
  function startFor(startTarget: string | null, endPoint: Vec, endTarget: string | null): string | null {
    if (!startTarget || startTarget === endTarget) return null
    const sh = st().elements.find((x) => x.id === startTarget)
    return sh && pointInsideElement(sh, endPoint.x, endPoint.y) ? null : startTarget
  }

  /** Orthogonal preview of an elbow arrow whose ends may snap to the given shapes; other elements pass through. */
  function routePreview(arrow: LinearElement, override: { start?: string | null; end?: string | null }): LinearElement {
    if (arrow.elbowed !== true) return arrow
    return rerouteElbowArrow(arrow, (id) => st().elements.find((x) => x.id === id), override)
  }

  /** Preview of an arrow: elbow arrows are routed, the others get their anchored ends on the shape outlines. */
  function arrowPreview(arrow: LinearElement, startTarget: string | null, p: Vec, endTarget: string | null): LinearElement {
    const start = startFor(startTarget, p, endTarget)
    if (arrow.elbowed === true) return routePreview(arrow, { start, end: endTarget })
    const shape = (id: string | null) => (id ? st().elements.find((x) => x.id === id) : undefined)
    return anchorArrowPreview(arrow, shape(start), shape(endTarget))
  }

  function endMode(): void {
    mode = { kind: 'idle' }
    activePointerId = null
    gesturePrior = null
    pendingBind = null
    st().setGestureActive(false)
    st().setBindHighlight(null)
    st().setSnapGuides([])
    candidateCache = null
  }

  function placingDraft(m: Extract<Mode, { kind: 'placing' }>, floating: Vec | null): LinearElement {
    const pts = floating ? [...m.fixed, floating] : m.fixed
    return withAbsolutePoints(m.base, pts.map((v) => [v.x, v.y] as const))
  }

  function finishPlacing(e?: { ctrlKey: boolean; metaKey: boolean }): void {
    if (mode.kind !== 'placing') return
    const m = mode
    const state = st()
    mode = { kind: 'idle' }
    state.setBindHighlight(null)
    if (m.fixed.length < 2) {
      state.setDraft(null)
      return
    }
    const el = dedupePoints(placingDraft(m, null))
    if (el.points.length < 2) {
      state.setDraft(null)
      return
    }
    const last = m.fixed[m.fixed.length - 1]
    const end = m.tool === 'arrow' ? targetAt(last, e ?? { ctrlKey: false, metaKey: false }, m.fixed[0]) : null
    state.commitDraft(el, { start: m.tool === 'arrow' ? startFor(m.startTarget, last, end) : null, end })
    updateCursor()
  }

  function creationPatch(tool: DrawTool, origin: Vec, p: Vec): Partial<SceneElement> {
    const dx = p.x - origin.x
    const dy = p.y - origin.y
    if (tool === 'line' || tool === 'arrow') {
      return {
        points: [
          [0, 0],
          [dx, dy],
        ],
        width: Math.abs(dx),
        height: Math.abs(dy),
      } as Partial<LinearElement>
    }
    return {
      x: Math.min(origin.x, p.x),
      y: Math.min(origin.y, p.y),
      width: Math.abs(dx),
      height: Math.abs(dy),
    }
  }

  /** Which ends of an arrow sit on a live shape. */
  function boundEnds(arrow: LinearElement): EditEnds {
    const on = (b: unknown) => {
      const id = bindingTarget(b)
      const el = id ? st().elements.find((x) => x.id === id) : undefined
      return !!el && !el.isDeleted
    }
    return { start: on(arrow.startBinding), end: on(arrow.endBinding) }
  }

  function startSelectionGesture(e: PointerEvent, p: Vec, s: Vec): void {
    const state = st()
    const target = handleAt(p)
    const pe = state.pointEdit
    if (target?.kind === 'single' && !isLastInsert(target.element.id, target.handle)) lastInsert = null
    if (pe && !(target?.kind === 'single' && target.element.id === pe.id)) state.setPointEdit(null)
    if (target?.kind === 'single' && target.handle.kind === 'rotate') {
      const el = target.element
      const box = getElementBox(el)
      mode = {
        kind: 'rotating',
        originals: withFrameChildren(st().elements, [el]),
        center: getBoxCenter(box),
        start: p,
        base: isLinear(el) ? 0 : el.angle,
        started: false,
      }
      return
    }
    if (target?.kind === 'groupRotate') {
      const originals = withFrameChildren(st().elements, target.elements.filter((x) => !isBoundText(x)))
      const center = selectionCenter(originals)
      if (center) mode = { kind: 'rotating', originals, center, start: p, base: 0, started: false }
      return
    }
    if (target?.kind === 'single') {
      const el = target.element
      const handle = target.handle
      let pendingUnbind: 'start' | 'end' | null = null
      if (handle.kind === 'waypoint' && isLinear(el)) {
        state.setPointEdit({ id: el.id, selected: null, waypoint: handle.index })
        const poly = editPolyline(el)
        mode = { kind: 'editingElbow', original: el, poly, target: { kind: 'node', index: handle.index }, bound: boundEnds(el), start: p, startScreen: s, dragged: false, lastNode: poly[handle.index + 1] ?? null }
        return
      }
      if (handle.kind === 'point' && isLinear(el)) {
        const lastIdx = el.points.length - 1
        // only interior nodes become the active node (the one Supr deletes); elbow arrows have waypoints instead
        if (el.elbowed === true) state.setPointEdit(null)
        else state.setPointEdit({ id: el.id, selected: handle.index === 0 || handle.index === lastIdx ? null : handle.index })
        if (el.type === 'arrow') {
          if (handle.index === 0) pendingUnbind = 'start'
          else if (handle.index === lastIdx) pendingUnbind = 'end'
        }
      }
      mode = { kind: 'resizing', original: el, handle, startScreen: s, pendingUnbind, dragged: false }
      return
    }
    if (target?.kind === 'group') {
      // labels ride along so their font size scales once, through the container
      const originals = expandWithLabels(st().elements, target.elements)
      mode = { kind: 'resizingGroup', originals, box: target.box, dir: target.dir, started: false }
      return
    }

    const hit = hitAt(p)
    if (hit) {
      const unit = selectionForClick(state.elements, hit.id, state.editingGroupId)
      const cur = state.selectedIds
      const selected = unit.every((id) => cur.includes(id))
      if (e.shiftKey) {
        if (selected) {
          state.setSelection(cur.filter((id) => !unit.includes(id)))
          return
        }
        if (hit.locked || getSelectedElements(st()).some((x) => x.locked)) return
        state.setSelection([...cur, ...unit.filter((id) => !cur.includes(id))])
      } else if (!selected) {
        state.setSelection(unit)
      }
      const ids = st().selectedIds
      const sel = getSelectedElements(st())
      // locked elements can be selected but never moved
      if (sel.some((x) => x.locked)) return
      // a plain click on the body of the already-selected line or arrow adds a node there
      const addNode =
        selected && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && cur.length === 1 && unit.length === 1 && isLinear(hit)
      if (addNode && isLinear(hit) && hit.elbowed === true) {
        // a segment of the selected elbow arrow moves on its own; a plain click on it adds a node
        const poly = editPolyline(hit)
        const seg = closestOnPolyline(poly, p).segment
        mode = { kind: 'editingElbow', original: hit, poly, target: { kind: 'segment', index: seg }, bound: boundEnds(hit), start: p, startScreen: s, dragged: false, lastNode: null }
        return
      }
      mode = {
        insertNodeAt: addNode ? hit.id : null,
        kind: 'dragging',
        originals: withFrameChildren(st().elements, sel),
        sourceIds: ids,
        start: p,
        startScreen: s,
        moved: false,
        duplicate: e.altKey || e.ctrlKey || e.metaKey,
        connect: (e.ctrlKey || e.metaKey) && !e.altKey,
        collapseTo: !e.shiftKey && selected && ids.length > unit.length ? unit : null,
        box: null,
      }
      return
    }

    const base = e.shiftKey ? state.selectedIds : []
    if (!e.shiftKey) state.setSelection([])
    mode = { kind: 'marquee', origin: p, base }
  }

  /** Crop mode press: starts a handle or window drag. Returns false when the press is outside the image (the crop is applied). */
  function startCropGesture(e: PointerEvent, p: Vec): boolean {
    const session = st().cropping
    const el = session ? st().elements.find((x) => x.id === session.id) : undefined
    if (!session || !el || !isImage(el)) {
      st().applyCrop()
      return false
    }
    const start = parseCrop(el.crop) ?? fullCrop(session.frame)
    const handle = hitHandle(el, p.x, p.y, st().viewport.zoom)
    let dir: Dir | null = null
    let grab: Vec = { x: 0, y: 0 }
    if (handle?.kind === 'box') {
      dir = handle.dir
      const pos = getHandlePositions(el, st().viewport.zoom).find((h) => h.handle.kind === 'box' && h.handle.dir === dir)
      if (pos) grab = { x: pos.x - p.x, y: pos.y - p.y }
    } else if (!pointInCropWindow(el, p.x, p.y)) {
      const f = session.frame
      const q = rotatePoint(p.x, p.y, f.center.x, f.center.y, -f.angle)
      if (Math.abs(q.x - f.center.x) <= f.width / 2 && Math.abs(q.y - f.center.y) <= f.height / 2) return true
      st().applyCrop()
      return false
    }
    canvas.setPointerCapture(e.pointerId)
    st().setGestureActive(true)
    mode = { kind: 'cropping', dir, grab, origin: p, start }
    updateCursor()
    return true
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button === 2) return
    if (mode.kind === 'idle') before = { selectedIds: st().selectedIds, tool: st().tool }
    const s = toScreen(e)
    last = s
    st().flushPending()
    if (st().textEditor) {
      st().commitTextEditor()
      return
    }
    if (mode.kind === 'placing') {
      if (e.button !== 0) return
      const p = snapPoint(toScene(s), e)
      const lastFixed = mode.fixed[mode.fixed.length - 1]
      if (Math.hypot(p.x - lastFixed.x, p.y - lastFixed.y) * st().viewport.zoom < 3) return
      const next = { ...mode, fixed: [...mode.fixed, p] }
      const target = mode.tool === 'arrow' ? targetAt(p, e, mode.fixed[0]) : null
      const before = mode.fixed.length
      mode = next
      // an elbow arrow always has exactly two points: the second click finishes it
      const endsOnShape = clickEndsArrow({
        tool: next.tool,
        elbowed: next.base.elbowed === true,
        target,
        startTarget: next.startTarget,
        fixedCount: before,
        noBind: noBind(e),
      })
      if (next.base.elbowed === true || endsOnShape) {
        finishPlacing(e)
        return
      }
      st().setDraft(placingDraft(next, p))
      return
    }
    if (mode.kind !== 'idle') return
    activePointerId = e.pointerId
    activeButton = e.button
    let state = st()
    const vp = state.viewport

    if (e.button === 1 || state.spaceHeld || state.tool === 'hand') {
      e.preventDefault()
      canvas.setPointerCapture(e.pointerId)
      mode = { kind: 'panning', startX: s.x, startY: s.y, scrollX: vp.scrollX, scrollY: vp.scrollY }
      updateCursor()
      return
    }
    if (e.button !== 0) return

    if (state.cropping && state.tool === 'selection') {
      if (startCropGesture(e, toScene(s))) return
      // a press outside the image applied the crop and goes on as a normal press
      state = st()
    }

    const p = toScene(s)
    canvas.setPointerCapture(e.pointerId)

    state.setGestureActive(true)
    gesturePrior = state.elements

    if (state.tool === 'selection') {
      startSelectionGesture(e, p, s)
      updateCursor()
      return
    }

    if (state.tool === 'freedraw') {
      const pen = e.pointerType === 'pen' ? { pressure: e.pressure || 0.5 } : null
      const draft = createFreedraw(p.x, p.y, styleForNew(state.defaults, 'freedraw'), pen)
      mode = { kind: 'drawing', draft }
      state.setSelection([])
      state.setDraft(draft)
      updateCursor()
      return
    }
    if (state.tool === 'eraser') {
      mode = { kind: 'erasing', ids: new Set(), last: p }
      eraseAt(mode, p)
      updateCursor()
      return
    }

    if (state.tool === 'image') {
      const pending = state.pendingImages
      if (pending) state.insertImages(pending, p.x, p.y)
      endMode()
      updateCursor()
      return
    }

    const startTarget = state.tool === 'arrow' ? targetAt(p, e) : null
    const sp = snapCreationPoint(p, e, startTarget === null)
    if (objectSnapOn(e)) state.setSnapGuides(edgeGuides({ x: sp.x, y: sp.y, width: 0, height: 0 }, snapCandidates(() => [])))
    if (state.tool === 'text') {
      mode = { kind: 'creating', tool: 'text', origin: sp, originScreen: s, draft: null, startTarget: null }
      return
    }

    const tool = state.tool as Exclude<DrawTool, 'text'>
    const style = styleForNew(state.defaults, tool)
    const draft =
      tool === 'line' || tool === 'arrow'
        ? createLinear(tool, sp.x, sp.y, style)
        : tool === 'frame'
          ? createFrame(sp.x, sp.y)
          : createShape(tool, sp.x, sp.y, style)
    mode = { kind: 'creating', tool, origin: sp, originScreen: s, draft, startTarget }
    state.setBindHighlight(null, startTarget)
    state.setSelection([])
    updateCursor()
  }

  function onPointerMove(e: PointerEvent): void {
    const s = toScreen(e)
    last = s
    const state = st()
    setLastPointerScene(toScene(s))
    if (mode.kind === 'placing') {
      const p = snapPoint(toScene(s), e)
      const endTarget = mode.tool === 'arrow' ? targetAt(p, e, mode.fixed[0]) : null
      state.setDraft(arrowPreview(placingDraft(mode, p), mode.startTarget, p, endTarget))
      state.setBindHighlight(endTarget, mode.startTarget)
      return
    }
    if (mode.kind !== 'idle' && e.pointerId !== activePointerId) return
    switch (mode.kind) {
      case 'panning': {
        const z = state.viewport.zoom
        state.setViewport({
          ...state.viewport,
          scrollX: mode.scrollX + (s.x - mode.startX) / z,
          scrollY: mode.scrollY + (s.y - mode.startY) / z,
        })
        break
      }
      case 'creating': {
        if (!mode.draft) break
        const raw = toScene(s)
        const arrow = mode.tool === 'arrow'
        const p = snapCreationPoint(raw, e, !arrow || targetAt(raw, e, mode.origin) === null)
        const next = updateElement(mode.draft, creationPatch(mode.tool, mode.origin, p))
        mode = { ...mode, draft: next }
        const endTarget = arrow ? targetAt(p, e, mode.origin) : null
        const linearDraft = isLinear(next) ? arrowPreview(next, mode.startTarget, p, endTarget) : next
        state.setDraft(linearDraft)
        state.setBindHighlight(endTarget, mode.startTarget)
        state.setSnapGuides(
          objectSnapOn(e)
            ? edgeGuides(
                {
                  x: Math.min(mode.origin.x, p.x),
                  y: Math.min(mode.origin.y, p.y),
                  width: Math.abs(p.x - mode.origin.x),
                  height: Math.abs(p.y - mode.origin.y),
                },
                snapCandidates(() => []),
              )
            : [],
        )
        break
      }
      case 'dragging': {
        if (!mode.moved) {
          if (Math.hypot(s.x - mode.startScreen.x, s.y - mode.startScreen.y) < MOVE_THRESHOLD_PX) break
          let originals = mode.originals
          if (mode.duplicate) {
            // the copies start on top of the originals so they stay under the cursor
            originals = cloneElements(expandWithLabels(state.elements, originals), 0, 0)
            state.insertElements(originals)
            state.setSelection(originals.filter((o) => !isBoundText(o)).map((o) => o.id))
          } else {
            const keep = new Set(originals.map((o) => o.id))
            const arrows = new Set(originals.filter((o) => o.type === 'arrow').map((o) => o.id))
            if (arrows.size) {
              state.detachArrows(arrows, keep)
              const latest = new Map(st().elements.map((x) => [x.id, x]))
              originals = originals.map((o) => latest.get(o.id) ?? o)
            }
          }
          mode = { ...mode, originals, moved: true, box: getSelectionBounds(originals.filter((o) => !isBoundText(o))) }
        }
        const p = toScene(s)
        let dx = p.x - mode.start.x
        let dy = p.y - mode.start.y
        let guides: SnapGuide[] = []
        const box = mode.box
        if (box) {
          // Ctrl/Cmd starts a duplicate drag, so there it must not also suspend snapping
          const mods = mode.duplicate ? { ctrlKey: false, metaKey: false } : e
          const g = gridFor(mods)
          if (g) {
            const d = gridMoveDelta({ ...box, x: box.x + dx, y: box.y + dy }, g)
            dx += d.x
            dy += d.y
          } else if (objectSnapOn(mods)) {
            const moving = mode.originals
            const r = snapBoxToObjects(
              { ...box, x: box.x + dx, y: box.y + dy },
              snapCandidates(() => moving.map((o) => o.id)),
              snapTolerance(),
            )
            dx += r.dx
            dy += r.dy
            guides = r.guides
          }
        }
        state.setSnapGuides(guides)
        state.replaceElements(mode.originals.map((o) => moveElement(o, dx, dy)))
        break
      }
      case 'resizing': {
        const raw = toScene(s)
        let p = snapPoint(raw, e)
        if (mode.pendingUnbind) {
          if (Math.hypot(s.x - mode.startScreen.x, s.y - mode.startScreen.y) < MOVE_THRESHOLD_PX) break
          const origId = mode.original.id
          state.unbindEnd(origId, mode.pendingUnbind)
          const fresh = st().elements.find((x) => x.id === origId)
          mode = { ...mode, original: fresh ?? mode.original, pendingUnbind: null }
        }
        const { original, handle } = mode
        const interior = handle.kind === 'point' && isLinear(original) && original.elbowed !== true && handle.index > 0 && handle.index < original.points.length - 1
        // a press on an interior node only drags once it passes the threshold, so a click never moves it
        if (interior && !mode.dragged) {
          if (Math.hypot(s.x - mode.startScreen.x, s.y - mode.startScreen.y) < MOVE_THRESHOLD_PX) break
          mode = { ...mode, dragged: true }
        }
        if (handle.kind === 'point' && isLinear(original)) {
          const endpoint = handle.index === 0 || handle.index === original.points.length - 1
          const otherEnd = original.points[handle.index === 0 ? original.points.length - 1 : 0]
          const otherAbs = { x: original.x + otherEnd[0], y: original.y + otherEnd[1] }
          let guides: SnapGuide[] = []
          if (original.angle === 0 && objectSnapOn(e) && !(original.type === 'arrow' && endpoint && targetAt(raw, e, otherAbs))) {
            const own = original.points
              .filter((_, i) => i !== handle.index)
              .map(([px, py]) => ({ x: original.x + px, y: original.y + py, width: 0, height: 0 }))
            const idx = snapCandidates(() => [original.id], own)
            p = snapPointToObjects(raw, idx, snapTolerance()).point
            guides = edgeGuides({ x: p.x, y: p.y, width: 0, height: 0 }, idx)
          }
          state.setSnapGuides(guides)
          const bindTarget = original.type === 'arrow' && endpoint ? targetAt(p, e, otherAbs) : null
          state.replaceElements([moveLinearPoint(original, handle.index, p.x, p.y)])
          if (original.type === 'arrow' && endpoint) {
            pendingBind = bindTarget
            state.setBindHighlight(pendingBind)
          }
          if (original.elbowed === true && endpoint) {
            // reconcile leaves the dragged end free; the preview already shows the side it will bind to
            const cur = st().elements.find((x) => x.id === original.id)
            // bindArrowEnd refuses both ends on one shape, so the preview leaves that end free as release does
            const target = cur && isLinear(cur) && bindTarget === bindingTarget(handle.index === 0 ? cur.endBinding : cur.startBinding) ? null : bindTarget
            const routed = cur && isLinear(cur) ? routePreview(cur, handle.index === 0 ? { start: target } : { end: target }) : null
            if (routed && routed !== cur) {
              // the bound label follows the preview in the same raw write
              const label = st().elements.find((x) => !x.isDeleted && isText(x) && x.containerId === routed.id)
              const laid = label && isText(label) ? layoutLabel(routed, label).label : null
              state.restoreElements(st().elements.map((x) => (x.id === routed.id ? routed : laid && x.id === laid.id ? laid : x)))
            }
          }
        } else if (handle.kind === 'box') {
          const lock = isText(original) || (isImage(original) && !e.shiftKey) ? getElementBox(original) : null
          const sn = snapResize(raw, handle.dir, () => [original.id], e, original.angle === 0, lock)
          const next = resizeElement(original, handle.dir, sn.p.x, sn.p.y, e.shiftKey)
          state.replaceElements([next])
          if (sn.idx) {
            const [x1, y1, x2, y2] = getElementBounds(next)
            state.setSnapGuides(resizeGuides({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, handle.dir, sn.idx))
          }
        }
        break
      }
      case 'editingElbow': {
        if (!mode.dragged) {
          if (Math.hypot(s.x - mode.startScreen.x, s.y - mode.startScreen.y) < MOVE_THRESHOLD_PX) break
          mode = { ...mode, dragged: true }
        }
        const raw = toScene(s)
        const delta = { x: raw.x - mode.start.x, y: raw.y - mode.start.y }
        const poly = dragElbow(mode.poly, mode.target, delta, mode.bound, (v) => snapPoint(v, e))
        const routed = pinElbow(mode.original, poly, (id) => st().elements.find((x) => x.id === id))
        state.replaceElements([routed])
        if (mode.target.kind === 'node') {
          const v = mode.poly[mode.target.index + 1]
          mode = { ...mode, lastNode: snapPoint({ x: v.x + delta.x, y: v.y + delta.y }, e) }
        }
        break
      }
      case 'resizingGroup': {
        if (!mode.started) mode = { ...mode, originals: detachSelectedArrows(mode.originals), started: true }
        const moving = mode.originals
        const sn = snapResize(toScene(s), mode.dir, () => moving.map((o) => o.id), e, true, mode.box)
        const { box, scale } = resizeBox(mode.box, mode.dir, sn.p.x, sn.p.y, true)
        state.replaceElements(scaleElements(mode.originals, mode.box, box, scale))
        if (sn.idx) state.setSnapGuides(resizeGuides(box, mode.dir, sn.idx))
        break
      }
      case 'rotating': {
        if (!mode.started) mode = { ...mode, originals: detachSelectedArrows(mode.originals), started: true }
        const p = toScene(s)
        const delta = rotationDelta(mode.center, mode.start, p, mode.base, e.shiftKey)
        state.replaceElements(rotateElements(mode.originals, mode.center, delta))
        break
      }
      case 'cropping': {
        const session = state.cropping
        if (!session) break
        const p = toScene(s)
        const next = mode.dir
          ? dragCropHandle(session.frame, mode.start, mode.dir, { x: p.x + mode.grab.x, y: p.y + mode.grab.y }, {
              minSize: MIN_CROP_PX / state.viewport.zoom,
              keepAspect: e.shiftKey,
            })
          : moveCropWindow(session.frame, mode.start, p.x - mode.origin.x, p.y - mode.origin.y)
        state.updateCrop(next)
        break
      }
      case 'drawing': {
        const list = e.getCoalescedEvents?.() ?? []
        const pts = (list.length ? list : [e]).map((ev) => ({ ...toScene(toScreen(ev)), pressure: ev.pressure }))
        const draft = appendFreedrawPoints(mode.draft, pts, 0.5 / state.viewport.zoom)
        if (draft !== mode.draft) {
          mode = { ...mode, draft }
          state.setDraft(draft)
        }
        break
      }
      case 'erasing':
        eraseAt(mode, toScene(s))
        break
      case 'marquee': {
        const rect = normalizeRect(mode.origin, toScene(s))
        state.setMarquee(rect)
        const base = mode.base
        const inside = selectionInRect(state.elements, rect, state.editingGroupId).map((el) => el.id)
        state.setSelection([...base, ...inside.filter((id) => !base.includes(id))])
        break
      }
      case 'idle':
        updateCursor()
    }
  }

  /** Adds the elements touched along the segment from the last erase position to `p`. */
  function eraseAt(m: Extract<Mode, { kind: 'erasing' }>, p: Vec): void {
    const { elements } = st()
    const tol = tolerance()
    const dist = Math.hypot(p.x - m.last.x, p.y - m.last.y)
    const n = Math.min(50, Math.max(1, Math.ceil(dist / Math.max(tol / 2, 0.5))))
    const before = m.ids.size
    const x1 = Math.min(m.last.x, p.x) - tol
    const x2 = Math.max(m.last.x, p.x) + tol
    const y1 = Math.min(m.last.y, p.y) - tol
    const y2 = Math.max(m.last.y, p.y) + tol
    const near = elements.filter((el) => {
      if (el.isDeleted || el.locked || !isRenderable(el)) return false
      const pad = el.strokeWidth * 2
      const [bx1, by1, bx2, by2] = getElementBounds(el)
      return bx2 + pad >= x1 && bx1 - pad <= x2 && by2 + pad >= y1 && by1 - pad <= y2
    })
    for (let i = 1; i <= n; i++) {
      const x = m.last.x + ((p.x - m.last.x) * i) / n
      const y = m.last.y + ((p.y - m.last.y) * i) / n
      for (const el of near) {
        if (!hitTestElement(el, x, y, tol)) continue
        const cid = isBoundText(el) ? (containerIdOf(el) as string) : el.id
        const container = elements.find((c) => c.id === cid)
        if (container && !container.locked && !container.isDeleted) m.ids.add(cid)
      }
    }
    m.last = p
    if (m.ids.size !== before) st().setErasing([...m.ids])
  }

  function cancelGesture(): void {
    const state = st()
    if (mode.kind === 'creating') state.setDraft(null)
    else if (mode.kind === 'drawing') state.setDraft(null)
    else if (mode.kind === 'erasing') state.setErasing([])
    else if (mode.kind === 'cropping') state.updateCrop(mode.start)
    else if (
      mode.kind === 'dragging' ||
      mode.kind === 'resizing' ||
      mode.kind === 'editingElbow' ||
      mode.kind === 'resizingGroup' ||
      mode.kind === 'rotating'
    ) {
      if (gesturePrior) state.restoreElements(gesturePrior)
      if (mode.kind === 'dragging' && mode.duplicate && mode.moved) state.setSelection(mode.sourceIds)
    } else if (mode.kind === 'marquee') state.setMarquee(null)
    endMode()
  }

  function onPointerCancel(e: PointerEvent): void {
    if (mode.kind === 'idle' || e.pointerId !== activePointerId) return
    cancelGesture()
    updateCursor()
  }

  function onPointerUp(e: PointerEvent): void {
    if (mode.kind !== 'idle' && (e.pointerId !== activePointerId || e.button !== activeButton)) return
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    const s = toScreen(e)
    const state = st()
    switch (mode.kind) {
      case 'creating': {
        const linear = mode.tool === 'line' || mode.tool === 'arrow'
        if (mode.tool === 'text') {
          state.openTextEditor({ x: mode.origin.x, y: mode.origin.y })
        } else if (mode.draft) {
          const z = state.viewport.zoom
          const big = linear
            ? Math.hypot(mode.draft.width, mode.draft.height) * z >= MIN_DRAG_PX
            : mode.draft.width * z >= MIN_DRAG_PX && mode.draft.height * z >= MIN_DRAG_PX
          if (big) {
            const endPoint = toScene(s)
            const end = linear && mode.tool === 'arrow' ? targetAt(endPoint, e, mode.origin) : null
            state.commitDraft(mode.draft, { start: startFor(mode.startTarget, endPoint, end), end })
          } else if (linear) {
            // a plain click starts a multi-point line: further clicks add points
            const m = mode
            state.setBindHighlight(null, m.startTarget)
            state.setSnapGuides([])
            candidateCache = null
            gesturePrior = null
            state.setGestureActive(false)
            activePointerId = null
            const base = mode.draft as LinearElement
            mode = {
              kind: 'placing',
              tool: m.tool as 'line' | 'arrow',
              base,
              fixed: [m.origin],
              startTarget: m.startTarget,
            }
            state.setDraft(placingDraft(mode, m.origin))
            return
          } else state.setDraft(null)
        }
        break
      }
      case 'dragging':
        if (mode.moved) {
          if (mode.connect && mode.sourceIds.length === 1) {
            const copies = mode.originals.filter((o) => !isBoundText(o))
            if (copies.length === 1) state.connectNodes(mode.sourceIds[0], copies[0].id)
          }
          state.endGesture(mode.duplicate ? 'duplicate' : 'move', gesturePrior ?? undefined)
        } else if (mode.collapseTo) state.setSelection(mode.collapseTo)
        else if (mode.insertNodeAt && state.insertNode(mode.insertNodeAt, mode.start.x, mode.start.y)) {
          recordInsert(mode.insertNodeAt)
        }
        break
      case 'resizing': {
        const m = mode
        if (m.handle.kind === 'point' && pendingBind) {
          const el = st().elements.find((x) => x.id === m.original.id)
          if (el && isLinear(el)) {
            const idx = m.handle.index
            state.bindEnds(el.id, idx === 0 ? { start: pendingBind } : { end: pendingBind })
          }
        }
        const node = (m.handle.kind === 'point' && isLinear(m.original) && m.original.elbowed !== true)
        state.endGesture(node ? 'point' : 'resize', gesturePrior ?? undefined)
        break
      }
      case 'editingElbow': {
        const m = mode
        if (m.dragged) {
          const cur = st().elements.find((x) => x.id === m.original.id)
          const last = m.lastNode
          if (m.target.kind === 'node' && last && cur && isLinear(cur)) {
            // the dragged node keeps being the active one, wherever it sits in the rebuilt route
            const nodes = elbowNodes(cur)
            let best = -1
            nodes.forEach((n, i) => {
              if (best < 0 || Math.hypot(n.x - last.x, n.y - last.y) < Math.hypot(nodes[best].x - last.x, nodes[best].y - last.y)) best = i
            })
            state.setPointEdit(best >= 0 ? { id: m.original.id, selected: null, waypoint: best } : null)
          } else state.setPointEdit(null)
          state.endGesture('point', gesturePrior ?? undefined)
        } else if (m.target.kind === 'segment' && state.insertNode(m.original.id, m.start.x, m.start.y)) {
          recordInsert(m.original.id)
        }
        break
      }
      case 'resizingGroup':
        state.endGesture('resize', gesturePrior ?? undefined)
        break
      case 'rotating':
        state.endGesture('rotate', gesturePrior ?? undefined)
        break
      case 'drawing':
        state.commitStroke(finishFreedraw(mode.draft))
        break
      case 'erasing':
        if (mode.ids.size) state.eraseElements([...mode.ids])
        else state.setErasing([])
        break
      case 'marquee':
        state.setMarquee(null)
        break
    }
    endMode()
    updateCursor()
  }

  function onDoubleClick(e: MouseEvent): void {
    if (mode.kind === 'placing') {
      finishPlacing(e)
      return
    }
    const state = st()
    if (state.tool !== 'selection' || state.textEditor || state.cropping) return
    const p = toScene(toScreen(e))
    // a double click on a node handle deletes that node (the first click already made it the active one)
    const target = handleAt(p)
    // a node the first click of this double click just inserted is not an existing one: take it back and go on
    const justInserted =
      target?.kind === 'single' && isLastInsert(target.element.id, target.handle) && state.discardNodeInsert(target.element.id)
    if (justInserted) lastInsert = null
    if (!justInserted && target?.kind === 'single' && isLinear(target.element)) {
      const h = target.handle
      const last = target.element.points.length - 1
      const edit =
        h.kind === 'waypoint'
          ? { id: target.element.id, selected: null, waypoint: h.index }
          : h.kind === 'point' && h.index > 0 && h.index < last && target.element.elbowed !== true
            ? { id: target.element.id, selected: h.index }
            : null
      if (edit) {
        state.setPointEdit(edit)
        state.deletePoint()
        lastInsert = null
        return
      }
    }
    const hit = hitAt(p)
    if (hit) {
      if (hit.locked) return
      if (hit.type === 'frame') {
        state.setSelection([hit.id])
        state.showModal({ kind: 'renameFrame', id: hit.id })
        return
      }
      const group = selectableGroupId(hit, state.editingGroupId)
      if (group) {
        state.setEditingGroup(group)
        state.setSelection(selectionForClick(state.elements, hit.id, group))
        return
      }
      if (isImage(hit)) {
        state.setSelection([hit.id])
        toggleCrop()
        return
      }
      if (isLinear(hit)) {
        // the first click of this double click may have added a node: take it back without a history entry
        if (lastInsert?.id === hit.id && Date.now() - lastInsert.time < 700) state.discardNodeInsert(hit.id)
        lastInsert = null
        if (hit.type === 'arrow') state.openLabelEditor(hit.id)
      } else if (isShape(hit)) state.openLabelEditor(hit.id)
      else if (isText(hit) && !isBoundText(hit)) state.openTextEditor({ id: hit.id, x: hit.x, y: hit.y, existing: true })
      return
    }
    const inside = [...state.elements]
      .reverse()
      .find((el) => !el.isDeleted && !el.locked && isShape(el) && pointInsideElement(el, p.x, p.y))
    if (inside) state.openLabelEditor(inside.id)
    else state.openTextEditor({ x: p.x, y: p.y })
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    const state = st()
    const vp = state.viewport
    const unit = e.deltaMode === 1 ? 20 : 1
    const dx = e.deltaX * unit
    const dy = e.deltaY * unit
    if (e.ctrlKey || e.metaKey) {
      const s = toScreen(e)
      const zoom = clampZoom(vp.zoom * Math.exp(-dy * 0.0025))
      state.setViewport(zoomViewportAt(vp, s.x, s.y, zoom))
      return
    }
    const horizontal = e.shiftKey && dx === 0
    state.setViewport({
      ...vp,
      scrollX: vp.scrollX - (horizontal ? dy : dx) / vp.zoom,
      scrollY: vp.scrollY - (horizontal ? 0 : dy) / vp.zoom,
    })
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button === 1) e.preventDefault()
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented || targetOwnsKey(e.target, e)) return
    const state = st()
    if (state.modal) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !isTypingTarget(e.target)) e.preventDefault()
      return
    }

    if (state.flowPreview) {
      if (e.key === 'Escape') {
        e.preventDefault()
        state.cancelFlowPreview()
        return
      }
      const modifierOnly = e.key === 'Control' || e.key === 'Meta' || e.key === 'Shift' || e.key === 'Alt'
      const flowArrow = DIRECTION_BY_KEY[e.key.toLowerCase()] && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey
      if (!modifierOnly && !flowArrow) state.cancelFlowPreview()
    }

    if (state.cropping && mode.kind === 'idle' && (e.key === 'Enter' || e.key === 'Escape')) {
      e.preventDefault()
      if (e.key === 'Enter') state.applyCrop()
      else state.cancelCrop()
      updateCursor()
      return
    }

    if (e.code === 'Space') {
      e.preventDefault()
      state.setSpaceHeld(true)
      return
    }

    if (mode.kind === 'placing' && (e.key === 'Escape' || e.key === 'Enter')) {
      e.preventDefault()
      finishPlacing(e)
      return
    }

    if (e.key === 'Escape') {
      if (mode.kind === 'idle' && (state.pointEdit?.selected != null || state.pointEdit?.waypoint !== undefined)) {
        state.setPointEdit(null)
        return
      }
      if (mode.kind === 'idle' && state.editingGroupId) {
        const first = getSelectedElements(state)[0]
        state.setEditingGroup(null)
        state.setSelection(first ? selectionForClick(state.elements, first.id, null) : [])
        return
      }
      if (mode.kind !== 'idle') {
        const prior = before
        cancelGesture()
        if (prior) {
          if (st().tool !== prior.tool) st().setTool(prior.tool)
          st().setSelection(prior.selectedIds)
        }
        updateCursor()
        return
      }
      cancelGesture()
      state.setSelection([])
      if (state.tool !== 'selection') state.setTool('selection')
      updateCursor()
      return
    }

    if (mode.kind === 'idle') dispatchShortcut(e)
  }

  function onKeyUp(e: KeyboardEvent): void {
    if ((e.key === 'Control' || e.key === 'Meta') && st().flowPreview) commitConnectedNodes()
    if (e.code === 'Space') {
      if (!st().modal && !targetOwnsKey(e.target, e)) e.preventDefault()
      st().setSpaceHeld(false)
    }
  }

  const onBlur = () => {
    st().setSpaceHeld(false)
    st().cancelFlowPreview()
  }
  const onPointerAnywhere = () => st().cancelFlowPreview()
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') st().cancelFlowPreview()
  }
  const onWindowWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) e.preventDefault()
  }

  const unsubscribe = useStore.subscribe(() => {
    const crop = st().cropping
    if (crop && (st().tool !== 'selection' || st().selectedIds.length !== 1 || st().selectedIds[0] !== crop.id)) {
      if (mode.kind === 'cropping') endMode()
      st().applyCrop()
    }
    if (mode.kind === 'placing' && st().tool !== mode.tool) {
      mode = { kind: 'idle' }
      st().setDraft(null)
      st().setBindHighlight(null)
    }
    if (mode.kind === 'idle') updateCursor()
  })

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('dblclick', onDoubleClick)
  canvas.addEventListener('mousedown', onMouseDown)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('pointerdown', onPointerAnywhere, true)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('wheel', onWindowWheel, { passive: false })

  return () => {
    unsubscribe()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerCancel)
    canvas.removeEventListener('dblclick', onDoubleClick)
    canvas.removeEventListener('mousedown', onMouseDown)
    canvas.removeEventListener('wheel', onWheel)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('pointerdown', onPointerAnywhere, true)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('wheel', onWindowWheel)
  }
}


