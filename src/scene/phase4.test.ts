import { beforeEach, describe, expect, it } from 'vitest'
import { createLinear, createShape } from '../element/factory'
import type { SceneElement, LinearElement } from '../element/types'
import { createLabel } from '../element/label'
import { attachLabel, bindArrowEnd, getBoundRefs, reconcile } from '../element/relations'
import { bakeAngle, getElementBounds } from '../element/geometry'
import { flipElements, rotateElements, rotationDelta, selectionCenter } from '../element/transform'
import { groupElements, selectionForClick, selectionInRect, ungroupElements } from '../element/group'
import { alignUnits, distributeUnits } from '../element/align'
import { gridMoveDelta, snapBoxToObjects, snapPointToGrid, snapValue } from '../element/snap'
import { appendFreedrawPoint, createFreedraw } from '../element/freedraw'
import { getElementBox } from '../element/geometry'
import { hitTestElement } from '../element/hit'
import { cloneElements } from '../element/clone'
import { DEFAULT_APP_STATE, gridSettings, parseScene, serializeScene, withGrid } from './serialize'
import { DEFAULT_VIEWPORT } from './viewport'
import { useStore } from './store'

const st = () => useStore.getState()
const rect = (x: number, y: number, w = 10, h = 10): SceneElement => ({ ...createShape('rectangle', x, y), width: w, height: h })
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

beforeEach(() => {
  st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
})

describe('rotation', () => {
  it('rotates a single element around its own center', () => {
    const r = rect(0, 0, 20, 10)
    const [out] = rotateElements([r], { x: 10, y: 5 }, Math.PI / 2)
    close(out.x, 0)
    close(out.y, 0)
    close(out.angle, Math.PI / 2)
  })
  it('orbits a multi-selection around the common center', () => {
    const a = rect(0, 0)
    const b = rect(20, 0)
    const c = selectionCenter([a, b])!
    const [ra, rb] = rotateElements([a, b], c, Math.PI)
    close(ra.x, 20)
    close(rb.x, 0)
    close(ra.angle, Math.PI)
  })
  it('bakes rotation into line points and keeps invariants', () => {
    const l = { ...createLinear('line', 0, 0), points: [[0, 0], [10, 0]] as [number, number][], width: 10 } as LinearElement
    const [out] = rotateElements([l], { x: 5, y: 0 }, Math.PI / 2) as LinearElement[]
    expect(out.angle).toBe(0)
    expect(out.points[0]).toEqual([0, 0])
    close(out.points[1][0], 0)
    close(out.points[1][1], 10)
    close(out.height, 10)
    close(out.width, 0)
  })
  it('bakes the angle of loaded lines on first modification', () => {
    const l = { ...createLinear('line', 0, 0), points: [[0, 0], [10, 0]] as [number, number][], width: 10, angle: Math.PI / 2 } as LinearElement
    const b = bakeAngle(l)
    expect(b.angle).toBe(0)
    close(b.points[1][1] - b.points[0][1], 10)
  })
  it('snaps to 15 degrees with shift', () => {
    const d = rotationDelta({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 4 }, 0, true)
    close(d, (15 * Math.PI) / 180 * Math.round(Math.atan2(4, 10) / ((15 * Math.PI) / 180)))
  })
  it('keeps labels and bindings consistent after rotate', () => {
    const box = rect(0, 0, 100, 50)
    const made = createLabel(box, 'hola')
    let els: readonly SceneElement[] = attachLabel([made.container], made.container, made.label)
    const arrow = { ...createLinear('arrow', 200, 25), points: [[0, 0], [-60, 0]] as [number, number][], width: 60 } as LinearElement
    els = bindArrowEnd([...els, arrow], arrow.id, 'end', box.id === made.container.id ? box.id : made.container.id)
    const target = els.find((e) => e.id === made.container.id)!
    const rot = rotateElements([target], selectionCenter([target])!, Math.PI / 2)
    const next = reconcile(els, els.map((e) => rot.find((r) => r.id === e.id) ?? e))
    const label = next.find((e) => e.id === made.label.id)!
    close(label.angle, Math.PI / 2)
    expect(getBoundRefs(next.find((e) => e.id === made.container.id)!).map((r) => r.id)).toContain(arrow.id)
  })
})

describe('groups', () => {
  it('groups, nests and ungroups with innermost-first ids', () => {
    const [a, b, c] = [rect(0, 0), rect(20, 0), rect(40, 0)]
    let els = groupElements([a, b, c], [a.id, b.id], 'g1')
    expect(els.find((e) => e.id === a.id)!.groupIds).toEqual(['g1'])
    els = groupElements(els, [a.id, b.id, c.id], 'g2')
    expect(els.find((e) => e.id === a.id)!.groupIds).toEqual(['g1', 'g2'])
    expect(els.find((e) => e.id === c.id)!.groupIds).toEqual(['g2'])
    expect(selectionForClick(els, a.id).sort()).toEqual([a.id, b.id, c.id].sort())
    expect(selectionForClick(els, a.id, 'g2').sort()).toEqual([a.id, b.id].sort())
    els = ungroupElements(els, [a.id, b.id, c.id])
    expect(els.find((e) => e.id === a.id)!.groupIds).toEqual(['g1'])
  })
  it('marquee selects a group only when fully inside', () => {
    const a = rect(0, 0)
    const b = rect(100, 0)
    const c = rect(0, 50)
    const els = groupElements([a, b, c], [a.id, b.id], 'g')
    const partial = selectionInRect(els, { x: -5, y: -5, width: 30, height: 100 })
    expect(partial.map((e) => e.id)).toEqual([c.id])
    const full = selectionInRect(els, { x: -5, y: -5, width: 200, height: 30 })
    expect(full.map((e) => e.id).sort()).toEqual([a.id, b.id].sort())
  })
  it('skips locked elements in marquee and select all', () => {
    const a = { ...rect(0, 0), locked: true }
    const b = rect(20, 0)
    expect(selectionInRect([a, b], { x: -5, y: -5, width: 100, height: 100 }).map((e) => e.id)).toEqual([b.id])
    st().load({ elements: [a, b], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
    st().selectAll()
    expect(st().selectedIds).toEqual([b.id])
  })
  it('gives duplicated groups new group ids', () => {
    const [a, b] = [rect(0, 0), rect(20, 0)]
    const els = [...groupElements([a, b], [a.id, b.id], 'g')]
    const copy = cloneElements(els, 5, 5)
    expect(copy[0].groupIds[0]).not.toBe('g')
    expect(copy[0].groupIds).toEqual(copy[1].groupIds)
  })
})

describe('lock', () => {
  it('locked elements ignore delete, nudge and style', () => {
    const a = rect(0, 0)
    st().commitDraft(a)
    st().toggleLock()
    expect(st().elements[0].locked).toBe(true)
    st().deleteSelected()
    st().nudgeSelection(5, 5)
    st().applyStyle({ strokeColor: '#ff0000' })
    const e = st().elements[0]
    expect(e.isDeleted).toBe(false)
    expect(e.x).toBe(0)
    expect(e.strokeColor).not.toBe('#ff0000')
    st().toggleLock()
    expect(st().elements[0].locked).toBe(false)
  })
})

describe('align and distribute', () => {
  it('aligns every edge and center', () => {
    const a = rect(0, 0, 10, 10)
    const b = rect(30, 20, 20, 40)
    const run = (k: Parameters<typeof alignUnits>[1]) => alignUnits([[a], [b]], k)
    expect(run('left').map((e) => e.x)).toEqual([30 - 30].length ? [b.x - 30] : [])
    close(run('right').find((e) => e.id === a.id)!.x, 40)
    close(run('centerH').find((e) => e.id === a.id)!.x, 20)
    close(run('top').find((e) => e.id === b.id)!.y, 0)
    close(run('bottom').find((e) => e.id === a.id)!.y, 50)
    close(run('middle').find((e) => e.id === a.id)!.y, 25)
  })
  it('uses rotated bounds', () => {
    const a = { ...rect(0, 0, 40, 10), angle: Math.PI / 2 }
    const b = rect(100, 0, 10, 10)
    const [ma] = alignUnits([[a], [b]], 'left')
    expect(ma.id).toBe(b.id)
    close(ma.x, getElementBounds(a)[0])
  })
  it('distributes with equal gaps', () => {
    const els = [rect(0, 0, 10, 10), rect(15, 0, 20, 10), rect(90, 0, 10, 10)]
    const out = distributeUnits(els.map((e) => [e]), 'horizontal')
    const mid = out.find((e) => e.id === els[1].id)!
    // gap = (100 - 40) / 2 = 30
    close(mid.x, 40)
    expect(distributeUnits(els.slice(0, 2).map((e) => [e]), 'horizontal')).toEqual([])
  })
})

describe('flip', () => {
  it('mirrors shapes and negates angle', () => {
    const a = rect(0, 0, 10, 10)
    const b = { ...rect(30, 0, 10, 10), angle: Math.PI / 2 }
    const out = flipElements([a, b], 'horizontal')
    close(out[0].x, 30)
    close(out[1].angle, Math.PI * 3 / 2)
  })
  it('mirrors line points keeping invariants', () => {
    const l = { ...createLinear('arrow', 0, 0), points: [[0, 0], [10, 5]] as [number, number][], width: 10, height: 5 } as LinearElement
    const [out] = flipElements([l], 'horizontal') as LinearElement[]
    expect(out.points[0]).toEqual([0, 0])
    close(out.points[1][0], -10)
    close(out.x, 10)
  })
  it('keeps label relations after flip', () => {
    const box = rect(0, 0, 100, 50)
    const made = createLabel(box, 'x')
    const els = attachLabel([made.container], made.container, made.label)
    const flipped = flipElements([els[0]], 'vertical')
    const next = reconcile(els, els.map((e) => flipped.find((f) => f.id === e.id) ?? e))
    expect(next.find((e) => e.id === made.label.id)!.isDeleted).toBe(false)
    expect(getBoundRefs(next[0])).toHaveLength(1)
  })
})

describe('snapping', () => {
  it('snaps to the grid', () => {
    expect(snapValue(29, 20)).toBe(20)
    expect(snapPointToGrid({ x: 31, y: 9 }, 20)).toEqual({ x: 40, y: 0 })
    expect(gridMoveDelta({ x: 13, y: 27, width: 5, height: 5 }, 20)).toEqual({ x: 7, y: -7 })
  })
  it('snaps to nearby object edges and centers only within tolerance', () => {
    const other = { x: 100, y: 100, width: 40, height: 40 }
    const near = snapBoxToObjects({ x: 103, y: 0, width: 10, height: 10 }, [other], 8)
    expect(near.dx).toBe(-3)
    expect(near.guides.length).toBeGreaterThan(0)
    const center = snapBoxToObjects({ x: 115, y: 0, width: 10, height: 10 }, [other], 8)
    expect(center.dx).toBe(0)
    const far = snapBoxToObjects({ x: 60, y: 0, width: 10, height: 10 }, [other], 8)
    expect(far.dx).toBe(0)
    expect(far.guides).toEqual([])
  })
  it('serializes the grid appState and tolerates null gridSize', () => {
    const on = withGrid(DEFAULT_APP_STATE, true)
    const file = serializeScene([], on)
    expect(file.appState).toMatchObject({ gridSize: 20, gridStep: 5, gridModeEnabled: true })
    const old = parseScene({ elements: [], appState: { gridSize: null } })!
    expect(gridSettings(old.appState)).toEqual({ enabled: false, size: 20, step: 5 })
  })
})

describe('freedraw', () => {
  it('tracks bounds and hit tests the stroke', () => {
    let f = createFreedraw(0, 0)
    f = appendFreedrawPoint(f, 50, 0)
    f = appendFreedrawPoint(f, 50, 30)
    const box = getElementBox(f)
    expect([box.width, box.height]).toEqual([50, 30])
    expect(f.simulatePressure).toBe(true)
    expect(hitTestElement(f, 25, 1, 3)).toBe(true)
    expect(hitTestElement(f, 25, 20, 3)).toBe(false)
  })
  it('rotates and flips like other elements', () => {
    let f = createFreedraw(0, 0)
    f = appendFreedrawPoint(f, 20, 10)
    const [r] = rotateElements([f], selectionCenter([f])!, 1)
    close(r.angle, 1)
    const [m] = flipElements([f], 'horizontal') as (typeof f)[]
    expect(m.points[0]).toEqual([0, 0])
    close(m.points[1][0], -20)
  })
})

describe('eraser', () => {
  it('removes the element and its label in one undo entry', () => {
    const box = rect(0, 0, 100, 50)
    const made = createLabel(box, 'x')
    const els = attachLabel([made.container], made.container, made.label)
    st().load({ elements: [...els], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
    st().eraseElements([box.id])
    expect(st().elements.every((e) => e.isDeleted)).toBe(true)
    st().undo()
    expect(st().elements.some((e) => e.isDeleted)).toBe(false)
  })
  it('skips locked elements', () => {
    const a = { ...rect(0, 0), locked: true }
    st().load({ elements: [a], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
    st().eraseElements([a.id])
    expect(st().elements[0].isDeleted).toBe(false)
  })
})
