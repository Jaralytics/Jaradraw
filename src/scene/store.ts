import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { Box, ImageCrop, ImageElement, SceneElement } from '../element/types'
import { getCommonBounds } from '../element/geometry'
import { containerIdOf, isBoundText, isImage, isLabelable, isLinear, isRenderable, isText } from '../element/types'
import type { LinearElement } from '../element/types'
import { createText, updateElement } from '../element/factory'
import { reorderSlides, slideFrames, withSlideDuration } from './slides'
import { animationOf, canAnimate, customDataWithAnimation } from '../render/animation'
import type { AnimationKind } from '../render/animation'
import { cloneCentered } from '../element/clone'
import { assignFrames, releaseFrameChildren, withFrameChildren } from '../element/frame'
import { createImageElement, hasDataURL, sanitizeFiles } from '../element/image'
import { cropFrame, elementAtCrop, parseCrop, resetCrop, sameCrop } from '../element/crop'
import type { CropFrame } from '../element/crop'
import { createLibraryItem } from '../element/library'
import type { LibraryItem } from '../element/library'
import { isDark, loadThemePref, saveThemePref } from './theme'
import type { ThemePref } from './theme'
import { screenToScene } from './viewport'
import { moveElement } from '../element/resize'
import { measureText } from '../element/text'
import { createLabel, innerWidth, labelCenter } from '../element/label'
import {
  attachLabel,
  bindArrowEnd,
  detachArrows as detachArrowEnds,
  expandWithLabels,
  getLabel,
  reconcile,
  rerouteElbowArrow,
  unbindArrowEnd,
} from '../element/relations'
import { insertNodeAt, removePoint } from '../element/points'
import { deleteElbowNode, insertElbowNode } from '../element/elbowWaypoints'
import { sameContent } from '../element/equal'
import { reorderElements } from '../element/zorder'
import { MAX_FLOW_COUNT, connectNodes, convertNodeTypes, isNode, nearestConnected, planConnectedNodes, revealBox } from '../element/flowchart'
import type { Direction, FlowPlan } from '../element/flowchart'
import { expandToWholeGroups, groupElements, selectionUnits, ungroupElements } from '../element/group'
import { alignUnits, distributeUnits } from '../element/align'
import type { AlignKind, DistributeAxis } from '../element/align'
import { flipElements } from '../element/transform'
import type { FlipAxis } from '../element/transform'
import type { SnapGuide } from '../element/snap'
import { reflowText } from '../element/style'
import type { ZOrderOp } from '../element/zorder'
import { applyStyleToElement, DEFAULT_STYLE_DEFAULTS } from '../element/style'
import type { StyleDefaults, StylePatch } from '../element/style'
import { DEFAULT_VIEWPORT, clampZoom } from './viewport'
import type { Viewport } from './viewport'
import { selectionAfterRestore } from './history'
import { DEFAULT_APP_STATE, gridSettings, smartGuidesEnabled, withGrid } from './serialize'
import type { AppStateFile } from './serialize'
import {
  canRedo,
  canUndo,
  createHistory,
  currentEntry,
  pushHistory,
  redoHistory,
  replaceCurrent,
  undoHistory,
} from './history'
import type { History } from './history'

export type Tool =
  | 'selection'
  | 'hand'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'text'
  | 'freedraw'
  | 'eraser'
  | 'frame'
  | 'image'

export type DrawTool = Exclude<Tool, 'selection' | 'hand' | 'freedraw' | 'eraser' | 'image'>

/** An image already stored in `files`, waiting for the user to click where it goes. */
export interface PendingImage {
  fileId: string
  width: number
  height: number
}

export interface TextEditorState {
  id: string
  x: number
  y: number
  text: string
  fontSize: number
  fontFamily: number
  lineHeight: number
  textAlign: 'left' | 'center' | 'right'
  strokeColor: string
  isNew: boolean
  /** Set when editing the label of a shape or arrow; x, y is then the label center. */
  containerId: string | null
  wrapWidth: number
  angle: number
  /** Paint the canvas background behind the text (arrow labels). */
  opaque: boolean
}

/** The active node of the selected line or arrow. */
export interface PointEdit {
  id: string
  /** Index into `points` (straight and curved lines and arrows). */
  selected: number | null
  /** Index into the node list of an elbow arrow (interior vertices of its route plus pinned nodes); never a point index. */
  waypoint?: number
}

export interface InitialScene {
  elements: SceneElement[]
  appState: AppStateFile
  files: Record<string, unknown>
  viewport: Viewport
}

export interface Snapshot {
  elements: readonly SceneElement[]
  selectedIds: readonly string[]
}

/** Pending keyboard flowchart nodes: transient, never part of `elements` or the history. */
export interface FlowPreview {
  sourceId: string
  dir: Direction
  count: number
  plan: FlowPlan
  /** The elements array the plan was computed from. */
  base: readonly SceneElement[]
  viewportBefore: Viewport
  /** Viewport set when the preview was shown, to tell if the user moved it since. */
  viewportShown: Viewport
}

export type Modal =
  | { kind: 'shortcuts' }
  | { kind: 'export' }
  | { kind: 'renameFrame'; id: string }
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string; onConfirm: () => void; cancelFocus?: boolean }
  | null

/** Presentation mode: the current slide and what to restore on exit. */
export interface Presentation {
  index: number
  /** Slide being left during the pan/zoom transition; its frame stays visible until it settles. */
  from?: number
  restore: { viewport: Viewport; selectedIds: readonly string[]; tool: Tool }
}

export interface CropSession {
  id: string
  /** The element and element list as they were when crop mode started. */
  before: ImageElement
  prior: readonly SceneElement[]
  frame: CropFrame
}

/** The single selected, unlocked image whose binary is loaded: the only one that can be cropped. */
export function croppableImage(s: Pick<State, 'elements' | 'selectedIds' | 'files' | 'tool'>): ImageElement | null {
  if (s.tool !== 'selection' || s.selectedIds.length !== 1) return null
  const el = s.elements.find((e) => e.id === s.selectedIds[0])
  if (!el || el.isDeleted || el.locked || !isImage(el) || !el.fileId || !hasDataURL(s.files[el.fileId])) return null
  return el
}

interface State {
  elements: readonly SceneElement[]
  draft: SceneElement | null
  selectedIds: readonly string[]
  marquee: Box | null
  tool: Tool
  viewport: Viewport
  appState: AppStateFile
  files: Record<string, unknown>
  defaults: StyleDefaults
  textEditor: TextEditorState | null
  pointEdit: PointEdit | null
  /** Image whose crop window is being edited; the element already carries the live crop. */
  cropping: CropSession | null
  bindHighlight: string | null
  /** Shape an arrow being drawn is anchored to at its start. */
  bindAnchor: string | null
  /** Group entered with a double click: its members can be selected individually. */
  editingGroupId: string | null
  /** Ids touched by the eraser, shown faded until the gesture ends. */
  erasing: readonly string[]
  snapGuides: readonly SnapGuide[]
  flowPreview: FlowPreview | null
  spaceHeld: boolean
  cursor: string
  saveError: boolean
  history: History<Snapshot>
  fileName: string | null
  modal: Modal
  notice: string | null
  pendingImages: readonly PendingImage[] | null
  library: readonly LibraryItem[]
  libraryOpen: boolean
  slidesOpen: boolean
  presentation: Presentation | null
  theme: ThemePref
  dark: boolean
  /** Image binaries could not be written to IndexedDB; the scene save does not clear it. */
  filesError: boolean
  setFilesError: (value: boolean) => void

  addFiles: (files: Record<string, unknown>) => void
  setPendingImages: (items: readonly PendingImage[] | null) => void
  /** Adds image elements centered on (cx, cy) as one history entry. */
  insertImages: (items: readonly PendingImage[], cx: number, cy: number) => void
  renameFrame: (id: string, name: string) => void
  setTheme: (theme: ThemePref) => void
  refreshTheme: () => void
  setLibrary: (items: readonly LibraryItem[]) => void
  toggleLibrary: () => void
  toggleSlides: () => void
  /** Moves a slide (frame) up or down in presentation order; one history entry. */
  reorderSlide: (id: string, delta: number) => void
  /** Sets the slide's own duration in seconds (null clears it); one history entry. */
  setSlideDuration: (id: string, seconds: number | null) => void
  /** Enters presentation mode at a slide; notifies instead when the scene has no frames. */
  startPresentation: (index?: number) => void
  setPresentationIndex: (index: number) => void
  /** Ends the transition between slides (drops the previous slide's clip). */
  settlePresentation: () => void
  endPresentation: () => void
  addSelectionToLibrary: () => void
  insertLibraryItem: (id: string) => void
  deleteLibraryItem: (id: string) => void
  importLibraryItems: (items: readonly LibraryItem[]) => number

  setTool: (tool: Tool) => void
  setSelection: (ids: readonly string[]) => void
  toggleSelection: (id: string) => void
  selectAll: () => void
  setViewport: (vp: Viewport) => void
  setDraft: (el: SceneElement | null) => void
  setMarquee: (box: Box | null) => void
  /** Transient updates used during a gesture; they never create history entries. */
  replaceElements: (els: readonly SceneElement[]) => void
  insertElements: (els: readonly SceneElement[]) => void
  removeElements: (ids: readonly string[]) => void
  /** Raw replacement used to cancel a gesture; skips reconciliation. */
  restoreElements: (els: readonly SceneElement[]) => void
  detachArrows: (arrowIds: ReadonlySet<string>, keep: ReadonlySet<string>) => void
  unbindEnd: (arrowId: string, end: 'start' | 'end') => void
  bindEnds: (arrowId: string, ends: { start?: string | null; end?: string | null }) => void
  setBindHighlight: (id: string | null, anchor?: string | null) => void
  setEditingGroup: (id: string | null) => void
  setErasing: (ids: readonly string[]) => void
  setSnapGuides: (guides: readonly SnapGuide[]) => void
  setPointEdit: (pe: PointEdit | null) => void
  setGestureActive: (active: boolean) => void
  /** Records a pending nudge as its own history entry (called before any other action starts). */
  flushPending: () => void
  /** Committed mutations: each one creates exactly one history entry. */
  commitDraft: (el: SceneElement, ends?: { start?: string | null; end?: string | null }) => void
  /** With `prior` (elements at gesture start), a gesture that changed nothing creates no entry. */
  endGesture: (kind: 'move' | 'resize' | 'duplicate' | 'point' | 'rotate', prior?: readonly SceneElement[]) => void
  /** Deletes the active interior node of the edited line or arrow as one entry; false when there is none. */
  deletePoint: () => boolean
  /** Adds a node at the closest path position to the scene point and makes it the active node (one entry). */
  insertNode: (id: string, x: number, y: number) => boolean
  /** Pops the entries of the last node inserts (up to two, for a double click); the caller enforces the time window, and each pops only while it is still the top entry, untouched. */
  discardNodeInsert: (id: string) => boolean
  addElements: (els: readonly SceneElement[], reason: 'paste' | 'duplicate') => void
  deleteSelected: () => void
  /** Adds a finished freehand stroke and keeps the pencil tool active. */
  commitStroke: (el: SceneElement) => void
  eraseElements: (ids: readonly string[]) => void
  groupSelection: () => void
  ungroupSelection: () => void
  toggleLock: () => void
  flipSelection: (axis: FlipAxis) => void
  alignSelection: (kind: AlignKind) => void
  distributeSelection: (axis: DistributeAxis) => void
  toggleGrid: () => void
  toggleObjectSnap: () => void
  applyStyle: (patch: StylePatch) => void
  /** Sets (or with null clears) the animation of the selected elements that can carry it; one history entry. */
  setAnimation: (kind: AnimationKind | null) => void
  reorderSelection: (op: ZOrderOp) => void
  nudgeSelection: (dx: number, dy: number) => void
  /**
   * Enters crop mode on the croppable selected image. `natural` is the pixel size of its binary,
   * needed only when the image has no crop yet. No history entry.
   */
  startCrop: (natural?: { width: number; height: number }) => boolean
  /** Live crop window update; the element box follows so the visible region stays put. No history entry. */
  updateCrop: (crop: ImageCrop) => void
  /** Leaves crop mode keeping the crop: one undo entry, none when nothing changed. */
  applyCrop: () => void
  /** Leaves crop mode and restores the crop it started with. */
  cancelCrop: () => void
  /** Shows the whole image of the single selected cropped image, keeping the visible region in place. One undo entry. */
  clearCrop: () => void
  /**
   * Shows (or grows) the pending parallel nodes next to the single selected node. The same direction
   * adds one more node (up to 9); another direction starts over with one. No history entry.
   */
  previewConnectedNodes: (dir: Direction, view: ViewSize) => boolean
  /** Inserts the pending nodes and arrows as one undo entry and selects the first node. */
  commitFlowPreview: (view: ViewSize) => boolean
  /** Discards the pending nodes and restores the viewport if the user has not moved it. */
  cancelFlowPreview: () => void
  /** Adds a bound arrow between two nodes as part of the gesture in progress (no history entry). */
  connectNodes: (sourceId: string, targetId: string) => void
  /** Selects the connected node lying in `dir` from the single selected node. No history entry. */
  selectConnected: (dir: Direction, view: ViewSize) => boolean
  /** Converts the selected nodes to the next (or previous) type of the cycle. One undo entry. */
  cycleNodeTypes: (reverse: boolean) => boolean
  openTextEditor: (init: { id?: string; x: number; y: number; existing?: boolean }) => void
  openLabelEditor: (containerId: string) => void
  setEditorText: (text: string) => void
  commitTextEditor: () => void
  undo: () => void
  redo: () => void
  setSaveError: (value: boolean) => void
  setSpaceHeld: (held: boolean) => void
  setCursor: (cursor: string) => void
  setFileName: (name: string | null) => void
  showModal: (modal: Modal) => void
  closeModal: () => void
  notify: (text: string) => void
  dismissNotice: () => void
  load: (scene: InitialScene) => void
  openScene: (scene: InitialScene, fileName: string | null) => void
}

export interface ViewSize {
  width: number
  height: number
}

const NUDGE_IDLE_MS = 500
const COALESCE_MS = 800

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i])

function mapIfChanged(elements: readonly SceneElement[], fn: (e: SceneElement) => SceneElement) {
  const next = elements.map(fn)
  return next.some((e, i) => e !== elements[i]) ? next : elements
}

export const getSelectedElements = (s: Pick<State, 'elements' | 'selectedIds'>): SceneElement[] => {
  const ids = new Set(s.selectedIds)
  return s.elements.filter((e) => ids.has(e.id) && !e.isDeleted)
}

/** Selected elements that may be modified (locked ones are excluded). */
export const getEditableSelection = (s: Pick<State, 'elements' | 'selectedIds'>): SceneElement[] =>
  getSelectedElements(s).filter((e) => !e.locked)

const gridSize = (s: Pick<State, 'appState'>): number | null => {
  const grid = gridSettings(s.appState)
  return grid.enabled ? grid.size : null
}

export const useStore = create<State>()((set, get) => {
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let lastCheckpoint = { reason: '', time: 0 }
  // the latest node inserts: element, history index and elements right after each one
  let nodeInserts: { id: string; index: number; elements: readonly SceneElement[] }[] = []
  let gestureActive = false
  let nudgePending = false
  // Label font of the node a connected node was created from, used when its first label opens.
  const labelFonts = new Map<string, { fontSize: number; fontFamily: number }>()

  /**
   * History hook: called once per completed mutation, never per pointermove.
   * With `coalesce`, repeated checkpoints of the same reason in quick succession share one entry.
   */
  function checkpoint(reason: string, coalesce = false): void {
    const { elements, selectedIds, history } = get()
    if (currentEntry(history).elements === elements) return
    const snap: Snapshot = { elements, selectedIds }
    const now = Date.now()
    const merge =
      coalesce &&
      history.index === history.stack.length - 1 &&
      history.index > 0 &&
      lastCheckpoint.reason === reason &&
      now - lastCheckpoint.time < COALESCE_MS
    lastCheckpoint = { reason, time: now }
    set({ history: merge ? replaceCurrent(history, snap) : pushHistory(history, snap) })
  }

  /** Re-evaluates frame membership when a burst of arrow-key nudges ends, then records the entry. */
  function settleNudge(): void {
    const els = get().elements
    const framed = assignFrames(els, new Set(get().selectedIds))
    if (framed !== els) set({ elements: framed })
    checkpoint('nudge')
  }

  function flushNudge(): void {
    if (nudgeTimer) {
      clearTimeout(nudgeTimer)
      nudgeTimer = undefined
    }
    if (nudgePending) {
      nudgePending = false
      settleNudge()
    }
  }

  function restore(history: History<Snapshot>): void {
    const snap = currentEntry(history)
    const changed = selectionAfterRestore(get().elements, snap.elements)
    lastCheckpoint = { reason: '', time: 0 }
    set({
      history,
      elements: snap.elements,
      selectedIds: get().tool === 'selection' ? changed : [],
      pointEdit: null,
      cropping: null,
      bindHighlight: null,
      bindAnchor: null,
      draft: null,
      marquee: null,
      textEditor: null,
      editingGroupId: null,
      erasing: [],
      snapGuides: [],
    })
  }

  /** Applies transformed copies of some elements as one history entry. */
  function commitChanged(changed: readonly SceneElement[], reason: string): void {
    if (changed.length === 0) return
    flushNudge()
    const prev = get().elements
    const byId = new Map(changed.map((e) => [e.id, e]))
    const applied = prev.map((e) => byId.get(e.id) ?? e)
    // arrows whose shapes are not part of the change are detached instead of being re-snapped
    const arrows = new Set(changed.filter((e) => e.type === 'arrow').map((e) => e.id))
    const next = arrows.size ? detachArrowEnds(applied, arrows, new Set(byId.keys())) : applied
    set({ elements: reconcile(prev, next) })
    checkpoint(reason)
  }

  /** Unlocked selected ids, without labels. */
  function editableIds(): string[] {
    return getEditableSelection(get())
      .filter((e) => !isBoundText(e))
      .map((e) => e.id)
  }

  return {
    elements: [],
    draft: null,
    selectedIds: [],
    marquee: null,
    tool: 'selection',
    viewport: DEFAULT_VIEWPORT,
    appState: DEFAULT_APP_STATE,
    files: {},
    defaults: DEFAULT_STYLE_DEFAULTS,
    textEditor: null,
    pointEdit: null,
    cropping: null,
    bindHighlight: null,
    bindAnchor: null,
    editingGroupId: null,
    erasing: [],
    snapGuides: [],
    flowPreview: null,
    spaceHeld: false,
    cursor: 'default',
    saveError: false,
    history: createHistory<Snapshot>({ elements: [], selectedIds: [] }),
    fileName: null,
    modal: null,
    notice: null,
    pendingImages: null,
    library: [],
    libraryOpen: false,
    slidesOpen: false,
    presentation: null,
    theme: loadThemePref(),
    dark: isDark(loadThemePref()),
    filesError: false,
    setFilesError: (filesError) => {
      if (get().filesError !== filesError) set({ filesError })
    },

    addFiles: (files) => {
      const clean = sanitizeFiles(files, get().files)
      if (Object.keys(clean).length === 0) return
      set({ files: { ...get().files, ...clean } })
    },
    setPendingImages: (items) => {
      get().commitTextEditor()
      set({ pendingImages: items, tool: items ? 'image' : 'selection', draft: null, selectedIds: items ? [] : get().selectedIds })
    },
    insertImages: (items, cx, cy) => {
      if (items.length === 0) return
      const gap = 16
      const total = items.reduce((n, i) => n + i.width, 0) + gap * (items.length - 1)
      let x = cx - total / 2
      const els = items.map((i) => {
        const el = createImageElement(i.fileId, x, cy - i.height / 2, i.width, i.height)
        x += i.width + gap
        return el
      })
      set({ pendingImages: null })
      get().addElements(els, 'paste')
    },
    renameFrame: (id, name) => {
      const { elements } = get()
      const next = mapIfChanged(elements, (e) =>
        e.id === id && e.type === 'frame' && !e.locked ? updateElement(e, { name: name.trim() === '' ? null : name.trim() } as Partial<SceneElement>) : e,
      )
      if (next === elements) return
      set({ elements: next })
      checkpoint('rename')
    },
    setTheme: (theme) => {
      saveThemePref(theme)
      set({ theme, dark: isDark(theme) })
    },
    refreshTheme: () => {
      const dark = isDark(get().theme)
      if (dark !== get().dark) set({ dark })
    },
    setLibrary: (library) => set({ library }),
    toggleLibrary: () => set({ libraryOpen: !get().libraryOpen, slidesOpen: false }),
    // both side panels live on the right, so opening one closes the other
    toggleSlides: () => set({ slidesOpen: !get().slidesOpen, libraryOpen: false }),
    reorderSlide: (id, delta) => {
      flushNudge()
      const { elements } = get()
      const next = reorderSlides(elements, id, delta)
      if (next === elements) return
      set({ elements: next as SceneElement[] })
      checkpoint('slide-order')
    },
    setSlideDuration: (id, seconds) => {
      flushNudge()
      const { elements } = get()
      const next = withSlideDuration(elements, id, seconds)
      if (next.every((e, i) => e === elements[i])) return
      set({ elements: next as SceneElement[] })
      checkpoint(`slide-duration:${id}`, true)
    },
    startPresentation: (index = 0) => {
      const s = get()
      if (s.presentation || s.modal) return
      const slides = slideFrames(s.elements)
      if (slides.length === 0) {
        s.notify('Crea marcos (F) para definir las diapositivas')
        return
      }
      if (s.cropping) s.applyCrop()
      if (get().textEditor) get().commitTextEditor()
      const after = get()
      set({
        presentation: {
          index: Math.max(0, Math.min(slides.length - 1, index)),
          restore: { viewport: after.viewport, selectedIds: after.selectedIds, tool: after.tool },
        },
        selectedIds: [],
        pointEdit: null,
        marquee: null,
        draft: null,
        tool: 'selection',
        editingGroupId: null,
      })
    },
    setPresentationIndex: (index) => {
      const p = get().presentation
      if (p && p.index !== index) set({ presentation: { ...p, index, from: p.index } })
    },
    settlePresentation: () => {
      const p = get().presentation
      if (p && p.from !== undefined) set({ presentation: { index: p.index, restore: p.restore } })
    },
    endPresentation: () => {
      const p = get().presentation
      if (!p) return
      const ids = new Set(get().elements.filter((e) => !e.isDeleted).map((e) => e.id))
      set({
        presentation: null,
        viewport: p.restore.viewport,
        selectedIds: p.restore.selectedIds.filter((id) => ids.has(id)),
        tool: p.restore.tool,
      })
    },
    addSelectionToLibrary: () => {
      const { elements, files } = get()
      const sel = getSelectedElements(get())
      if (sel.length === 0) return
      const item = createLibraryItem(withFrameChildren(elements, expandWithLabels(elements, sel)), files)
      if (!item) return
      set({ library: [item, ...get().library], libraryOpen: true, slidesOpen: false })
      get().notify('Añadido a la biblioteca')
    },
    insertLibraryItem: (id) => {
      const item = get().library.find((i) => i.id === id)
      if (!item) return
      const c = screenToScene(get().viewport, window.innerWidth / 2, window.innerHeight / 2)
      if (item.files) get().addFiles(item.files)
      get().addElements(cloneCentered(item.elements, c.x, c.y), 'paste')
    },
    deleteLibraryItem: (id) => set({ library: get().library.filter((i) => i.id !== id) }),
    importLibraryItems: (items) => {
      const have = new Set(get().library.map((i) => i.id))
      const fresh = items.filter((i) => !have.has(i.id))
      if (fresh.length) set({ library: [...fresh, ...get().library] })
      return fresh.length
    },

    setTool: (tool) => {
      get().commitTextEditor()
      if (tool !== 'selection') get().applyCrop()
      set({
        pendingImages: tool === 'image' ? get().pendingImages : null,
        tool,
        draft: null,
        pointEdit: null,
        bindHighlight: null,
        bindAnchor: null,
        erasing: [],
        snapGuides: [],
        editingGroupId: tool === 'selection' ? get().editingGroupId : null,
        selectedIds: tool === 'selection' ? get().selectedIds : [],
      })
    },
    setSelection: (ids) => {
      const els = get().elements
      const labelIds = new Set(els.filter(isBoundText).map((e) => e.id))
      if (ids.some((id) => labelIds.has(id))) ids = ids.filter((id) => !labelIds.has(id))
      if (sameIds(ids, get().selectedIds)) return
      const session = get().cropping
      if (session && !(ids.length === 1 && ids[0] === session.id)) get().applyCrop()
      const pe = get().pointEdit
      const eg = get().editingGroupId
      const keepGroup = eg !== null && ids.length > 0 && ids.every((id) => els.find((e) => e.id === id)?.groupIds.includes(eg))
      set({
        selectedIds: ids,
        pointEdit: pe && ids.length === 1 && ids[0] === pe.id ? pe : null,
        editingGroupId: keepGroup ? eg : null,
      })
    },
    toggleSelection: (id) => {
      const ids = get().selectedIds
      set({ selectedIds: ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id], pointEdit: null })
    },
    selectAll: () => {
      get().commitTextEditor()
      const ids = get()
        .elements.filter((e) => !e.isDeleted && !e.locked && isRenderable(e) && !isBoundText(e))
        .map((e) => e.id)
      set({ selectedIds: ids, tool: 'selection', pointEdit: null, editingGroupId: null })
    },
    setViewport: (vp) => set({ viewport: { ...vp, zoom: clampZoom(vp.zoom) } }),
    setDraft: (draft) => set({ draft }),
    setMarquee: (marquee) => set({ marquee }),
    setBindHighlight: (id, anchor = null) => {
      if (get().bindHighlight !== id || get().bindAnchor !== anchor) set({ bindHighlight: id, bindAnchor: anchor })
    },
    setEditingGroup: (editingGroupId) => {
      if (get().editingGroupId !== editingGroupId) set({ editingGroupId })
    },
    setErasing: (erasing) => set({ erasing }),
    setSnapGuides: (snapGuides) => {
      if (snapGuides.length === 0 && get().snapGuides.length === 0) return
      set({ snapGuides })
    },
    setPointEdit: (pointEdit) => {
      const el = pointEdit ? get().elements.find((e) => e.id === pointEdit.id) : undefined
      // elbow arrows only have waypoints as nodes
      if (el && isLinear(el) && el.elbowed === true && pointEdit?.waypoint === undefined) return
      set({ pointEdit })
    },
    setGestureActive: (active) => {
      gestureActive = active
    },
    flushPending: () => flushNudge(),

    replaceElements: (els) => {
      const byId = new Map(els.map((e) => [e.id, e]))
      const prev = get().elements
      set({ elements: reconcile(prev, prev.map((e) => byId.get(e.id) ?? e)) })
    },
    insertElements: (els) => {
      const prev = get().elements
      set({ elements: reconcile(prev, [...prev, ...els]) })
    },
    removeElements: (ids) => {
      const drop = new Set(ids)
      set((s) => ({ elements: s.elements.filter((e) => !drop.has(e.id)) }))
    },
    restoreElements: (els) => set({ elements: els }),
    detachArrows: (arrowIds, keep) => {
      const prev = get().elements
      set({ elements: reconcile(prev, detachArrowEnds(prev, arrowIds, keep)) })
    },
    unbindEnd: (arrowId, end) => {
      const prev = get().elements
      set({ elements: reconcile(prev, unbindArrowEnd(prev, arrowId, end)) })
    },
    bindEnds: (arrowId, ends) => {
      const prev = get().elements
      let next = prev
      if (ends.start) next = bindArrowEnd(next, arrowId, 'start', ends.start)
      if (ends.end) next = bindArrowEnd(next, arrowId, 'end', ends.end)
      set({ elements: reconcile(prev, next) })
    },

    commitDraft: (el, ends) => {
      flushNudge()
      const prev = get().elements
      let next: readonly SceneElement[] = [...prev, el]
      if (isLinear(el) && el.type === 'arrow' && ends) {
        if (ends.start) next = bindArrowEnd(next, el.id, 'start', ends.start)
        if (ends.end) next = bindArrowEnd(next, el.id, 'end', ends.end)
      }
      if (isLinear(el) && el.type === 'arrow' && el.elbowed === true) {
        // a new elbow arrow has no previous version, so reconcile does not route it
        const found = (id: string) => next.find((e) => e.id === id)
        next = next.map((e) => (e.id === el.id && isLinear(e) ? rerouteElbowArrow(e, found) : e))
      }
      set({
        elements: assignFrames(reconcile(prev, next), new Set([el.id])),
        selectedIds: [el.id],
        tool: 'selection',
        draft: null,
        pointEdit: null,
        bindHighlight: null,
        bindAnchor: null,
        editingGroupId: null,
      })
      checkpoint('create')
    },
    endGesture: (kind, prior) => {
      const { elements } = get()
      if (prior && sameContent(prior, elements)) {
        if (elements !== prior) set({ elements: prior })
        return
      }
      if (kind !== 'point') {
        const framed = assignFrames(elements, new Set(get().selectedIds))
        if (framed !== elements) set({ elements: framed })
      }
      checkpoint(kind)
    },

    addElements: (els, reason) => {
      flushNudge()
      const prev = get().elements
      set({
        elements: assignFrames(reconcile(prev, [...prev, ...els]), new Set(els.map((e) => e.id))),
        selectedIds: els.filter((e) => !isBoundText(e)).map((e) => e.id),
        tool: 'selection',
        pointEdit: null,
        editingGroupId: null,
      })
      checkpoint(reason)
    },

    deleteSelected: () => {
      flushNudge()
      const { elements } = get()
      const locked = new Set(getSelectedElements(get()).filter((e) => e.locked).map((e) => e.id))
      const selectedIds = get().selectedIds.filter((id) => !locked.has(id))
      if (selectedIds.length === 0) return
      const ids = new Set(selectedIds)
      set({
        elements: releaseFrameChildren(
          reconcile(
            elements,
            elements.map((e) => (ids.has(e.id) ? updateElement(e, { isDeleted: true }) : e)),
          ),
        ),
        selectedIds: get().selectedIds.filter((id) => locked.has(id)),
        pointEdit: null,
      })
      checkpoint('delete')
    },

    commitStroke: (el) => {
      flushNudge()
      const prev = get().elements
      set({ elements: assignFrames([...prev, el], new Set([el.id])), draft: null, editingGroupId: null })
      checkpoint('create')
    },

    eraseElements: (ids) => {
      flushNudge()
      const { elements } = get()
      const drop = new Set(ids)
      const next = elements.map((e) =>
        drop.has(e.id) && !e.locked && !e.isDeleted ? updateElement(e, { isDeleted: true }) : e,
      )
      set({
        elements: releaseFrameChildren(reconcile(elements, next)),
        erasing: [],
        selectedIds: get().selectedIds.filter((id) => !drop.has(id)),
      })
      checkpoint('erase')
    },

    groupSelection: () => {
      flushNudge()
      const { elements } = get()
      const next = groupElements(elements, editableIds())
      if (next === elements) return
      set({ elements: next, editingGroupId: null })
      checkpoint('group')
    },

    ungroupSelection: () => {
      flushNudge()
      const { elements } = get()
      const next = ungroupElements(elements, editableIds())
      if (next === elements) return
      set({ elements: next, editingGroupId: null })
      checkpoint('group')
    },

    toggleLock: () => {
      flushNudge()
      const { elements, selectedIds } = get()
      const ids = expandToWholeGroups(elements, new Set(selectedIds))
      for (const e of elements) if (isBoundText(e) && ids.has(containerIdOf(e) as string)) ids.add(e.id)
      const targets = elements.filter((e) => ids.has(e.id) && !e.isDeleted)
      if (targets.length === 0) return
      const lock = !targets.every((e) => e.locked)
      set({
        elements: elements.map((e) => (ids.has(e.id) && !e.isDeleted ? updateElement(e, { locked: lock }) : e)),
        pointEdit: null,
        editingGroupId: null,
      })
      checkpoint('lock')
    },

    flipSelection: (axis) => {
      const sel = getEditableSelection(get()).filter((e) => !isBoundText(e))
      commitChanged(flipElements(sel, axis), 'flip')
    },

    alignSelection: (kind) => {
      const { elements, editingGroupId } = get()
      commitChanged(alignUnits(selectionUnits(elements, editableIds(), editingGroupId), kind), 'align')
    },

    distributeSelection: (axis) => {
      const { elements, editingGroupId } = get()
      commitChanged(distributeUnits(selectionUnits(elements, editableIds(), editingGroupId), axis), 'align')
    },

    toggleGrid: () => {
      const { appState } = get()
      set({ appState: withGrid(appState, !gridSettings(appState).enabled) })
    },

    toggleObjectSnap: () => {
      const { appState } = get()
      set({ appState: { ...appState, objectsSnapModeEnabled: !smartGuidesEnabled(appState) } })
    },

    deletePoint: () => {
      flushNudge()
      const { pointEdit: pe, elements } = get()
      if (!pe) return false
      const el = elements.find((e) => e.id === pe.id)
      if (el && isLinear(el) && el.elbowed === true && !el.locked && pe.waypoint !== undefined) {
        const routed = deleteElbowNode(el, pe.waypoint, (id) => elements.find((e) => e.id === id))
        if (!routed) return false
        const unchanged = JSON.stringify([routed.points, routed.x, routed.y, routed.customData]) === JSON.stringify([el.points, el.x, el.y, el.customData])
        set({
          ...(unchanged ? {} : { elements: reconcile(elements, elements.map((e) => (e.id === el.id ? routed : e))) }),
          pointEdit: { id: pe.id, selected: null },
        })
        checkpoint('point')
        return true
      }
      if (pe.selected === null) return false
      if (!el || !isLinear(el) || el.elbowed === true || el.locked) return false
      const removed = removePoint(el, pe.selected)
      if (!removed) return false
      let base = elements
      if (pe.selected === 0) base = unbindArrowEnd(base, el.id, 'start')
      if (pe.selected === el.points.length - 1) base = unbindArrowEnd(base, el.id, 'end')
      const current = base.find((e) => e.id === el.id) as LinearElement
      const next = { ...removed, startBinding: current.startBinding, endBinding: current.endBinding }
      set({
        elements: reconcile(elements, base.map((e) => (e.id === el.id ? next : e))),
        pointEdit: { id: pe.id, selected: null },
      })
      checkpoint('point')
      return true
    },

    insertNode: (id, x, y) => {
      flushNudge()
      const { elements } = get()
      const el = elements.find((e) => e.id === id)
      if (!el || !isLinear(el) || el.locked) return false
      const elbow = el.elbowed === true
      const ins = elbow ? insertElbowNode(el, x, y) : insertNodeAt(el, x, y)
      if (!ins) return false
      set({
        elements: reconcile(elements, elements.map((e) => (e.id === id ? ins.element : e))),
        pointEdit: elbow ? { id, selected: null, waypoint: ins.index } : { id, selected: ins.index },
      })
      const pushed = get().history
      checkpoint('node-insert')
      const after = get().history
      if (after !== pushed) nodeInserts = [...nodeInserts, { id, index: after.index, elements: currentEntry(after).elements }].slice(-2)
      return true
    },

    discardNodeInsert: (id) => {
      let popped = 0
      // the last inserts (a double click can add two) are still the top of the history, untouched since
      for (;;) {
        const { history, elements } = get()
        const last = nodeInserts[nodeInserts.length - 1]
        const prev = history.stack[history.index - 1]
        if (!last || last.id !== id || last.index !== history.index || history.index !== history.stack.length - 1) break
        if (last.elements !== elements || currentEntry(history).elements !== elements || !prev) break
        nodeInserts = nodeInserts.slice(0, -1)
        lastCheckpoint = { reason: '', time: 0 }
        set({ elements: prev.elements, history: { stack: history.stack.slice(0, -1), index: history.index - 1 }, pointEdit: null })
        popped++
      }
      return popped > 0
    },

    applyStyle: (patch) => {
      flushNudge()
      const { selectedIds, elements, defaults } = get()
      const lockedIds = new Set(elements.filter((e) => e.locked).map((e) => e.id))
      const ids = new Set(selectedIds.filter((id) => !lockedIds.has(id)))
      for (const e of elements) if (isBoundText(e) && ids.has(containerIdOf(e) as string)) ids.add(e.id)
      const mapped = selectedIds.length
        ? mapIfChanged(elements, (e) => (ids.has(e.id) ? applyStyleToElement(e, patch) : e))
        : elements
      const next = reconcile(elements, mapped)
      const pe = get().pointEdit
      const elbowOf = (list: readonly SceneElement[]) => list.some((e) => e.id === pe?.id && isLinear(e) && e.elbowed === true)
      const leavePointEdit = !!pe && patch.curve !== undefined && elbowOf(next) !== elbowOf(elements)
      set({ defaults: { ...defaults, ...patch }, elements: next, ...(leavePointEdit ? { pointEdit: null } : {}) })
      // a curve choice is a discrete step, never merged with the previous one
      checkpoint(`style:${Object.keys(patch).join(',')}:${selectedIds.join(',')}`, !('curve' in patch))
    },

    setAnimation: (kind) => {
      flushNudge()
      const { elements, selectedIds } = get()
      const ids = new Set(selectedIds)
      const next = mapIfChanged(elements, (e) => {
        if (!ids.has(e.id) || e.isDeleted || e.locked) return e
        if (kind ? !canAnimate(e, kind) || animationOf(e) === kind : animationOf(e) === null) return e
        return updateElement(e, { customData: customDataWithAnimation(e, kind) })
      })
      if (next === elements) return
      set({ elements: next })
      checkpoint('animation')
    },

    reorderSelection: (op) => {
      flushNudge()
      const { elements, selectedIds } = get()
      const next = reorderElements(elements, selectedIds, op)
      if (next === elements) return
      set({ elements: next })
      checkpoint('zorder')
    },

    startCrop: (natural) => {
      flushNudge()
      get().commitTextEditor()
      const s = get()
      const el = croppableImage(s)
      if (!el || s.cropping) return false
      const frame = cropFrame(el, natural)
      if (!frame) return false
      set({ cropping: { id: el.id, before: el, prior: s.elements, frame }, pointEdit: null, editingGroupId: null })
      return true
    },

    updateCrop: (crop) => {
      const { cropping, elements } = get()
      const el = cropping ? elements.find((e) => e.id === cropping.id) : undefined
      if (!cropping || !el || !isImage(el)) return
      const next = elementAtCrop(el, cropping.frame, crop)
      set({ elements: reconcile(elements, elements.map((e) => (e.id === el.id ? next : e))) })
    },

    applyCrop: () => {
      const { cropping, elements } = get()
      if (!cropping) return
      set({ cropping: null })
      const el = elements.find((e) => e.id === cropping.id)
      if (!el || !isImage(el)) return
      if (sameCrop(parseCrop(el.crop), parseCrop(cropping.before.crop))) {
        set({ elements: elements.map((e) => (e.id === cropping.id ? cropping.before : e)) })
        return
      }
      const framed = assignFrames(elements, new Set([el.id]))
      if (framed !== elements) set({ elements: framed })
      checkpoint('crop')
    },

    cancelCrop: () => {
      const { cropping, elements } = get()
      if (!cropping) return
      const restored = elements.map((e) => (e.id === cropping.id ? cropping.before : e))
      set({ cropping: null, elements: reconcile(elements, restored) })
    },

    clearCrop: () => {
      flushNudge()
      const s = get()
      const el = s.selectedIds.length === 1 ? s.elements.find((e) => e.id === s.selectedIds[0]) : undefined
      if (s.cropping || !el || el.locked || !isImage(el) || !parseCrop(el.crop)) return
      const next = resetCrop(el)
      set({ elements: assignFrames(reconcile(s.elements, s.elements.map((e) => (e.id === el.id ? next : e))), new Set([el.id])) })
      checkpoint('crop')
    },

    nudgeSelection: (dx, dy) => {
      const { elements } = get()
      const selectedIds = editableIds()
      if (selectedIds.length === 0) return
      const ids = new Set(selectedIds)
      for (const e of elements) if (isBoundText(e) && ids.has(containerIdOf(e) as string)) ids.add(e.id)
      for (const c of withFrameChildren(elements, elements.filter((e) => ids.has(e.id)))) ids.add(c.id)
      const moved = elements.map((e) => (ids.has(e.id) ? moveElement(e, dx, dy) : e))
      const arrows = new Set(moved.filter((e) => ids.has(e.id) && e.type === 'arrow').map((e) => e.id))
      set({ elements: reconcile(elements, arrows.size ? detachArrowEnds(moved, arrows, ids) : moved) })
      nudgePending = true
      if (nudgeTimer) clearTimeout(nudgeTimer)
      nudgeTimer = setTimeout(() => {
        nudgeTimer = undefined
        if (gestureActive) return
        nudgePending = false
        settleNudge()
      }, NUDGE_IDLE_MS)
    },

    previewConnectedNodes: (dir, view) => {
      flushNudge()
      const s = get()
      const sel = getSelectedElements(s)
      const source = sel.length === 1 ? sel[0] : undefined
      if (!source || !isNode(source) || s.textEditor || s.modal) return false
      const prev = s.flowPreview
      const continuing = !!prev && prev.sourceId === source.id && prev.dir === dir && prev.base === s.elements
      const count = continuing ? Math.min(prev.count + 1, MAX_FLOW_COUNT) : 1
      const plan = planConnectedNodes(s.elements, source, dir, count, s.defaults, gridSize(s))
      const viewportBefore = prev && prev.base === s.elements ? prev.viewportBefore : s.viewport
      const ids = new Set(plan.nodeIds)
      const bounds = getCommonBounds(plan.elements.filter((e) => ids.has(e.id)))
      const viewportShown = bounds
        ? revealBox(viewportBefore, { x: bounds[0], y: bounds[1], width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] }, view.width, view.height)
        : viewportBefore
      set({
        flowPreview: { sourceId: source.id, dir, count, plan, base: s.elements, viewportBefore, viewportShown },
        viewport: viewportShown,
      })
      return true
    },

    commitFlowPreview: (view) => {
      const s = get()
      const p = s.flowPreview
      if (!p) return false
      const source = s.elements.find((e) => e.id === p.sourceId)
      if (!source || !isNode(source)) {
        set({ flowPreview: null })
        return false
      }
      const plan = p.base === s.elements ? p.plan : planConnectedNodes(s.elements, source, p.dir, p.count, s.defaults, gridSize(s))
      const label = getLabel(s.elements, source.id)
      for (const id of plan.nodeIds) {
        labelFonts.set(id, { fontSize: label?.fontSize ?? s.defaults.fontSize, fontFamily: label?.fontFamily ?? 2 })
      }
      const primary = plan.elements.find((e) => e.id === plan.primaryId) as SceneElement
      set({
        elements: assignFrames(plan.elements, new Set([...plan.nodeIds, ...plan.arrowIds])),
        selectedIds: [plan.primaryId],
        tool: 'selection',
        pointEdit: null,
        editingGroupId: null,
        flowPreview: null,
        viewport: revealBox(s.viewport, primary, view.width, view.height),
      })
      checkpoint('flow')
      return true
    },

    cancelFlowPreview: () => {
      const p = get().flowPreview
      if (!p) return
      const vp = get().viewport
      set({ flowPreview: null, viewport: vp === p.viewportShown ? p.viewportBefore : vp })
    },

    connectNodes: (sourceId, targetId) => {
      const { elements, defaults } = get()
      const made = connectNodes(elements, sourceId, targetId, defaults, false, true)
      if (made) set({ elements: made.elements })
    },

    selectConnected: (dir, view) => {
      const sel = getSelectedElements(get())
      if (sel.length !== 1 || !isNode(sel[0])) return false
      const next = nearestConnected(get().elements, sel[0].id, dir)
      if (!next) return false
      set({
        selectedIds: [next.id],
        pointEdit: null,
        editingGroupId: null,
        viewport: revealBox(get().viewport, next, view.width, view.height),
      })
      return true
    },

    cycleNodeTypes: (reverse) => {
      const ids = new Set(
        getSelectedElements(get())
          .filter(isNode)
          .map((e) => e.id),
      )
      if (ids.size === 0) return false
      flushNudge()
      const { elements, defaults } = get()
      const converted = convertNodeTypes(elements, ids, reverse, defaults.edges)
      if (converted === elements) return false
      set({ elements: reconcile(elements, converted) })
      checkpoint('shape-type')
      return true
    },

    openTextEditor: ({ id, x, y, existing }) => {
      const { elements, defaults } = get()
      const el = existing && id ? elements.find((e) => e.id === id) : undefined
      if (el?.locked) return
      const base = { containerId: null, wrapWidth: 0, angle: 0, opaque: false, textAlign: 'left' as const }
      if (el && isText(el) && !isBoundText(el)) {
        set({
          selectedIds: [el.id],
          pointEdit: null,
          textEditor: {
            ...base,
            id: el.id,
            x: el.x,
            y: el.y,
            text: el.text,
            fontSize: el.fontSize,
            fontFamily: el.fontFamily,
            lineHeight: el.lineHeight,
            textAlign: el.textAlign,
            angle: el.angle,
            strokeColor: el.strokeColor,
            isNew: false,
          },
        })
        return
      }
      set({
        selectedIds: [],
        pointEdit: null,
        textEditor: {
          ...base,
          id: nanoid(),
          x,
          y,
          text: '',
          fontSize: defaults.fontSize,
          textAlign: defaults.textAlign,
          fontFamily: 2,
          lineHeight: 1.25,
          strokeColor: defaults.strokeColor,
          isNew: true,
        },
      })
    },

    openLabelEditor: (containerId) => {
      get().commitTextEditor()
      const { elements, defaults } = get()
      const c = elements.find((e) => e.id === containerId && !e.isDeleted && isLabelable(e))
      if (!c || c.locked) return
      const label = getLabel(elements, c.id)
      const center = labelCenter(c)
      set({
        selectedIds: [c.id],
        pointEdit: null,
        textEditor: {
          id: label?.id ?? nanoid(),
          x: center.x,
          y: center.y,
          text: label?.originalText ?? '',
          fontSize: label?.fontSize ?? labelFonts.get(c.id)?.fontSize ?? defaults.fontSize,
          textAlign: 'center',
          fontFamily: label?.fontFamily ?? labelFonts.get(c.id)?.fontFamily ?? 2,
          lineHeight: label?.lineHeight ?? 1.25,
          strokeColor: label?.strokeColor ?? c.strokeColor,
          isNew: !label,
          containerId: c.id,
          wrapWidth: innerWidth(c),
          angle: isLinear(c) ? 0 : c.angle,
          opaque: isLinear(c),
        },
      })
    },

    setEditorText: (text) => {
      const ed = get().textEditor
      if (ed) set({ textEditor: { ...ed, text } })
    },

    commitTextEditor: () => {
      const { textEditor: ed, elements, defaults } = get()
      if (!ed) return
      flushNudge()
      set({ textEditor: null })
      const empty = ed.text.trim() === ''

      if (ed.containerId) {
        const container = elements.find((e) => e.id === ed.containerId && !e.isDeleted)
        if (!container) return
        if (ed.isNew) {
          if (empty) return
          const made = createLabel(container, ed.text, { fontSize: ed.fontSize, fontFamily: ed.fontFamily })
          const label = { ...made.label, id: ed.id, strokeColor: ed.strokeColor }
          const swapped = elements.map((e) => (e.id === container.id ? made.container : e))
          set({
            elements: reconcile(elements, attachLabel(swapped, made.container, label)),
            selectedIds: [container.id],
          })
          checkpoint('text')
          return
        }
        set({
          elements: reconcile(
            elements,
            mapIfChanged(elements, (e) => {
              if (e.id !== ed.id || !isText(e) || e.originalText === ed.text) return e
              if (empty) return updateElement(e, { isDeleted: true })
              return updateElement(e, { text: ed.text, originalText: ed.text })
            }),
          ),
          selectedIds: [container.id],
        })
        checkpoint('text')
        return
      }

      if (ed.isNew) {
        if (empty) return
        const size = measureText(ed.text, ed.fontSize, ed.fontFamily, ed.lineHeight)
        const el = createText(
          ed.x,
          ed.y,
          ed.text,
          size,
          {
            strokeColor: ed.strokeColor,
            opacity: defaults.opacity,
            fontSize: ed.fontSize,
            fontFamily: ed.fontFamily,
            textAlign: ed.textAlign,
          },
          ed.id,
        )
        set({ elements: [...elements, el], selectedIds: [el.id], tool: 'selection' })
        checkpoint('text')
        return
      }
      set({
        elements: reconcile(
          elements,
          mapIfChanged(elements, (e) => {
            if (e.id !== ed.id || !isText(e)) return e
            if (e.text === ed.text) return e
            if (empty) return updateElement(e, { isDeleted: true })
            return reflowText(e, { text: ed.text, originalText: ed.text })
          }),
        ),
        selectedIds: empty ? [] : [ed.id],
      })
      checkpoint('text')
    },

    undo: () => {
      flushNudge()
      const { history } = get()
      if (canUndo(history)) restore(undoHistory(history))
    },
    redo: () => {
      flushNudge()
      const { history } = get()
      if (canRedo(history)) restore(redoHistory(history))
    },

    setSaveError: (saveError) => {
      if (get().saveError !== saveError) set({ saveError })
    },
    setSpaceHeld: (spaceHeld) => {
      if (get().spaceHeld !== spaceHeld) set({ spaceHeld })
    },
    setCursor: (cursor) => {
      if (get().cursor !== cursor) set({ cursor })
    },
    setFileName: (fileName) => set({ fileName }),
    showModal: (modal) => set({ modal }),
    closeModal: () => set({ modal: null }),
    dismissNotice: () => {
      clearTimeout(noticeTimer)
      set({ notice: null })
    },
    notify: (text) => {
      clearTimeout(noticeTimer)
      set({ notice: text })
      noticeTimer = setTimeout(() => set({ notice: null }), 5000)
    },

    load: (scene) => {
      set({
        elements: scene.elements,
        appState: scene.appState,
        files: scene.files,
        viewport: scene.viewport,
        selectedIds: [],
        draft: null,
        pointEdit: null,
        cropping: null,
        editingGroupId: null,
        history: createHistory<Snapshot>({ elements: scene.elements, selectedIds: [] }),
      })
    },

    // Opening a file starts a fresh history and sets the file identity together with the scene.
    openScene: (scene, fileName) => {
      if (nudgeTimer) {
        clearTimeout(nudgeTimer)
        nudgeTimer = undefined
      }
      nudgePending = false
      lastCheckpoint = { reason: '', time: 0 }
      set({
        elements: scene.elements,
        appState: scene.appState,
        files: scene.files,
        viewport: scene.viewport,
        selectedIds: [],
        draft: null,
        cropping: null,
        textEditor: null,
        pointEdit: null,
        bindHighlight: null,
        bindAnchor: null,
        editingGroupId: null,
        erasing: [],
        fileName,
        history: createHistory<Snapshot>({ elements: scene.elements, selectedIds: [] }),
      })
    },
  }
})

// Leaving a group that no longer has live members.
useStore.subscribe((s, prev) => {
  const g = s.editingGroupId
  if (g && s.elements !== prev.elements && !s.elements.some((e) => !e.isDeleted && e.groupIds.includes(g))) {
    useStore.setState({ editingGroupId: null })
  }
})

// A pending flowchart preview only makes sense for the scene and selection it was computed for.
useStore.subscribe((s) => {
  const p = s.flowPreview
  if (!p) return
  const stale =
    p.base !== s.elements ||
    s.selectedIds.length !== 1 ||
    s.selectedIds[0] !== p.sourceId ||
    !!s.modal ||
    !!s.textEditor
  if (stale) useStore.setState({ flowPreview: null })
})
