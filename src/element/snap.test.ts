import { describe, expect, it } from 'vitest'
import { createLinear, createShape } from './factory'
import { createLabel } from './label'
import { bindArrowEnd } from './relations'
import type { Box, SceneElement } from './types'
import {
  SNAP_TOLERANCE_PX,
  buildSnapIndex,
  edgeGuides,
  resizeGuides,
  snapBoxToObjects,
  snapCandidateBoxes,
  snapPointToObjects,
  snapResizePointer,
} from './snap'
import { DEFAULT_APP_STATE, coerceAppState, smartGuidesEnabled } from '../scene/serialize'

const box = (x: number, y: number, width = 40, height = 40): Box => ({ x, y, width, height })
const TOL = 8

describe('alignment', () => {
  const other = box(100, 100)
  it('snaps start, center and end lines on both axes', () => {
    expect(snapBoxToObjects(box(103, 300), [other], TOL).dx).toBe(-3)
    expect(snapBoxToObjects(box(98, 300), [other], TOL).dx).toBe(2)
    expect(snapBoxToObjects(box(103, 300, 34, 40), [other], TOL).dx).toBeCloseTo(0)
    expect(snapBoxToObjects(box(300, 103), [other], TOL).dy).toBe(-3)
    expect(snapBoxToObjects(box(300, 103, 40, 34), [other], TOL).dy).toBeCloseTo(0)
  })
  it('snaps my left edge to your right edge (adjacency) on both axes', () => {
    const r = snapBoxToObjects(box(144, 300), [other], TOL)
    expect(r.dx).toBe(-4)
    const v = snapBoxToObjects(box(300, 145), [other], TOL)
    expect(v.dy).toBe(-5)
    const left = snapBoxToObjects(box(56, 300), [other], TOL)
    expect(left.dx).toBe(4)
  })
  it('does nothing beyond the tolerance', () => {
    const r = snapBoxToObjects(box(160, 300), [other], TOL)
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] })
  })
  it('chooses the closest of several candidates', () => {
    const r = snapBoxToObjects(box(205, 0), [box(200, 500), box(203, 600)], TOL)
    expect(r.dx).toBe(-2)
  })
  it('draws every shape at the same snapped position, spanning to the farthest one', () => {
    const r = snapBoxToObjects(box(103, 300), [box(100, 0), box(100, 100), box(100, 600)], TOL)
    const g = r.guides.find((x) => x.kind === 'align' && x.x1 === 100)
    expect(g).toBeDefined()
    if (g?.kind !== 'align') throw new Error('expected align guide')
    expect(g.y1).toBe(0)
    expect(g.y2).toBe(640)
    expect(g.marks.length).toBeGreaterThanOrEqual(8)
  })
  it('snaps both axes independently', () => {
    const r = snapBoxToObjects(box(103, 205), [box(100, 100), box(500, 200)], TOL)
    expect(r.dx).toBe(-3)
    expect(r.dy).toBe(-5)
  })
  it('scales the tolerance with zoom', () => {
    const near = box(106, 300)
    const tolAt = (zoom: number) => SNAP_TOLERANCE_PX / zoom
    expect(snapBoxToObjects(near, [box(100, 100)], tolAt(1)).dx).toBe(-6)
    expect(snapBoxToObjects(near, [box(100, 100)], tolAt(2)).dx).toBe(0)
    expect(snapBoxToObjects(box(70, 300), [box(100, 100)], tolAt(0.5)).dx).toBe(10)
    expect(snapBoxToObjects(box(70, 300), [box(100, 100)], tolAt(1)).dx).toBe(0)
  })
})

describe('equal spacing', () => {
  it('snaps between two neighbours to equal gaps', () => {
    const l = box(0, 0)
    const r = box(200, 0)
    const m = box(103, 0)
    const res = snapBoxToObjects(m, [l, r], TOL)
    expect(m.x + res.dx).toBeCloseTo(100)
    const gaps = res.guides.filter((g) => g.kind === 'gap')
    expect(gaps).toHaveLength(2)
    expect(gaps.map((g) => g.kind === 'gap' && g.size)).toEqual([60, 60])
    expect(gaps.filter((g) => g.kind === 'gap' && g.label)).toHaveLength(1)
  })
  it('ignores candidates that do not overlap on the perpendicular axis', () => {
    const res = snapBoxToObjects(box(103, 0), [box(0, 300), box(200, 300)], TOL)
    expect(res.dx).toBe(0)
  })
  it('extends a row: gap to the neighbour equals the gap between A and B', () => {
    const a = box(0, 0)
    const b = box(60, 0) // gap 20
    const m = box(122, 0)
    const res = snapBoxToObjects(m, [a, b], TOL)
    expect(m.x + res.dx).toBeCloseTo(120)
    expect(res.guides.filter((g) => g.kind === 'gap').length).toBe(2)
    const left = snapBoxToObjects(box(-62, 0), [a, b], TOL)
    expect(-62 + left.dx).toBeCloseTo(-60)
  })
  it('lines up a fourth shape with the rhythm of three', () => {
    const row = [box(0, 0), box(60, 0), box(120, 0)]
    const m = box(183, 0)
    const res = snapBoxToObjects(m, row, TOL)
    expect(m.x + res.dx).toBeCloseTo(180)
    expect(res.guides.filter((g) => g.kind === 'gap')).toHaveLength(3)
  })
  it('works on the vertical axis', () => {
    const res = snapBoxToObjects(box(0, 103), [box(0, 0), box(0, 200)], TOL)
    expect(103 + res.dy).toBeCloseTo(100)
  })
  it('does not snap into an occupied slot', () => {
    const row = [box(0, 0), box(60, 0), box(120, 0)]
    const res = snapBoxToObjects(box(122, 0), row, TOL)
    expect(res.guides.filter((g) => g.kind === 'gap')).toHaveLength(0)
  })
  it('prefers the closer snap on one axis and alignment on a tie', () => {
    const l = box(0, 0)
    const r = box(200, 0)
    const closer = snapBoxToObjects(box(101, 0), [l, r, box(105, 400)], TOL)
    expect(closer.dx).toBeCloseTo(-1)
    const tie = snapBoxToObjects(box(99, 0), [l, r, box(98, 400)], TOL)
    expect(tie.dx).toBeCloseTo(-1)
    expect(tie.guides.some((g) => g.kind === 'align')).toBe(true)
  })
  it('combines alignment on one axis with spacing on the other', () => {
    const l = box(0, 0)
    const r = box(200, 0)
    const res = snapBoxToObjects(box(103, 3), [l, r], TOL)
    expect(103 + res.dx).toBeCloseTo(100)
    expect(3 + res.dy).toBeCloseTo(0)
    expect(res.guides.some((g) => g.kind === 'gap')).toBe(true)
    expect(res.guides.some((g) => g.kind === 'align')).toBe(true)
  })
})

describe('resize and point snapping', () => {
  const idx = buildSnapIndex([box(200, 100, 50, 50)])
  it('snaps the dragged edge only', () => {
    expect(snapResizePointer({ x: 197, y: 20 }, 'e', idx, TOL)).toEqual({ x: 200, y: 20 })
    expect(snapResizePointer({ x: 197, y: 148 }, 'n', idx, TOL)).toEqual({ x: 197, y: 150 })
    const p = snapResizePointer({ x: 197, y: 98 }, 'se', idx, TOL)
    expect(p).toEqual({ x: 200, y: 100 })
    expect(snapResizePointer({ x: 400, y: 20 }, 'e', idx, TOL)).toEqual({ x: 400, y: 20 })
  })
  it('snaps only the dominant axis when the ratio is locked', () => {
    const lock = box(0, 0, 100, 100)
    // dragging se: x scale 1.97 dominates the y scale 1.5
    const p = snapResizePointer({ x: 197, y: 150 }, 'se', idx, TOL, lock)
    expect(p.x).toBe(200)
    expect(p.y).toBe(150)
    // snapping would make x stop dominating: left untouched
    const keep = snapResizePointer({ x: 202, y: 203 }, 'se', buildSnapIndex([box(200, 0)]), TOL, lock)
    expect(keep).toEqual({ x: 202, y: 203 })
  })
  it('draws guides for the dragged edge', () => {
    const g = resizeGuides(box(0, 0, 200, 80), 'e', idx)
    expect(g).toHaveLength(1)
  })
  it('snaps a point to the x or y of other points to get a straight segment', () => {
    const own = buildSnapIndex([box(50, 50, 0, 0)])
    const h = snapPointToObjects({ x: 300, y: 53 }, own, TOL)
    expect(h.point).toEqual({ x: 300, y: 50 })
    expect(h.snapY).toBe(true)
    expect(h.snapX).toBe(false)
    const v = snapPointToObjects({ x: 46, y: 300 }, own, TOL)
    expect(v.point).toEqual({ x: 50, y: 300 })
    expect(edgeGuides(box(50, 300, 0, 0), own)).toHaveLength(1)
  })
})

describe('candidates', () => {
  const view = { x1: -1000, y1: -1000, x2: 1000, y2: 1000 }
  it('excludes moving elements, labels, bound arrows, deleted and off-screen elements', () => {
    const moving = { ...createShape('rectangle', 0, 0), width: 50, height: 50 }
    const target = { ...createShape('rectangle', 300, 0), width: 50, height: 50 }
    const made = createLabel(target, 'x')
    const arrow = createLinear('arrow', 60, 20, undefined as never)
    let els: readonly SceneElement[] = [moving, made.container, made.label, arrow]
    els = bindArrowEnd(els, arrow.id, 'end', moving.id)
    const gone = { ...createShape('rectangle', 400, 0), isDeleted: true }
    const far = { ...createShape('rectangle', 5000, 0), width: 10, height: 10 }
    const locked = { ...createShape('rectangle', 600, 0), width: 10, height: 10, locked: true }
    const boxes = snapCandidateBoxes([...els, gone, far, locked], new Set([moving.id]), view)
    expect(boxes).toHaveLength(2)
    expect(boxes.map((b) => b.x).sort((a, b) => a - b)).toEqual([300, 600])
  })
})

describe('smart guides default', () => {
  it('is on by default and when the field is missing or invalid', () => {
    expect(DEFAULT_APP_STATE.objectsSnapModeEnabled).toBe(true)
    expect(coerceAppState({}).objectsSnapModeEnabled).toBe(true)
    expect(coerceAppState({ objectsSnapModeEnabled: 'x' }).objectsSnapModeEnabled).toBe(true)
    expect(smartGuidesEnabled({ gridSize: 20, viewBackgroundColor: '#fff' })).toBe(true)
  })
  it('respects an explicit false', () => {
    const s = coerceAppState({ objectsSnapModeEnabled: false })
    expect(s.objectsSnapModeEnabled).toBe(false)
    expect(smartGuidesEnabled(s)).toBe(false)
  })
})
