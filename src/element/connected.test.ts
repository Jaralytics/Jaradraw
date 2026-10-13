import { describe, expect, it } from 'vitest'
import { createLinear, createShape } from './factory'
import type { LinearElement, SceneElement, TextElement } from './types'
import { wrapText, textWidth } from './text'
import { computeLabelLayout, createLabel, innerWidth } from './label'
import { outlinePointToward, findBindTarget } from './bind'
import { attachLabel, bindArrowEnd, reconcile, recomputeBoundEnds, sanitizeRelations, getBoundRefs } from './relations'
import { elementsInRect } from './group'
import { parseClipboard, serializeClipboard } from '../scene/clipboard'
import { cloneElements } from './clone'
import { normalizeArrowhead } from './arrowhead'
import { insertMidpoint, removePoint } from './points'
import { withAbsolutePoints, getElementBox } from './geometry'
import { hitTestElement } from './hit'
import { moveElement } from './resize'
import { bezierAt, getCurveSegments } from './path'
import { updateElement } from './factory'

const rect = (x: number, y: number, w: number, h: number, type: 'rectangle' | 'ellipse' | 'diamond' = 'rectangle') => ({
  ...createShape(type, x, y),
  width: w,
  height: h,
})

describe('wrapText', () => {
  it('wraps to the width limit without trailing spaces', () => {
    // fallback metric: 12 px per character at size 20
    const out = wrapText('aaa bbb ccc', 80, 20, 2)
    expect(out).toBe('aaa\nbbb\nccc')
    for (const line of out.split('\n')) expect(textWidth(line, 20, 2)).toBeLessThanOrEqual(80)
  })

  it('breaks words longer than the limit and keeps explicit newlines', () => {
    expect(wrapText('abcdefghij', 60, 20, 2)).toBe('abcde\nfghij')
    expect(wrapText('a\n\nb', 200, 20, 2)).toBe('a\n\nb')
  })
})

describe('label placement', () => {
  it('keeps originalText and centers the block in a rectangle', () => {
    const c = rect(100, 100, 200, 100)
    const { container, label } = createLabel(c, 'hola mundo')
    expect(label.originalText).toBe('hola mundo')
    expect(label.containerId).toBe(c.id)
    expect(label.textAlign).toBe('center')
    expect(label.x + label.width / 2).toBeCloseTo(200)
    expect(label.y + label.height / 2).toBeCloseTo(150)
    expect(container).toBe(c)
  })

  it('uses smaller inner widths for ellipses and diamonds', () => {
    expect(innerWidth(rect(0, 0, 200, 100))).toBe(190)
    expect(innerWidth(rect(0, 0, 200, 100, 'ellipse'))).toBeCloseTo(200 * Math.SQRT1_2 - 10)
    expect(innerWidth(rect(0, 0, 200, 100, 'diamond'))).toBe(90)
  })

  it('grows the container height when the text does not fit', () => {
    const c = rect(0, 0, 60, 20)
    const { container, label } = createLabel(c, 'uno dos tres cuatro')
    expect(container.height).toBeGreaterThan(20)
    expect(label.y + label.height / 2).toBeCloseTo(container.y + container.height / 2)
    const l = computeLabelLayout(container, label)
    expect(l.containerHeight).toBeNull()
  })
})

describe('outline intersection', () => {
  const c = { x: 0, y: 0 }
  it('rectangle, ellipse and diamond', () => {
    const r = outlinePointToward(rect(0, 0, 100, 50), { x: 300, y: 25 }, 0)
    expect(r.x).toBeCloseTo(100)
    expect(r.y).toBeCloseTo(25)
    const e = outlinePointToward(rect(0, 0, 100, 50, 'ellipse'), { x: 50, y: -200 }, 0)
    expect(e.x).toBeCloseTo(50)
    expect(e.y).toBeCloseTo(0)
    const d = outlinePointToward(rect(0, 0, 100, 100, 'diamond'), { x: 300, y: 50 }, 0)
    expect(d.x).toBeCloseTo(100)
    void c
  })

  it('honors the shape angle', () => {
    const r = { ...rect(0, 0, 100, 20), angle: Math.PI / 2 }
    // rotated a quarter turn: the 100 wide side now faces up and down
    const p = outlinePointToward(r, { x: 50, y: 500 }, 0)
    expect(p.x).toBeCloseTo(50)
    expect(p.y).toBeCloseTo(60)
  })

  it('finds bind targets inside or within 10 px', () => {
    const r = rect(0, 0, 100, 100)
    expect(findBindTarget([r], 50, 50)?.id).toBe(r.id)
    expect(findBindTarget([r], 108, 50)?.id).toBe(r.id)
    expect(findBindTarget([r], 125, 50)).toBeNull()
  })
})

function arrowBetween(a: SceneElement, b: SceneElement) {
  const arrow = {
    ...createLinear('arrow', 100, 25),
    points: [[0, 0], [200, 0]] as LinearElement['points'],
    width: 200,
    height: 0,
  } as LinearElement
  let els: readonly SceneElement[] = [a, b, arrow]
  els = bindArrowEnd(els, arrow.id, 'start', a.id)
  els = bindArrowEnd(els, arrow.id, 'end', b.id)
  return { arrow, els: reconcile([a, b, arrow], els) }
}

describe('arrow binding', () => {
  it('writes both sides and keeps the endpoint on the outline', () => {
    const a = rect(0, 0, 100, 50)
    const b = rect(300, 0, 100, 50)
    const { arrow, els } = arrowBetween(a, b)
    const ar = els.find((e) => e.id === arrow.id) as LinearElement
    expect(ar.startBinding).toMatchObject({ elementId: a.id, focus: 0, fixedPoint: null })
    expect(typeof (ar.startBinding as { gap: number }).gap).toBe('number')
    expect(getBoundRefs(els.find((e) => e.id === a.id) as SceneElement)).toEqual([{ type: 'arrow', id: arrow.id }])
    expect(ar.x).toBeGreaterThanOrEqual(100)
    expect(ar.x).toBeLessThan(110)
    expect(ar.x + ar.points[1][0]).toBeLessThanOrEqual(300)
  })

  it('recomputes bound endpoints when a shape moves', () => {
    const a = rect(0, 0, 100, 50)
    const b = rect(300, 0, 100, 50)
    const { arrow, els } = arrowBetween(a, b)
    const moved = els.map((e) => (e.id === b.id ? moveElement(e, 0, 200) : e))
    const out = reconcile(els, moved)
    const ar = out.find((e) => e.id === arrow.id) as LinearElement
    expect(ar.points[1][1]).toBeGreaterThan(50)
    expect(ar.points[0]).toEqual([0, 0])
  })

  it('clears bindings when a shape is deleted and removes refs when the arrow is deleted', () => {
    const a = rect(0, 0, 100, 50)
    const b = rect(300, 0, 100, 50)
    const { arrow, els } = arrowBetween(a, b)
    const delB = reconcile(els, els.map((e) => (e.id === b.id ? updateElement(e, { isDeleted: true }) : e)))
    const ar = delB.find((e) => e.id === arrow.id) as LinearElement
    expect(ar.endBinding).toBeNull()
    expect(ar.startBinding).not.toBeNull()
    const delA = reconcile(els, els.map((e) => (e.id === arrow.id ? updateElement(e, { isDeleted: true }) : e)))
    for (const id of [a.id, b.id]) expect(delA.find((e) => e.id === id)!.boundElements).toBeNull()
  })

  it('keeps bindings in clones only when both sides are copied', () => {
    const a = rect(0, 0, 100, 50)
    const b = rect(300, 0, 100, 50)
    const { arrow, els } = arrowBetween(a, b)
    const both = cloneElements(els, 10, 10)
    const ca = both[2] as LinearElement
    expect((ca.startBinding as { elementId: string }).elementId).toBe(both[0].id)
    expect(getBoundRefs(both[0])[0].id).toBe(ca.id)
    const only = cloneElements(els.filter((e) => e.id !== b.id), 0, 0)
    const half = only[1] as LinearElement
    expect(half.endBinding).toBeNull()
    expect(half.startBinding).not.toBeNull()
    const lone = cloneElements([els.find((e) => e.id === arrow.id)!], 0, 0)[0] as LinearElement
    expect(lone.startBinding).toBeNull()
    expect(cloneElements([els[0]], 0, 0)[0].boundElements).toBeNull()
  })

  it('drops dangling relations when loading', () => {
    const a = { ...rect(0, 0, 100, 50), boundElements: [{ type: 'arrow', id: 'ghost' }, { type: 'text', id: 'ghost2' }] }
    const arrow = { ...createLinear('arrow', 0, 0), startBinding: { elementId: 'gone', focus: 0.3, gap: 1 } }
    const text = { ...(createLabel(rect(0, 0, 10, 10), 'x').label), containerId: 'nowhere' } as TextElement
    const out = sanitizeRelations([a, arrow, text])
    expect(out[0].boundElements).toBeNull()
    expect((out[1] as LinearElement).startBinding).toBeNull()
    expect((out[2] as TextElement).containerId).toBeNull()
  })

  it('keeps foreign focus values until the endpoint is recomputed', () => {
    const a = rect(0, 0, 100, 50)
    const arrow = {
      ...createLinear('arrow', 100, 25),
      points: [[0, 0], [100, 0]] as LinearElement['points'],
      startBinding: { elementId: a.id, focus: 0.4, gap: 8, fixedPoint: null },
    } as LinearElement
    const loaded = sanitizeRelations([a, arrow])
    expect((loaded[1] as LinearElement).startBinding).toMatchObject({ focus: 0.4, gap: 8 })
    expect(getBoundRefs(loaded[0])).toHaveLength(1)
  })
})

describe('bound labels follow containers', () => {
  it('moves, deletes and clones with the container', () => {
    const c = rect(0, 0, 200, 100)
    const made = createLabel(c, 'texto')
    const els = attachLabel([c], made.container, made.label)
    const moved = reconcile(els, els.map((e) => (e.id === c.id ? moveElement(e, 50, 20) : e)))
    const label = moved[1] as TextElement
    expect(label.x + label.width / 2).toBeCloseTo(150)
    const deleted = reconcile(moved, moved.map((e) => (e.id === c.id ? updateElement(e, { isDeleted: true }) : e)))
    expect(deleted[1].isDeleted).toBe(true)
    const copies = cloneElements(els, 0, 0)
    expect((copies[1] as TextElement).containerId).toBe(copies[0].id)
    expect(getBoundRefs(copies[0])[0].id).toBe(copies[1].id)
    expect((cloneElements([els[1]], 0, 0)[0] as TextElement).containerId).toBeNull()
  })
})

describe('arrowheads', () => {
  it('maps stored values to drawn kinds', () => {
    expect(normalizeArrowhead(null)).toBeNull()
    expect(normalizeArrowhead('dot')).toBe('circle')
    expect(normalizeArrowhead('triangle_outline')).toBe('triangle')
    expect(normalizeArrowhead('circle_outline')).toBe('circle')
    expect(normalizeArrowhead('bar')).toBe('bar')
    expect(normalizeArrowhead('crowfoot_one')).toBe('arrow')
  })
})

describe('multi-point lines', () => {
  const line = (): LinearElement =>
    withAbsolutePoints(createLinear('line', 10, 10), [[10, 10], [110, 10], [110, 110]])

  it('keeps the invariants after insert, move and delete', () => {
    const base = line()
    const ins = insertMidpoint(base, 0)
    expect(ins.points).toHaveLength(4)
    expect(ins.points[0]).toEqual([0, 0])
    const removed = removePoint(ins, 0)!
    expect(removed.points[0]).toEqual([0, 0])
    expect(removed.x).toBeCloseTo(60)
    expect(removePoint(removePoint(removed, 0)!, 0)).toBeNull()
    const b = removed.points.reduce((m, p) => [Math.max(m[0], p[0]), Math.max(m[1], p[1])], [0, 0])
    expect(removed.width).toBeCloseTo(b[0])
    expect(removed.height).toBeCloseTo(b[1])
  })

  it('hit-tests along a curved path, which bulges past the straight segments', () => {
    const base = line()
    const curved = { ...base, roundness: { type: 2 } }
    const box = getElementBox(curved)
    expect(box.width).toBeGreaterThanOrEqual(100)
    // the spline passes through the middle point but not through the straight chord
    expect(hitTestElement(curved, 110, 10, 2)).toBe(true)
    expect(hitTestElement(curved, 60, 60, 2)).toBe(false)
    const seg = getCurveSegments(curved.points)[0]
    const on = bezierAt(seg, 0.5)
    expect(hitTestElement(curved, curved.x + on.x, curved.y + on.y, 1)).toBe(true)
    expect(hitTestElement(curved, curved.x + on.x, curved.y + on.y + 15, 1)).toBe(false)
  })
})

describe('review fixes (phase 3)', () => {
  const arrowIn = (a: number, b: number): LinearElement =>
    ({
      ...createLinear('arrow', a, 100),
      points: [[0, 0], [b - a, 0]] as LinearElement['points'],
      width: b - a,
      height: 0,
    }) as LinearElement

  it('does not bind an arrow drawn inside a large shape to that shape', () => {
    const panel = rect(0, 0, 600, 400)
    expect(findBindTarget([panel], 100, 100, 10, { x: 200, y: 100 })).toBeNull()
    expect(findBindTarget([panel], 100, 100)?.id).toBe(panel.id)
  })

  it('prefers an outline-near shape, then the smallest containing one', () => {
    const big = rect(0, 0, 600, 400)
    const small = rect(100, 100, 100, 100)
    expect(findBindTarget([big, small], 150, 150)?.id).toBe(small.id)
    expect(findBindTarget([small, big], 150, 150)?.id).toBe(small.id)
    expect(findBindTarget([big, small], 202, 150)?.id).toBe(small.id)
  })

  it('refuses a double binding and never collapses a doubly bound arrow', () => {
    const panel = rect(0, 0, 600, 400)
    const arrow = arrowIn(100, 300)
    let els: readonly SceneElement[] = [panel, arrow]
    els = bindArrowEnd(els, arrow.id, 'start', panel.id)
    els = bindArrowEnd(els, arrow.id, 'end', panel.id)
    expect((els[1] as LinearElement).endBinding).toBeNull()
    const legacy = {
      ...arrow,
      startBinding: { elementId: panel.id },
      endBinding: { elementId: panel.id },
    } as LinearElement
    const out = reconcile([], [{ ...panel, boundElements: [{ type: 'arrow', id: arrow.id }] }, legacy])
    const r = out[1] as LinearElement
    expect(Math.hypot(r.points[1][0], r.points[1][1])).toBeGreaterThan(1)
    expect(r.startBinding).toBeNull()
    expect(r.endBinding).toBeNull()
    expect(out[0].boundElements).toBeNull()
  })

  it('preserves foreign binding fields and leaves elbowed arrows untouched', () => {
    const a = rect(0, 0, 100, 50)
    const b = rect(300, 0, 100, 50)
    const arrow = {
      ...arrowIn(100, 300),
      startBinding: { elementId: a.id, focus: 0.4, gap: 8, fixedPoint: null, extra: 'keep' },
    } as LinearElement
    const moved = recomputeBoundEnds(arrow, (id) => [a, b].find((e) => e.id === id))
    expect(moved.startBinding).toMatchObject({ extra: 'keep', focus: 0 })
    const elbow = { ...arrow, elbowed: true } as LinearElement
    expect(recomputeBoundEnds(elbow, (id) => [a, b].find((e) => e.id === id))).toBe(elbow)
  })

  it('selection by marquee excludes bound labels', () => {
    const c = rect(0, 0, 200, 100)
    const made = createLabel(c, 'hola')
    const els = attachLabel([c], made.container, made.label)
    expect(elementsInRect(els, { x: -10, y: -10, width: 500, height: 500 }).map((e) => e.id)).toEqual([c.id])
  })

  it('re-lays out an arrow label when roundness changes', () => {
    const arrow = withAbsolutePoints(createLinear('arrow', 0, 0), [[0, 0], [30, 120], [200, 0]])
    const made = createLabel(arrow, 'x')
    const els = attachLabel([arrow], made.container, made.label)
    const curved = els.map((e) => (e.id === arrow.id ? updateElement(e, { roundness: { type: 2 } }) : e))
    const out = reconcile(els, curved)
    expect(out[1]).not.toBe(els[1])
  })

  it('repairs orphan labels on paste and moves early labels after their container', () => {
    const c = rect(0, 0, 200, 100)
    const made = createLabel(c, 'hola')
    const orphan = made.label // container has no boundElements entry
    const repaired = sanitizeRelations([c, orphan])
    expect(getBoundRefs(repaired[0])).toEqual([{ type: 'text', id: orphan.id }])
    const early = sanitizeRelations([orphan, c])
    expect(early.map((e) => e.id)).toEqual([c.id, orphan.id])
    const clip = parseClipboard(serializeClipboard([c, orphan]))!
    expect(getBoundRefs(clip[0])).toHaveLength(1)
  })

  it('wrapText keeps indentation, repeated spaces and blank lines and terminates for tiny widths', () => {
    expect(wrapText('  a  b', 500, 20, 2)).toBe('  a  b')
    expect(wrapText('a\n   \nb', 500, 20, 2)).toBe('a\n   \nb')
    expect(wrapText('abc def', 1, 20, 2).split('\n')).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
})
