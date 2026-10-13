import { beforeEach, describe, expect, it } from 'vitest'
import { createShape } from '../element/factory'
import { createLabel } from '../element/label'
import { attachLabel, bindingTarget, getBoundRefs, getLabel } from '../element/relations'
import {
  FLOW_GAP,
  MAX_FLOW_COUNT,
  planConnectedNodes,
  connectNodes,
  convertNodeTypes,
  findFreeSlot,
  nearestConnected,
  nextShapeType,
  revealBox,
  targetPosition,
} from '../element/flowchart'
import { DEFAULT_STYLE_DEFAULTS } from '../element/style'
import { getElementBounds } from '../element/geometry'
import type { LinearElement, SceneElement } from '../element/types'
import { DEFAULT_APP_STATE, withGrid } from './serialize'
import { DEFAULT_VIEWPORT } from './viewport'
import { useStore } from './store'
import { SHORTCUTS, bindingsConflict, matchesBinding } from '../ui/shortcuts'

const st = () => useStore.getState()
const live = () => st().elements.filter((e) => !e.isDeleted)
const VIEW = { width: 1000, height: 700 }

/** Ctrl+arrow pressed n times, then Ctrl released. */
const flow = (dir: 'left' | 'right' | 'up' | 'down', n = 1) => {
  for (let i = 0; i < n; i++) st().previewConnectedNodes(dir, VIEW)
  return st().commitFlowPreview(VIEW)
}

const node = (x: number, y: number, type: 'rectangle' | 'ellipse' | 'diamond' = 'rectangle', w = 160, h = 80) => ({
  ...createShape(type, x, y, { strokeColor: '#c92a2a', backgroundColor: '#ffc9c9', strokeWidth: 4, opacity: 70 }),
  width: w,
  height: h,
})

beforeEach(() => {
  st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
})

function seed(el: SceneElement) {
  st().commitDraft(el)
  return el
}

describe('placement', () => {
  it('centers on the source line with a 100 px gap in every direction', () => {
    const s = node(100, 100)
    expect(targetPosition(s, 'right')).toEqual({ x: 260 + FLOW_GAP, y: 100 })
    expect(targetPosition(s, 'left')).toEqual({ x: 100 - FLOW_GAP - 160, y: 100 })
    expect(targetPosition(s, 'down')).toEqual({ x: 100, y: 180 + FLOW_GAP })
    expect(targetPosition(s, 'up')).toEqual({ x: 100, y: 100 - FLOW_GAP - 80 })
  })

  it('takes the straight slot when free and alternates sides when occupied', () => {
    const s = node(0, 0)
    const free = findFreeSlot([s], s, 'right', null)
    expect(free).toEqual({ x: 260, y: 0 })
    const first = node(free.x, free.y)
    const second = findFreeSlot([s, first], s, 'right', null)
    expect(second).toEqual({ x: 260, y: 120 })
    const third = findFreeSlot([s, first, node(second.x, second.y)], s, 'right', null)
    expect(third).toEqual({ x: 260, y: -120 })
    const vertical = findFreeSlot([s, node(0, 180)], s, 'down', null)
    expect(vertical).toEqual({ x: 200, y: 180 })
  })

  it('snaps to the grid and gives up after the limit', () => {
    const s = node(3, 7)
    const p = findFreeSlot([s], s, 'right', 20)
    expect(p.x % 20).toBe(0)
    expect(p.y % 20).toBe(0)
    const wall = node(200, -5000, 'rectangle', 600, 10000)
    expect(() => findFreeSlot([s, wall], s, 'right', null)).not.toThrow()
  })
})

describe('planConnectedNodes', () => {
  const plan = (els: readonly SceneElement[], src: SceneElement, dir: 'left' | 'right' | 'up' | 'down', n: number, grid: number | null = null) =>
    planConnectedNodes(els, src as ReturnType<typeof node>, dir, n, DEFAULT_STYLE_DEFAULTS, grid)
  const created = (p: ReturnType<typeof plan>) => p.nodeIds.map((id) => p.elements.find((e) => e.id === id)!)

  it('copies style but not the label, and binds each arrow both ways', () => {
    const base = node(0, 0, 'diamond')
    const withRound = { ...base, roundness: { type: 2 } }
    const lab = createLabel(withRound, 'Inicio')
    const src = lab.container
    const els = attachLabel([src], src, lab.label)
    const out = plan(els, src, 'right', 1)
    const [n] = created(out)
    const arrow = out.elements.find((e) => e.id === out.arrowIds[0]) as LinearElement
    expect(n.type).toBe('diamond')
    expect([n.width, n.height, n.angle]).toEqual([src.width, src.height, 0])
    expect([n.strokeColor, n.backgroundColor, n.strokeWidth, n.opacity, n.roundness]).toEqual([
      '#c92a2a',
      '#ffc9c9',
      4,
      70,
      { type: 2 },
    ])
    expect(getLabel(out.elements, n.id)).toBeUndefined()
    expect(n.boundElements).toEqual([{ type: 'arrow', id: arrow.id }])
    expect(bindingTarget(arrow.startBinding)).toBe(src.id)
    expect(bindingTarget(arrow.endBinding)).toBe(n.id)
    expect(arrow.endArrowhead).toBe('arrow')
    expect(arrow.x).toBeGreaterThan(src.x + src.width / 2)
    expect(arrow.x + arrow.points[1][0]).toBeLessThan(n.x + n.width / 2)
  })

  it('lays out 1 to 4 children centered on the source line in every direction', () => {
    const s = node(0, 0)
    const cx = s.x + s.width / 2
    const cy = s.y + s.height / 2
    for (const dir of ['left', 'right', 'up', 'down'] as const) {
      const horizontal = dir === 'left' || dir === 'right'
      const size = horizontal ? s.height : s.width
      for (let n = 1; n <= 4; n++) {
        const out = plan([s], s, dir, n)
        const kids = created(out)
        expect(kids).toHaveLength(n)
        expect(out.arrowIds).toHaveLength(n)
        const centers = kids.map((k) => (horizontal ? k.y + k.height / 2 : k.x + k.width / 2)).sort((x, y) => x - y)
        const line = horizontal ? cy : cx
        expect(centers.reduce((a, c) => a + c, 0) / n).toBeCloseTo(line)
        for (let i = 1; i < n; i++) expect(centers[i] - centers[i - 1]).toBeCloseTo(size + 40)
        const dist = kids.map((k) => (dir === 'right' ? k.x - 160 : dir === 'left' ? -k.x - k.width : dir === 'down' ? k.y - 80 : -k.y - k.height))
        for (const d of dist) expect(d).toBe(FLOW_GAP)
        const primary = kids.find((k) => k.id === out.primaryId)!
        const off = Math.abs((horizontal ? primary.y + primary.height / 2 : primary.x + primary.width / 2) - line)
        expect(off).toBeLessThanOrEqual((size + 40) / 2 + 1e-6)
        if (n % 2 === 1) expect(off).toBeCloseTo(0)
      }
    }
  })

  it('binds every arrow both ways and caps the count', () => {
    const s = node(0, 0)
    const out = plan([s], s, 'up', 20)
    expect(MAX_FLOW_COUNT).toBe(9)
    expect(out.nodeIds).toHaveLength(9)
    const source = out.elements.find((e) => e.id === s.id)!
    for (let i = 0; i < 9; i++) {
      const arrow = out.elements.find((e) => e.id === out.arrowIds[i]) as LinearElement
      expect(bindingTarget(arrow.startBinding)).toBe(s.id)
      expect(bindingTarget(arrow.endBinding)).toBe(out.nodeIds[i])
      expect(getBoundRefs(source).some((r) => r.id === arrow.id)).toBe(true)
      expect(getBoundRefs(out.elements.find((e) => e.id === out.nodeIds[i])!).some((r) => r.id === arrow.id)).toBe(true)
    }
  })

  it('snaps every slot to the grid', () => {
    const s = node(3, 7)
    for (const n of [1, 2, 3]) {
      for (const k of created(plan([s], s, 'down', n, 20))) {
        expect(Math.abs(k.x % 20)).toBe(0)
        expect(Math.abs(k.y % 20)).toBe(0)
      }
    }
  })

  it('falls back to free alternating slots and never overlaps existing shapes', () => {
    const s = node(0, 0)
    const child = node(260, 0)
    const out = plan([s, child], s, 'right', 2)
    const kids = created(out)
    expect(kids.map((k) => k.y).sort((a, b) => a - b)).toEqual([-120, 120])
    expect(kids.every((k) => k.x === 260)).toBe(true)
    expect(out.primaryId).toBe(kids.find((k) => k.y === 120)!.id)
    const boxes = [getElementBounds(child), ...kids.map((k) => getElementBounds(k))]
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [p, q] = [boxes[i], boxes[j]]
        expect(p[0] < q[2] && p[2] > q[0] && p[1] < q[3] && p[3] > q[1]).toBe(false)
      }
  })

  it('keeps the centered layout when only a far shape is around', () => {
    const s = node(0, 0)
    const far = node(260, 1000)
    const kids = created(plan([s, far], s, 'right', 2))
    expect(kids.map((k) => k.y).sort((a, b) => a - b)).toEqual([-60, 60])
  })
})

describe('store actions', () => {
  it('creates node and arrow as one history entry and selects the node', () => {
    const a = seed(node(0, 0))
    st().setSelection([a.id])
    const before = st().history.stack.length
    expect(flow('right')).toBe(true)
    expect(st().history.stack.length).toBe(before + 1)
    expect(live()).toHaveLength(3)
    const n = live().find((e) => e.type === 'rectangle' && e.id !== a.id)!
    expect(st().selectedIds).toEqual([n.id])
    st().undo()
    expect(live()).toHaveLength(1)
    st().redo()
    expect(live()).toHaveLength(3)
  })

  it('does nothing with no, several or non-node selection and for locked nodes', () => {
    const a = seed(node(0, 0))
    const b = seed(node(400, 0))
    st().setSelection([])
    expect(flow('right')).toBe(false)
    st().setSelection([a.id, b.id])
    expect(flow('right')).toBe(false)
    st().setSelection([a.id])
    st().toggleLock()
    expect(flow('right')).toBe(false)
    expect(live()).toHaveLength(2)
  })

  it('places a second child beside the first', () => {
    const a = seed(node(0, 0))
    st().setSelection([a.id])
    flow('right')
    st().setSelection([a.id])
    flow('right')
    const kids = live().filter((e) => e.type === 'rectangle' && e.id !== a.id)
    expect(kids).toHaveLength(2)
    expect(kids[0].x).toBe(kids[1].x)
    expect(kids[1].y).toBeGreaterThanOrEqual(kids[0].y + kids[0].height)
  })

  it('snaps to the grid when it is on', () => {
    st().load({ elements: [], appState: withGrid(DEFAULT_APP_STATE, true), files: {}, viewport: DEFAULT_VIEWPORT })
    const a = seed(node(3, 7))
    st().setSelection([a.id])
    flow('down')
    const n = live().find((e) => e.id === st().selectedIds[0])!
    expect(n.x % 20).toBe(0)
    expect(n.y % 20).toBe(0)
  })

  it('pans the viewport only when the new node is out of view', () => {
    const a = seed(node(0, 100))
    st().setViewport({ ...DEFAULT_VIEWPORT, scrollX: 20, scrollY: 0 })
    st().setSelection([a.id])
    flow('right')
    expect(st().viewport.scrollX).toBe(20)
    for (let i = 0; i < 6; i++) flow('right')
    const last = live().find((e) => e.id === st().selectedIds[0])!
    expect((last.x + last.width + st().viewport.scrollX) * st().viewport.zoom).toBeLessThanOrEqual(VIEW.width - 60 + 1e-6)
    expect(st().viewport.zoom).toBe(1)
  })

  it('selects the connected node in a direction without touching history', () => {
    const a = seed(node(0, 0))
    st().setSelection([a.id])
    flow('right')
    const child = st().selectedIds[0]
    st().setSelection([a.id])
    flow('down')
    const down = st().selectedIds[0]
    const entries = st().history.stack.length
    st().setSelection([a.id])
    expect(st().selectConnected('right', VIEW)).toBe(true)
    expect(st().selectedIds).toEqual([child])
    st().setSelection([a.id])
    st().selectConnected('down', VIEW)
    expect(st().selectedIds).toEqual([down])
    // arrows work in either direction: back from the child to the source
    st().setSelection([child])
    st().selectConnected('left', VIEW)
    expect(st().selectedIds).toEqual([a.id])
    st().selectConnected('up', VIEW)
    expect(st().selectedIds).toEqual([a.id])
    expect(st().history.stack.length).toBe(entries)
  })

  it('cycles types with one entry per press and keeps ids, labels and bindings', () => {
    const a = seed({ ...node(0, 0), roundness: { type: 3 } })
    const made = createLabel(st().elements[0], 'Validar los datos de entrada')
    st().replaceElements([made.container])
    st().restoreElements(attachLabel(st().elements, made.container, made.label))
    st().setSelection([a.id])
    flow('right')
    const kid = live().find((e) => e.id !== a.id && e.type === 'rectangle')!
    st().replaceElements([{ ...kid, y: kid.y + 250 }])
    st().setSelection([a.id])
    const arrowBefore = live().find((e) => e.type === 'arrow') as LinearElement
    const entries = st().history.stack.length
    expect(st().cycleNodeTypes(false)).toBe(true)
    expect(st().history.stack.length).toBe(entries + 1)
    let cur = live().find((e) => e.id === a.id)!
    expect(cur.type).toBe('diamond')
    expect(cur.roundness).toEqual({ type: 2 })
    expect(getLabel(st().elements, a.id)?.originalText).toBe('Validar los datos de entrada')
    expect(getBoundRefs(cur).filter((r) => r.type === 'arrow')).toHaveLength(1)
    const arrowAfter = live().find((e) => e.type === 'arrow') as LinearElement
    expect(bindingTarget(arrowAfter.startBinding)).toBe(a.id)
    expect([arrowAfter.x, arrowAfter.y]).not.toEqual([arrowBefore.x, arrowBefore.y])
    st().cycleNodeTypes(false)
    cur = live().find((e) => e.id === a.id)!
    expect(cur.type).toBe('ellipse')
    expect(cur.roundness).toBeNull()
    st().cycleNodeTypes(true)
    expect(live().find((e) => e.id === a.id)!.type).toBe('diamond')
    st().undo()
    expect(live().find((e) => e.id === a.id)!.type).toBe('ellipse')
  })

  it('re-wraps the label for the new inner width', () => {
    const a = seed(node(0, 0, 'rectangle', 200, 60))
    const made = createLabel(a, 'una etiqueta bastante larga para envolver')
    st().restoreElements(attachLabel([made.container], made.container, made.label))
    const wrapBefore = getLabel(st().elements, a.id)!.text.split('\n').length
    st().setSelection([a.id])
    st().cycleNodeTypes(false)
    const after = getLabel(st().elements, a.id)!
    expect(after.originalText).toBe('una etiqueta bastante larga para envolver')
    expect(after.text.split('\n').length).toBeGreaterThan(wrapBefore)
  })

  it('does not convert locked nodes or non-nodes', () => {
    const a = seed(node(0, 0))
    st().setSelection([a.id])
    st().toggleLock()
    expect(st().cycleNodeTypes(false)).toBe(false)
  })
})

describe('flow preview in the store', () => {
  it('shows pending nodes without touching elements, history or selection', () => {
    const a = seed(node(0, 0))
    st().setSelection([a.id])
    const els = st().elements
    const entries = st().history.stack.length
    expect(st().previewConnectedNodes('right', VIEW)).toBe(true)
    expect(st().elements).toBe(els)
    expect(st().history.stack.length).toBe(entries)
    expect(st().selectedIds).toEqual([a.id])
    expect(st().flowPreview?.plan.nodeIds).toHaveLength(1)
    st().previewConnectedNodes('right', VIEW)
    expect(st().flowPreview?.count).toBe(2)
    expect(st().elements).toBe(els)
  })

  it('commits all pending nodes as one entry and selects the first', () => {
    const a = seed(node(0, 0))
    st().setSelection([a.id])
    const entries = st().history.stack.length
    expect(flow('up', 3)).toBe(true)
    expect(st().flowPreview).toBeNull()
    expect(st().history.stack.length).toBe(entries + 1)
    expect(live()).toHaveLength(7)
    const sel = live().find((e) => e.id === st().selectedIds[0])!
    expect(sel.x).toBe(0)
    st().undo()
    expect(live()).toHaveLength(1)
    st().redo()
    expect(live()).toHaveLength(7)
  })

  it('a new direction starts over with one node', () => {
    const a = seed(node(0, 0))
    st().setSelection([a.id])
    st().previewConnectedNodes('up', VIEW)
    st().previewConnectedNodes('up', VIEW)
    st().previewConnectedNodes('down', VIEW)
    expect(st().flowPreview?.count).toBe(1)
    expect(st().flowPreview?.dir).toBe('down')
    st().commitFlowPreview(VIEW)
    expect(live()).toHaveLength(3)
    expect(live().filter((e) => e.type === 'rectangle' && e.y < 0)).toHaveLength(0)
  })

  it('caps the count at 9', () => {
    const a = seed(node(0, 0))
    st().setSelection([a.id])
    for (let i = 0; i < 12; i++) st().previewConnectedNodes('right', VIEW)
    expect(st().flowPreview?.count).toBe(9)
  })

  it('cancel discards the preview and restores the viewport', () => {
    const a = seed(node(0, 100))
    st().setViewport({ ...DEFAULT_VIEWPORT, scrollX: 20, scrollY: 0 })
    st().setSelection([a.id])
    const before = st().viewport
    const entries = st().history.stack.length
    for (let i = 0; i < 6; i++) st().previewConnectedNodes('up', VIEW)
    expect(st().viewport.scrollX).not.toBe(before.scrollX)
    st().cancelFlowPreview()
    expect(st().flowPreview).toBeNull()
    expect(st().viewport).toEqual(before)
    expect(live()).toHaveLength(1)
    expect(st().history.stack.length).toBe(entries)
  })

  it('discards a stale preview when selection or elements change', () => {
    const a = seed(node(0, 0))
    const b = seed(node(0, 500))
    st().setSelection([a.id])
    st().previewConnectedNodes('right', VIEW)
    st().setSelection([b.id])
    expect(st().flowPreview).toBeNull()
    st().previewConnectedNodes('right', VIEW)
    st().replaceElements([{ ...st().elements[1], x: 5 }])
    expect(st().flowPreview).toBeNull()
  })

  it('commit after the scene changed does nothing instead of inserting a stale plan', () => {
    const a = seed(node(0, 0))
    st().setSelection([a.id])
    st().previewConnectedNodes('right', VIEW)
    st().replaceElements([{ ...a, x: 5 }])
    expect(st().commitFlowPreview(VIEW)).toBe(false)
    expect(live()).toHaveLength(1)
  })

  it('does nothing with no, several or locked selection', () => {
    const a = seed(node(0, 0))
    const b = seed(node(400, 0))
    st().setSelection([])
    expect(st().previewConnectedNodes('right', VIEW)).toBe(false)
    st().setSelection([a.id, b.id])
    expect(st().previewConnectedNodes('right', VIEW)).toBe(false)
    st().setSelection([a.id])
    st().toggleLock()
    expect(st().previewConnectedNodes('right', VIEW)).toBe(false)
    expect(st().flowPreview).toBeNull()
    expect(st().commitFlowPreview(VIEW)).toBe(false)
  })
})

describe('pure helpers', () => {
  it('nextShapeType cycles both ways', () => {
    expect(['rectangle', 'diamond', 'ellipse', 'rectangle'].map((t, i, all) => (i ? nextShapeType(all[i - 1] as 'rectangle') : t))).toEqual([
      'rectangle',
      'diamond',
      'ellipse',
      'rectangle',
    ])
    expect(nextShapeType('rectangle', true)).toBe('ellipse')
  })

  it('ellipse leaving the cycle uses the fallback edges', () => {
    const e = node(0, 0, 'ellipse')
    const out = convertNodeTypes([e], new Set([e.id]), false, 'round')
    expect(out[0].type).toBe('rectangle')
    expect(out[0].roundness).toEqual({ type: 3 })
  })

  it('picks the smallest angle, then the nearest', () => {
    const a = node(0, 0)
    st().commitDraft(a)
    st().setSelection([a.id])
    flow('right')
    const right = live().find((e) => e.id === st().selectedIds[0])!
    st().setSelection([a.id])
    flow('right')
    const other = live().find((e) => e.id === st().selectedIds[0])!
    // the first child is level with the source, the second one lies lower: angle decides
    expect(nearestConnected(st().elements, a.id, 'right')?.id).toBe(right.id)
    expect(other.y).toBeGreaterThan(right.y)
  })

  it('revealBox keeps the zoom and returns the same viewport when visible', () => {
    const vp = { scrollX: 0, scrollY: 0, zoom: 2 }
    expect(revealBox(vp, { x: 100, y: 100, width: 50, height: 50 }, 1000, 700)).toBe(vp)
    const moved = revealBox(vp, { x: 600, y: 10, width: 50, height: 50 }, 1000, 700)
    expect(moved.zoom).toBe(2)
    expect((600 + 50 + moved.scrollX) * 2).toBeCloseTo(940)
  })
})

describe('shortcut registry for the flow', () => {
  const key = (init: Partial<KeyboardEvent> & { key: string }) => init as KeyboardEvent
  const handlers = (e: KeyboardEvent) => SHORTCUTS.filter((s) => s.keys.some((b) => matchesBinding(b, e))).map((s) => s.id)

  it('has no conflicts, no punctuation codes, and z-order moved to PageUp/PageDown', () => {
    const all = SHORTCUTS.flatMap((s) => s.keys.map((b) => ({ id: s.id, b })))
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(bindingsConflict(all[i].b, all[j].b), `${all[i].id} vs ${all[j].id}`).toBe(false)
    }
    for (const { b } of all) if (b.code) expect(b.code).toMatch(/^Key[A-Z]$/)
    const ev = (k: string, mods: Partial<KeyboardEvent> = {}) =>
      key({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })
    expect(handlers(ev('PageUp'))).toEqual(['edit.forward'])
    expect(handlers(ev('PageDown', { shiftKey: true }))).toEqual(['edit.back'])
    expect(handlers(ev('ArrowUp', { ctrlKey: true }))).toEqual(['flow.createNode'])
    expect(handlers(ev('ArrowDown', { ctrlKey: true, shiftKey: true }))).toEqual([])
    expect(handlers(ev('ArrowLeft', { ctrlKey: true, shiftKey: true }))).toEqual(['edit.alignLeft'])
    expect(handlers(ev('ArrowRight', { altKey: true, shiftKey: true }))).toEqual(['flow.goToNode'])
    expect(handlers(ev('ArrowRight', { altKey: true }))).toEqual([])
    expect(handlers(ev('ArrowRight'))).toEqual(['edit.nudge'])
    expect(handlers(ev('Tab'))).toEqual(['flow.cycleType'])
    expect(handlers(ev('Tab', { shiftKey: true }))).toEqual(['flow.cycleType'])
    expect(handlers(ev('Enter'))).toEqual(['edit.editText'])
  })
})

describe('bounds sanity', () => {
  it('new nodes never overlap their siblings', () => {
    const a = seed(node(0, 0))
    st().setSelection([a.id])
    for (let i = 0; i < 4; i++) {
      st().setSelection([a.id])
      flow('right')
    }
    const boxes = live().filter((e) => e.type === 'rectangle').map((e) => getElementBounds(e))
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [p, q] = [boxes[i], boxes[j]]
        expect(p[0] < q[2] && p[2] > q[0] && p[1] < q[3] && p[3] > q[1]).toBe(false)
      }
  })
})

describe('connectNodes', () => {
  it('adds one arrow bound both ways between two separate nodes', () => {
    const a = node(0, 0)
    const b = node(400, 0)
    const made = connectNodes([a, b], a.id, b.id, DEFAULT_STYLE_DEFAULTS)
    expect(made).not.toBeNull()
    const arrow = made!.elements.find((e) => e.id === made!.arrowId) as LinearElement
    expect(bindingTarget(arrow.startBinding)).toBe(a.id)
    expect(bindingTarget(arrow.endBinding)).toBe(b.id)
    for (const id of [a.id, b.id]) {
      const shape = made!.elements.find((e) => e.id === id)!
      expect(getBoundRefs(shape).some((r) => r.id === arrow.id)).toBe(true)
    }
  })

  it('refuses overlapping nodes, the same node and non-nodes', () => {
    const a = node(0, 0)
    const close = node(40, 20)
    const locked = { ...node(400, 0), locked: true }
    expect(connectNodes([a, close], a.id, close.id, DEFAULT_STYLE_DEFAULTS)).toBeNull()
    expect(connectNodes([a], a.id, a.id, DEFAULT_STYLE_DEFAULTS)).toBeNull()
    expect(connectNodes([a, locked], a.id, locked.id, DEFAULT_STYLE_DEFAULTS)).toBeNull()
  })
})
