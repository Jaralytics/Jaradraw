import { beforeEach, describe, expect, it } from 'vitest'
import { createLinear, createShape, createText } from '../element/factory'
import type { LinearElement, SceneElement, TextElement } from '../element/types'
import { attachLabel, bindArrowEnd, bindingTarget, getBoundRefs } from '../element/relations'
import { createLabel, layoutLabel } from '../element/label'
import { createFreedraw, appendFreedrawPoints, finishFreedraw } from '../element/freedraw'
import { fitFreedraw } from '../element/resize'
import { lockWholeGroups, groupElements } from '../element/group'
import { reflowText } from '../element/style'
import { hitTestElement } from '../element/hit'
import { DEFAULT_APP_STATE, parseScene } from './serialize'
import { DEFAULT_VIEWPORT } from './viewport'
import { useStore } from './store'

const st = () => useStore.getState()
const rect = (x: number, y: number, w = 10, h = 10): SceneElement => ({ ...createShape('rectangle', x, y), width: w, height: h })
const load = (elements: readonly SceneElement[]) =>
  st().load({ elements: [...elements], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })

beforeEach(() => load([]))

function boundScene() {
  const a = rect(0, 0, 40, 40)
  const b = rect(200, 0, 40, 40)
  const arrow = { ...createLinear('arrow', 44, 20), points: [[0, 0], [152, 0]] as [number, number][], width: 152 } as LinearElement
  let els: readonly SceneElement[] = [a, b, arrow]
  els = bindArrowEnd(els, arrow.id, 'start', a.id)
  els = bindArrowEnd(els, arrow.id, 'end', b.id)
  return { a, b, arrow, els }
}

describe('arrows bound to shapes outside a transform', () => {
  it('flip detaches an arrow whose shapes are not flipped, keeping relations consistent', () => {
    const { a, arrow, els } = boundScene()
    load(els)
    st().setSelection([arrow.id])
    st().flipSelection('horizontal')
    const out = st().elements
    const ar = out.find((e) => e.id === arrow.id) as LinearElement
    expect(bindingTarget(ar.startBinding)).toBeNull()
    expect(bindingTarget(ar.endBinding)).toBeNull()
    expect(getBoundRefs(out.find((e) => e.id === a.id)!).filter((r) => r.type === 'arrow')).toHaveLength(0)
  })
  it('nudge keeps the bindings when the arrow and its shapes move together', () => {
    const { a, b, arrow, els } = boundScene()
    load(els)
    st().setSelection([a.id, b.id, arrow.id])
    st().nudgeSelection(5, 0)
    const ar = st().elements.find((e) => e.id === arrow.id) as LinearElement
    expect(bindingTarget(ar.startBinding)).toBe(a.id)
    expect(bindingTarget(ar.endBinding)).toBe(b.id)
  })
  it('nudging only the arrow detaches it', () => {
    const { arrow, els } = boundScene()
    load(els)
    st().setSelection([arrow.id])
    st().nudgeSelection(0, 30)
    const ar = st().elements.find((e) => e.id === arrow.id) as LinearElement
    expect(bindingTarget(ar.startBinding)).toBeNull()
    expect(ar.y).toBeCloseTo(arrow.y + 30)
  })
})

describe('locked groups', () => {
  it('locks the whole group when one member is locked', () => {
    const a = { ...rect(0, 0), locked: true }
    const b = rect(20, 0)
    const els = [a, b].map((e) => ({ ...e, groupIds: ['g'] }))
    expect(lockWholeGroups(els).every((e) => e.locked)).toBe(true)
  })
  it('lock toggled on part of an entered group covers the group, and blocks nudge', () => {
    const [a, b] = [rect(0, 0), rect(20, 0)]
    load(groupElements([a, b], [a.id, b.id], 'g'))
    st().setSelection([a.id])
    st().toggleLock()
    expect(st().elements.every((e) => e.locked)).toBe(true)
    st().setSelection([a.id, b.id])
    st().nudgeSelection(10, 0)
    expect(st().elements.map((e) => e.x)).toEqual([0, 20])
  })
  it('normalizes partially locked groups on load', () => {
    const raw = [
      { ...rect(0, 0), id: 'a', locked: true, groupIds: ['g'] },
      { ...rect(5, 0), id: 'b', groupIds: ['g'] },
    ]
    const parsed = parseScene({ elements: raw })!
    expect(parsed.elements.every((e) => e.locked)).toBe(true)
  })
})

describe('loading', () => {
  it('coerces invalid groupIds and angle', () => {
    const parsed = parseScene({
      elements: [
        { id: 'a', type: 'rectangle', groupIds: null, angle: 'x' },
        { id: 'b', type: 'rectangle', groupIds: ['g', 5, null] },
      ],
    })!
    expect(parsed.elements[0].groupIds).toEqual([])
    expect(parsed.elements[0].angle).toBe(0)
    expect(parsed.elements[1].groupIds).toEqual(['g'])
  })
})

describe('freedraw', () => {
  it('does not blow up when resizing a one-click dot', () => {
    const dot = finishFreedraw(createFreedraw(10, 10))
    const out = fitFreedraw(dot, { x: 10, y: 10, width: 80, height: 80 })
    expect(Math.max(...out.points.map((p) => Math.abs(p[0])))).toBeLessThan(1)
  })
  it('skips points closer than the minimum distance and copies once per batch', () => {
    const f = createFreedraw(0, 0)
    const out = appendFreedrawPoints(f, [{ x: 0.1, y: 0 }, { x: 5, y: 0 }, { x: 5.2, y: 0 }, { x: 10, y: 0 }], 0.5)
    expect(out.points).toEqual([[0, 0], [5, 0], [10, 0]])
    expect(f.points).toHaveLength(1)
  })
  it('prefilters hit tests by bounds', () => {
    let f = createFreedraw(0, 0)
    f = appendFreedrawPoints(f, [{ x: 100, y: 0 }])
    expect(hitTestElement(f, 50, 1, 2)).toBe(true)
    expect(hitTestElement(f, 500, 0, 2)).toBe(false)
  })
})

describe('labels', () => {
  it('does not produce a new label version when groupIds are equal by content', () => {
    const box = { ...rect(0, 0, 100, 50), groupIds: ['g'] }
    const made = createLabel(box, 'hola')
    const copy = { ...made.label, groupIds: ['g'] }
    const r = layoutLabel(made.container, copy)
    expect(r.label).toBe(copy)
  })
})

describe('text controls', () => {
  const text = (): TextElement => createText(100, 0, 'abcd', { width: 48, height: 25 }, { fontSize: 20 })
  it('keeps the anchor according to alignment when the font size changes', () => {
    const t = text()
    const left = reflowText(t, { fontSize: 36, textAlign: 'left' })
    expect(left.x).toBe(100)
    expect(left.fontSize).toBe(36)
    expect(left.width).toBeGreaterThan(t.width)
    const center = reflowText(t, { fontSize: 36, textAlign: 'center' })
    expect(center.x + center.width / 2).toBeCloseTo(100 + 24)
    const right = reflowText(t, { fontSize: 36, textAlign: 'right' })
    expect(right.x + right.width).toBeCloseTo(148)
  })
  it('applies size and alignment to free text and labels as one undo entry, and to the defaults', () => {
    const box = rect(0, 0, 200, 100)
    const made = createLabel(box, 'hola mundo')
    const els = attachLabel([made.container], made.container, made.label)
    const free = text()
    load([...els, free])
    st().setSelection([box.id, free.id])
    const before = st().history.stack.length
    st().applyStyle({ fontSize: 28, textAlign: 'right' })
    const out = st().elements
    const label = out.find((e) => e.id === made.label.id) as TextElement
    const f = out.find((e) => e.id === free.id) as TextElement
    expect([label.fontSize, f.fontSize]).toEqual([28, 28])
    expect([label.textAlign, f.textAlign]).toEqual(['right', 'right'])
    expect(label.width).toBeGreaterThan(made.label.width)
    expect(st().defaults.fontSize).toBe(28)
    expect(st().history.stack.length).toBe(before + 1)
  })
})
