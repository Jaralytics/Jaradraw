import { beforeEach, describe, expect, it } from 'vitest'
import { createLinear, createShape } from '../element/factory'
import { bakeAngle, getAbsolutePoints, getBoxCenter, getElementBox, rotatePoint, withAbsolutePoints } from '../element/geometry'
import { flipElements, rotateElements } from '../element/transform'
import { scaleElements } from '../element/group'
import { cloneElements } from '../element/clone'
import { getHandlePositions } from '../element/handles'
import { rerouteElbowArrow } from '../element/relations'
import { moveElement } from '../element/resize'
import { deleteElbowNode, pinElbow, waypointsAbs } from '../element/elbowWaypoints'
import { dragElbow, editPolyline, elbowNodes } from '../element/elbowEdit'
import { routeElbow, routeElbowVia } from '../element/elbow'
import { readWaypoints } from '../element/waypoints'
import { applyStyleToElement } from '../element/style'
import type { LinearElement, Point } from '../element/types'
import { useStore } from './store'
import { parseElement, DEFAULT_APP_STATE, parseScene, serializeScene } from './serialize'
import { DEFAULT_VIEWPORT } from './viewport'

type V = { x: number; y: number }

const st = () => useStore.getState()
const live = () => st().elements.filter((e) => !e.isDeleted)
const arrow = () => live().find((e) => e.type === 'arrow') as LinearElement
const abs = (a: LinearElement): V[] => getAbsolutePoints(a).map(([x, y]) => ({ x, y }))
const axisAlignedPts = (p: V[]) => p.every((q, i) => i === 0 || Math.abs(q.x - p[i - 1].x) < 1e-6 || Math.abs(q.y - p[i - 1].y) < 1e-6)
const axisAligned = (a: LinearElement) => axisAlignedPts(abs(a))
const onPathPts = (p: V[], w: V) =>
  p.some((q, i) => {
    if (i === 0) return false
    const o = p[i - 1]
    return w.x >= Math.min(o.x, q.x) - 1e-6 && w.x <= Math.max(o.x, q.x) + 1e-6 && w.y >= Math.min(o.y, q.y) - 1e-6 && w.y <= Math.max(o.y, q.y) + 1e-6
  })
/** Arc length along the polyline of the first point where `w` lies on it. */
const arcOf = (p: V[], w: V) => {
  let run = 0
  for (let i = 1; i < p.length; i++) {
    if (onPathPts([p[i - 1], p[i]], w)) return run + Math.hypot(w.x - p[i - 1].x, w.y - p[i - 1].y)
    run += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)
  }
  return -1
}
const noReversalPts = (p: V[]) => {
  for (let i = 2; i < p.length; i++) {
    const d1 = { x: Math.sign(p[i - 1].x - p[i - 2].x), y: Math.sign(p[i - 1].y - p[i - 2].y) }
    const d2 = { x: Math.sign(p[i].x - p[i - 1].x), y: Math.sign(p[i].y - p[i - 1].y) }
    if (d1.x * d2.x + d1.y * d2.y < 0) return false
  }
  return true
}

const same = (a: V, b: V) => {
  expect(a.x).toBeCloseTo(b.x)
  expect(a.y).toBeCloseTo(b.y)
}

const rect = (x: number, y: number) => ({ ...createShape('rectangle', x, y), width: 100, height: 50 })
const found = (i: string) => st().elements.find((e) => e.id === i)
const midOfFirstBend = (a: LinearElement): V => {
  const p = abs(a)
  return { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 }
}

function setup() {
  const a = rect(0, 0)
  const b = rect(400, 200)
  st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
  st().commitDraft(a)
  st().commitDraft(b)
  const draft = { ...withAbsolutePoints(createLinear('arrow', 100, 25), [[100, 25], [400, 225]]), elbowed: true } as LinearElement
  st().commitDraft(draft, { start: a.id, end: b.id })
  st().setSelection([draft.id])
  return { a, b, id: draft.id }
}

function setupWithWaypoint() {
  const s = setup()
  const m = midOfFirstBend(arrow())
  st().insertNode(s.id, m.x, m.y)
  return s
}

beforeEach(() => {
  st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
})

describe('routeElbowVia', () => {
  const free = (x: number, y: number) => ({ point: { x, y }, box: null })

  it('is routeElbow without waypoints', () => {
    expect(routeElbowVia(free(0, 0), [], free(100, 80))).toEqual(routeElbow(free(0, 0), free(100, 80)))
  })

  it('passes through one and two waypoints in order, axis-aligned, without reversing', () => {
    const cases: V[][] = [[{ x: 60, y: 140 }], [{ x: 60, y: 140 }, { x: 160, y: -60 }]]
    for (const wps of cases) {
      const r = routeElbowVia(free(0, 0), wps, free(200, 40))
      expect(axisAlignedPts(r.points)).toBe(true)
      expect(noReversalPts(r.points)).toBe(true)
      expect(r.points[0]).toEqual({ x: 0, y: 0 })
      expect(r.points[r.points.length - 1]).toEqual({ x: 200, y: 40 })
      const arcs = wps.map((w) => arcOf(r.points, w))
      expect(arcs.every((a) => a >= 0)).toBe(true)
      expect([...arcs].sort((x, y) => x - y)).toEqual(arcs)
    }
  })

  it('does not double back at a waypoint straight ahead of the previous leg', () => {
    const r = routeElbowVia(free(0, 0), [{ x: 100, y: 0 }], free(40, 0))
    expect(noReversalPts(r.points)).toBe(true)
    expect(onPathPts(r.points, { x: 100, y: 0 })).toBe(true)
  })
})

describe('elbow node editing in the store', () => {
  /** A straight horizontal arrow between two shapes. */
  function straight() {
    const a = rect(0, 0)
    const b = rect(400, 0)
    st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
    st().commitDraft(a)
    st().commitDraft(b)
    const draft = { ...withAbsolutePoints(createLinear('arrow', 100, 25), [[100, 25], [400, 25]]), elbowed: true } as LinearElement
    st().commitDraft(draft, { start: a.id, end: b.id })
    st().setSelection([draft.id])
    return { a, b, id: draft.id }
  }
  const bound = { start: true, end: true }
  /** Two split nodes at a quarter and three quarters of the straight arrow, then the middle piece dragged up. */
  function bump() {
    const s = straight()
    const p = abs(arrow())
    const x1 = p[0].x + (p[1].x - p[0].x) / 3
    const x2 = p[0].x + ((p[1].x - p[0].x) * 2) / 3
    st().insertNode(s.id, x1, p[0].y)
    st().insertNode(s.id, x2, p[0].y)
    const route0 = arrow().points
    const poly = editPolyline(arrow())
    const dragged = dragElbow(poly, { kind: 'segment', index: 1 }, { x: 0, y: -60 }, bound)
    const next = pinElbow(arrow(), dragged, found)
    st().replaceElements([next])
    return { ...s, route0, poly, dragged, p }
  }

  it('adds a split node on click without changing the route, as one entry', () => {
    const { id } = straight()
    const before = arrow()
    const n = st().history.stack.length
    const p = abs(before)
    expect(st().insertNode(id, (p[0].x + p[1].x) / 2, p[0].y + 3)).toBe(true)
    expect(arrow().points).toEqual(before.points)
    expect(readWaypoints(arrow())).toHaveLength(1)
    expect(st().pointEdit).toEqual({ id, selected: null, waypoint: 0 })
    expect(st().history.stack.length).toBe(n + 1)
    expect(getHandlePositions(arrow(), 1).map((h) => h.handle.kind)).toEqual(['point', 'point', 'waypoint'])
  })

  it('shows a handle on every corner of an unedited arrow and none on the rotate position', () => {
    setup()
    const kinds = getHandlePositions(arrow(), 1).map((h) => h.handle.kind)
    expect(kinds.filter((k) => k === 'waypoint')).toHaveLength(arrow().points.length - 2)
    expect(kinds).not.toContain('rotate')
  })

  it('builds the bump with four elbows, equal to its own re-route', () => {
    const { p, dragged } = bump()
    const y = p[0].y
    expect(dragged).toHaveLength(6)
    expect(dragged.map((q) => q.y)).toEqual([y, y, y - 60, y - 60, y, y])
    expect(abs(arrow())).toEqual(dragged)
    expect(rerouteElbowArrow(arrow(), found)).toBe(arrow())
    expect(axisAligned(arrow())).toBe(true)
    expect(readWaypoints(arrow())).toHaveLength(4)
  })

  it('flattens the bump back to the straight route', () => {
    const { poly, p } = bump()
    const bumped = editPolyline(arrow())
    const flat = dragElbow(bumped, { kind: 'segment', index: 2 }, { x: 0, y: 60 }, bound)
    expect(flat).toEqual(poly)
    expect(flat).toHaveLength(4)
    expect(flat[0].y).toBe(p[0].y)
  })

  it('undoes a gesture in one step, restoring points and waypoints', () => {
    const { id } = straight()
    const p = abs(arrow())
    st().insertNode(id, p[0].x + 100, p[0].y)
    st().insertNode(id, p[0].x + 200, p[0].y)
    const points0 = arrow().points
    const wps0 = readWaypoints(arrow())
    const n = st().history.stack.length
    const prior = st().elements
    st().replaceElements([pinElbow(arrow(), dragElbow(editPolyline(arrow()), { kind: 'segment', index: 1 }, { x: 0, y: -40 }, bound), found)])
    st().endGesture('point', prior)
    expect(st().history.stack.length).toBe(n + 1)
    expect(arrow().points).not.toEqual(points0)
    st().undo()
    expect(arrow().points).toEqual(points0)
    expect(readWaypoints(arrow())).toEqual(wps0)
    st().redo()
    expect(readWaypoints(arrow())).toHaveLength(4)
  })

  it('deleting a node re-joins its neighbours; deleting all returns to the automatic route', async () => {
    const { id } = straight()
    const auto = arrow().points
    const p = abs(arrow())
    st().insertNode(id, p[0].x + 100, p[0].y)
    st().insertNode(id, p[0].x + 200, p[0].y)
    st().replaceElements([pinElbow(arrow(), dragElbow(editPolyline(arrow()), { kind: 'segment', index: 1 }, { x: 0, y: -60 }, bound), found)])
    const { deleteAction } = await import('./actions')
    const n = st().history.stack.length
    st().setPointEdit({ id, selected: null, waypoint: 1 })
    deleteAction()
    expect(st().history.stack.length).toBe(n + 1)
    expect(axisAligned(arrow())).toBe(true)
    expect(readWaypoints(arrow())).toHaveLength(1)
    expect(st().selectedIds).toEqual([id])
    for (let i = 0; i < 3 && readWaypoints(arrow()).length > 0; i++) {
      const w = waypointsAbs(arrow())[0]
      const k = elbowNodes(arrow()).findIndex((q) => Math.abs(q.x - w.x) < 1e-6 && Math.abs(q.y - w.y) < 1e-6)
      st().setPointEdit({ id, selected: null, waypoint: k })
      deleteAction()
    }
    expect(readWaypoints(arrow())).toHaveLength(0)
    expect(arrow().customData).toBeUndefined()
    expect(arrow().points).toEqual(auto)
    const fresh = routeElbow({ point: { x: 0, y: 0 }, box: [0, 0, 100, 50] }, { point: { x: 0, y: 0 }, box: [400, 0, 500, 50] })
    expect(fresh.points).toHaveLength(2)
  })

  it('keeps interior nodes fixed when a bound shape moves and re-routes only the end leg', () => {
    const { b } = bump()
    const before = waypointsAbs(arrow())
    const poly0 = abs(arrow())
    st().replaceElements([moveElement(found(b.id)!, 0, 90)])
    const after = waypointsAbs(arrow())
    expect(after).toHaveLength(before.length)
    after.forEach((w, i) => same(w, before[i]))
    expect(axisAligned(arrow())).toBe(true)
    // the first part of the route, up to the last pinned node, is untouched
    const poly1 = abs(arrow())
    for (let i = 0; i < 4; i++) same(poly1[i], poly0[i])
    expect(elbowNodes(arrow()).length).toBeGreaterThanOrEqual(before.length)
  })

  it('does not leave a node behind after a double click', () => {
    const { id } = straight()
    const before = arrow()
    const n = st().history.stack.length
    const p = abs(before)
    st().insertNode(id, (p[0].x + p[1].x) / 2, p[0].y)
    expect(st().discardNodeInsert(id)).toBe(true)
    expect(arrow()).toBe(before)
    expect(st().history.stack.length).toBe(n)
  })

  it('translates pinned nodes with the arrow, alone or together with both shapes', () => {
    const { a, b, id } = bump()
    const w0 = waypointsAbs(arrow())
    const detached = { ...arrow(), startBinding: null, endBinding: null } as LinearElement
    waypointsAbs(moveElement(detached, 30, -20)).forEach((w, i) => same(w, { x: w0[i].x + 30, y: w0[i].y - 20 }))
    st().replaceElements([a.id, b.id, id].map((i) => moveElement(found(i)!, 30, -20)))
    waypointsAbs(arrow()).forEach((w, i) => same(w, { x: w0[i].x + 30, y: w0[i].y - 20 }))
  })

  it('ignores malformed waypoint data', () => {
    setup()
    const clean = arrow()
    for (const bad of ['x', [[1]], [[NaN, 2]], { a: 1 }, [null]]) {
      const broken = { ...clean, customData: { waypoints: bad, keep: 1 } } as LinearElement
      expect(readWaypoints(broken)).toEqual([])
      expect(rerouteElbowArrow(broken, found)).toBe(broken)
    }
  })

  it('serialises, parses and duplicates pinned nodes', () => {
    const { id } = bump()
    const back = parseScene(JSON.parse(JSON.stringify(serializeScene(st().elements))))!
    const parsed = back.elements.find((e) => e.id === id) as LinearElement
    expect(readWaypoints(parsed)).toEqual(readWaypoints(arrow()))
    const copy = cloneElements([arrow()], 40, 10)[0] as LinearElement
    waypointsAbs(copy).forEach((w, i) => same(w, { x: waypointsAbs(arrow())[i].x + 40, y: waypointsAbs(arrow())[i].y + 10 }))
  })

  it('leaving elbow removes the waypoints and keeps other customData; Codo starts with none', () => {
    bump()
    st().replaceElements([{ ...arrow(), customData: { ...arrow().customData, keep: 1 } } as LinearElement])
    st().applyStyle({ curve: 'sharp' })
    expect(arrow().customData).toEqual({ keep: 1 })
    expect(arrow().points).toHaveLength(2)
    expect(st().pointEdit).toBeNull()
    const strayed = { ...arrow(), customData: { keep: 1, waypoints: [[5, 5]] as Point[] } } as LinearElement
    const toElbow = applyStyleToElement(strayed, { curve: 'elbow' }) as LinearElement
    expect(readWaypoints(toElbow)).toEqual([])
    expect(toElbow.customData).toEqual({ keep: 1 })
  })

  it('keeps its pinned nodes when the bound shape is deleted', () => {
    const { b } = bump()
    const w0 = waypointsAbs(arrow())
    st().setSelection([b.id])
    st().deleteSelected()
    waypointsAbs(arrow()).forEach((w, i) => same(w, w0[i]))
    expect(axisAligned(arrow())).toBe(true)
  })

  it('orders a new node by position along the route', () => {
    const { id } = straight()
    const p = abs(arrow())
    st().insertNode(id, p[0].x + 200, p[0].y)
    const second = st().insertNode(id, p[0].x + 50, p[0].y)
    expect(second).toBe(true)
    expect(st().pointEdit?.waypoint).toBe(0)
    const nodes = elbowNodes(arrow())
    expect(nodes.map((n) => n.x)).toEqual([...nodes.map((n) => n.x)].sort((x, y) => x - y))
  })
})

describe('deletePoint on elbow arrows', () => {
  it('is a no-op without an active node', () => {
    setupWithWaypoint()
    st().setPointEdit(null)
    const n = st().history.stack.length
    expect(st().deletePoint()).toBe(false)
    expect(st().history.stack.length).toBe(n)
  })

  it('makes one undo entry and undo restores points and waypoints; an unchanged route adds none', () => {
    const { id } = setupWithWaypoint()
    const before = arrow()
    const n = st().history.stack.length
    st().setPointEdit({ id, selected: null, waypoint: 0 })
    expect(st().deletePoint()).toBe(true)
    expect(st().pointEdit).toEqual({ id, selected: null })
    expect(st().history.stack.length).toBe(n + 1)
    expect(readWaypoints(arrow())).toHaveLength(0)
    st().undo()
    expect(arrow().points).toEqual(before.points)
    expect(readWaypoints(arrow())).toEqual(readWaypoints(before))
    st().redo()
    // an automatic corner of the now unedited route: nothing changes, nothing is recorded
    const m = st().history.stack.length
    st().setPointEdit({ id, selected: null, waypoint: 0 })
    expect(elbowNodes(arrow()).length).toBeGreaterThan(0)
    st().deletePoint()
    expect(st().history.stack.length).toBe(m)
    expect(st().pointEdit).toEqual({ id, selected: null })
  })
})

describe('discarding the node a double click inserted', () => {
  it('takes back a node inserted by the first click but not one that existed before', () => {
    const { id } = setup()
    const m = midOfFirstBend(arrow())
    st().insertNode(id, m.x, m.y)
    expect(st().discardNodeInsert(id)).toBe(true)
    expect(readWaypoints(arrow())).toHaveLength(0)
    st().insertNode(id, m.x, m.y)
    st().setPointEdit(null)
    st().setSelection([id])
    st().applyStyle({ strokeWidth: 4 })
    expect(st().discardNodeInsert(id)).toBe(false)
    expect(readWaypoints(arrow()).length).toBeGreaterThan(0)
  })
})

describe('discarding with an unrelated node', () => {
  it('does not pop the insert when a different node is the target', () => {
    const { id } = setup()
    const m = midOfFirstBend(arrow())
    st().insertNode(id, m.x, m.y)
    const n = st().history.stack.length
    // a click on another existing node only makes it active; the insert stays the top entry
    st().setPointEdit({ id, selected: null, waypoint: 0 })
    expect(st().history.stack.length).toBe(n)
    expect(st().pointEdit?.waypoint).toBe(0)
  })
})

describe('waypoint carrying', () => {
  it('rotates and flips with a multi-selection', () => {
    setupWithWaypoint()
    const w0 = waypointsAbs(arrow())[0]
    const all = live()
    const center = { x: 150, y: 90 }
    const rotated = rotateElements(all, center, 0.7).find((e) => e.type === 'arrow') as LinearElement
    same(waypointsAbs(rotated)[0], rotatePoint(w0.x, w0.y, center.x, center.y, 0.7))
    const h = flipElements(all, 'horizontal').find((e) => e.type === 'arrow') as LinearElement
    const v = flipElements(all, 'vertical').find((e) => e.type === 'arrow') as LinearElement
    const xs = all.flatMap((e) => [e.x, e.x + e.width])
    const ys = all.flatMap((e) => [e.y, e.y + e.height])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    same(waypointsAbs(h)[0], { x: 2 * cx - w0.x, y: w0.y })
    same(waypointsAbs(v)[0], { x: w0.x, y: 2 * cy - w0.y })
  })

  it('scales with a group', () => {
    setupWithWaypoint()
    const w0 = waypointsAbs(arrow())[0]
    const out = scaleElements(live(), { x: 0, y: 0, width: 500, height: 250 }, { x: 10, y: 20, width: 1000, height: 500 }, 2)
    same(waypointsAbs(out.find((e) => e.type === 'arrow') as LinearElement)[0], { x: 10 + w0.x * 2, y: 20 + w0.y * 2 })
  })

  it('bakes a non-zero angle into the waypoints', () => {
    setupWithWaypoint()
    const tilted = { ...arrow(), angle: 0.5 } as LinearElement
    const [wx, wy] = readWaypoints(tilted)[0]
    const c = getBoxCenter(getElementBox(tilted))
    const expected = rotatePoint(tilted.x + wx, tilted.y + wy, c.x, c.y, 0.5)
    same(waypointsAbs(tilted)[0], expected)
    expect(bakeAngle(tilted).angle).toBe(0)
  })

  it('restores waypoints on undo and redo after a drag and after a delete', async () => {
    const { id } = setupWithWaypoint()
    const before = waypointsAbs(arrow())
    const prior = st().elements
    const poly = dragElbow(editPolyline(arrow()), { kind: 'node', index: 0 }, { x: 15, y: 0 }, { start: true, end: true })
    st().replaceElements([pinElbow(arrow(), poly, found)])
    st().endGesture('point', prior)
    const moved = waypointsAbs(arrow())
    expect(moved.some((w, i) => !before[i] || Math.abs(w.x - before[i].x) > 1)).toBe(true)
    st().undo()
    waypointsAbs(arrow()).forEach((w, i) => same(w, before[i]))
    st().redo()
    waypointsAbs(arrow()).forEach((w, i) => same(w, moved[i]))
    st().setPointEdit({ id, selected: null, waypoint: 0 })
    const { deleteAction } = await import('./actions')
    const afterDelete = (() => {
      deleteAction()
      return waypointsAbs(arrow())
    })()
    st().undo()
    expect(waypointsAbs(arrow())).toHaveLength(moved.length)
    st().redo()
    expect(waypointsAbs(arrow())).toHaveLength(afterDelete.length)
  })
})

describe('routeElbowVia over a grid of layouts', () => {
  const A: [number, number, number, number] = [0, 0, 100, 50]
  const offsets: V[] = [{ x: 300, y: 0 }, { x: -300, y: 0 }, { x: 0, y: 200 }, { x: 0, y: -200 }, { x: 300, y: 200 }, { x: -300, y: -200 }, { x: 100, y: 0 }, { x: 120, y: 30 }]
  const waypointSets: V[][] = [
    [{ x: 200, y: 100 }],
    [{ x: 50, y: 25 }],
    [{ x: -60, y: 25 }],
    [{ x: 100, y: 25 }],
    [{ x: 200, y: 100 }, { x: 200, y: 100 }],
    [{ x: -60, y: 25 }, { x: 150, y: -80 }],
    [{ x: 50, y: 25 }, { x: 200, y: 200 }, { x: 80, y: -90 }],
    [{ x: 100, y: 25 }, { x: 100, y: 25 }, { x: 260, y: 25 }],
  ]

  it('keeps every waypoint on an orthogonal polyline, in order', () => {
    for (const o of offsets) {
      const B: [number, number, number, number] = [A[0] + o.x, A[1] + o.y, A[2] + o.x, A[3] + o.y]
      const start = { point: { x: 100, y: 25 }, box: A }
      const end = { point: { x: B[0], y: B[1] + 25 }, box: B }
      for (const wps of waypointSets) {
        const label = JSON.stringify({ o, wps })
        const r = routeElbowVia(start, wps, end)
        const p = r.points
        expect(axisAlignedPts(p), label).toBe(true)
        for (let i = 1; i < p.length; i++) expect(Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y), label).toBeGreaterThan(0)
        let from = 0
        for (const w of wps) {
          let run = 0
          let found = -1
          for (let i = 1; i < p.length && found < 0; i++) {
            const len = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)
            if (onPathPts([p[i - 1], p[i]], w)) {
              const arc = run + Math.hypot(w.x - p[i - 1].x, w.y - p[i - 1].y)
              if (arc >= from - 1e-6) found = arc
            }
            run += len
          }
          expect(found, label).toBeGreaterThanOrEqual(0)
          from = found
        }
      }
    }
  })
})

describe('imported customData', () => {
  it('keeps unrelated keys through parse, re-route and serialise', () => {
    const raw = (type: string, extra: object) => ({ type, id: `${type}1`, x: 0, y: 0, width: 100, height: 50, ...extra })
    const scene = parseScene({
      elements: [
        raw('rectangle', { customData: { note: 'a' } }),
        { ...raw('arrow', { customData: { waypoints: 'x', other: 1 }, elbowed: true, points: [[0, 0], [200, 100]] }), x: 300, y: 300 },
      ],
    })!
    const arr = scene.elements.find((e) => e.type === 'arrow') as LinearElement
    const routed = rerouteElbowArrow(arr, () => undefined)
    const out = parseScene(JSON.parse(JSON.stringify(serializeScene([...scene.elements.filter((e) => e.type !== 'arrow'), routed]))))!
    expect((out.elements.find((e) => e.type === 'rectangle') as { customData?: unknown }).customData).toEqual({ note: 'a' })
    const back = out.elements.find((e) => e.type === 'arrow') as LinearElement
    expect(back.customData).toEqual({ waypoints: 'x', other: 1 })
    expect(readWaypoints(back)).toEqual([])
    expect(parseElement({ type: 'arrow', customData: { other: 1 } })).toMatchObject({ customData: { other: 1 } })
  })
})

describe('stale active node', () => {
  it('clears the active node without deleting the element', async () => {
    const { id } = setupWithWaypoint()
    const { deleteAction } = await import('./actions')
    st().setPointEdit({ id, selected: null, waypoint: 7 })
    deleteAction()
    expect(live().some((e) => e.id === id)).toBe(true)
    expect(st().pointEdit).toBeNull()
    deleteAction()
    expect(live().some((e) => e.id === id)).toBe(false)
  })
})

describe('pinElbow round trip', () => {
  const both = { start: true, end: true }
  const makeArrow = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>, from: [number, number], to: [number, number]) => {
    st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
    st().commitDraft(a)
    st().commitDraft(b)
    const draft = { ...withAbsolutePoints(createLinear('arrow', from[0], from[1]), [from, to]), elbowed: true } as LinearElement
    st().commitDraft(draft, { start: a.id, end: b.id })
    return draft.id
  }
  /** The edited polyline survives pinning and re-routing: the arrow reads back as the same polyline. */
  const roundTrip = (poly: V[]) => {
    const pinned = pinElbow(arrow(), poly, found)
    const back = abs(pinned)
    expect(back).toHaveLength(poly.length)
    back.forEach((q, i) => same(q, poly[i]))
    expect(rerouteElbowArrow(pinned, found)).toBe(pinned)
  }

  it('keeps the bump, vertical, first, last and short bound-bound edits', () => {
    const id = makeArrow(rect(0, 0), rect(400, 0), [100, 25], [400, 25])
    const p = abs(arrow())
    st().insertNode(id, p[0].x + 100, p[0].y)
    st().insertNode(id, p[0].x + 200, p[0].y)
    const poly = editPolyline(arrow())
    roundTrip(dragElbow(poly, { kind: 'segment', index: 1 }, { x: 0, y: -60 }, both))

    makeArrow(rect(0, 0), rect(400, 200), [100, 25], [400, 225])
    const z = editPolyline(arrow())
    for (const [index, d] of [[1, { x: 30, y: 0 }], [0, { x: 0, y: 40 }], [z.length - 2, { x: 0, y: -30 }]] as const) {
      roundTrip(dragElbow(z, { kind: 'segment', index }, d, both))
    }
    roundTrip(dragElbow(z, { kind: 'node', index: 0 }, { x: 25, y: 15 }, both))

    makeArrow(rect(0, 0), rect(145, 0), [100, 25], [145, 25])
    const short = editPolyline(arrow())
    roundTrip(dragElbow(short, { kind: 'segment', index: 0 }, { x: 0, y: 30 }, both))
  })

  it('keeps a middle segment dragged to within 10 px of a bound shape corner', () => {
    const id = makeArrow(rect(0, 0), rect(400, 0), [100, 25], [400, 25])
    const p = abs(arrow())
    st().insertNode(id, p[0].x + 200, p[0].y)
    st().insertNode(id, p[1].x - 20, p[0].y)
    const poly = editPolyline(arrow())
    // the raised piece ends 8 px above the corner of the target shape
    roundTrip(dragElbow(poly, { kind: 'segment', index: 1 }, { x: 0, y: -33 }, both))
  })

  it('prunes a waypoint that sits on an end point', () => {
    makeArrow(rect(0, 0), rect(400, 0), [100, 25], [400, 25])
    const a = arrow()
    const end = abs(a)[abs(a).length - 1]
    const bad = { ...a, customData: { waypoints: [[end.x - a.x, end.y - a.y]] } } as LinearElement
    const out = rerouteElbowArrow(bad, found)
    expect(readWaypoints(out)).toEqual([])
  })

  it('discards both inserts of a double click and refuses stale ones', () => {
    const id = makeArrow(rect(0, 0), rect(400, 0), [100, 25], [400, 25])
    const before = arrow()
    const n = st().history.stack.length
    st().insertNode(id, 200, 25)
    st().insertNode(id, 300, 25)
    expect(st().discardNodeInsert(id)).toBe(true)
    expect(arrow()).toBe(before)
    expect(st().history.stack.length).toBe(n)
    st().insertNode(id, 200, 25)
    st().undo()
    st().replaceElements([{ ...arrow() }])
    expect(st().discardNodeInsert(id)).toBe(false)
  })
})

describe('deleting nodes of a hand-built route', () => {
  const route: [number, number][] = [[444, 340], [468, 340], [468, 390], [500, 390], [500, 250], [700, 250], [700, 340], [796, 340]]
  const build = () => {
    const a = { ...createShape('rectangle', 340, 290), width: 100, height: 100 }
    const b = { ...createShape('rectangle', 800, 290), width: 100, height: 100 }
    st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
    st().commitDraft(a)
    st().commitDraft(b)
    const base = { ...withAbsolutePoints(createLinear('arrow', 444, 340), route), elbowed: true } as LinearElement
    const wps = route.slice(1, -1).map(([x, y]) => [x - 444, y - 340] as Point)
    st().commitDraft({ ...base, customData: { waypoints: wps } } as LinearElement, { start: a.id, end: b.id })
    return arrow()
  }
  const none = found
  const del = (el: LinearElement, at: [number, number]) => {
    const i = elbowNodes(el).findIndex((n) => Math.abs(n.x - at[0]) < 1e-6 && Math.abs(n.y - at[1]) < 1e-6)
    expect(i).toBeGreaterThanOrEqual(0)
    const next = deleteElbowNode(el, i, none)
    expect(next).not.toBeNull()
    return next as LinearElement
  }
  const check = (el: LinearElement) => {
    const p = abs(el)
    expect(axisAlignedPts(p)).toBe(true)
    for (let i = 1; i < p.length; i++) expect(Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)).toBeGreaterThanOrEqual(16)
    waypointsAbs(el).forEach((w) => expect(onPathPts(p, w)).toBe(true))
  }

  it('drops nodes the route would fold back on, step by step', () => {
    let el = build()
    expect(abs(el).map((q) => [q.x, q.y])).toEqual(route)
    el = del(el, [468, 390])
    check(el)
    expect(abs(el)).toHaveLength(route.length - 2)
    expect(abs(el).some((q) => q.x === 500 && q.y === 250)).toBe(true)
    el = del(el, [500, 250])
    check(el)
    expect(abs(el).map((q) => [q.x, q.y])).toEqual([[444, 340], [796, 340]])
  })

  it('always ends in the automatic route when every node is deleted one by one', () => {
    let el = build()
    const auto = rerouteElbowArrow({ ...el, customData: undefined } as LinearElement, none)
    for (let guard = 0; guard < 20 && readWaypoints(el).length > 0; guard++) {
      el = del(el, [waypointsAbs(el)[0].x, waypointsAbs(el)[0].y])
      check(el)
    }
    expect(readWaypoints(el)).toHaveLength(0)
    expect(abs(el)).toEqual(abs(auto))
  })

  it('unpins the node and its neighbours but keeps the nodes further away', () => {
    const el = del(build(), [700, 250])
    expect(readWaypoints(el).length).toBeLessThanOrEqual(3)
    expect(readWaypoints(el).length).toBeGreaterThan(0)
    check(el)
  })

  const bump: [number, number][] = [[444, 340], [540, 340], [540, 220], [700, 220], [700, 340], [796, 340]]
  const buildBump = () => {
    const a = { ...createShape('rectangle', 340, 290), width: 100, height: 100 }
    const b = { ...createShape('rectangle', 800, 290), width: 100, height: 100 }
    st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
    st().commitDraft(a)
    st().commitDraft(b)
    const base = { ...withAbsolutePoints(createLinear('arrow', 444, 340), bump), elbowed: true } as LinearElement
    const wps = bump.slice(1, -1).map(([x, y]) => [x - 444, y - 340] as Point)
    st().commitDraft({ ...base, customData: { waypoints: wps } } as LinearElement, { start: a.id, end: b.id })
    return arrow()
  }

  it.each([[540, 340], [540, 220], [700, 220], [700, 340]])('deleting the corner (%i, %i) of a bump removes the bump', (x, y) => {
    const el = del(buildBump(), [x, y])
    const p = abs(el)
    expect(p.every((q) => q.y === 340)).toBe(true)
    expect(readWaypoints(el).length).toBeLessThanOrEqual(1)
  })

  it('a staircase of five corners loses corners when the middle one is deleted', () => {
    const stairs: [number, number][] = [[444, 340], [500, 340], [500, 380], [560, 380], [560, 420], [620, 420], [620, 460], [680, 460], [680, 500], [796, 500]]
    const a = { ...createShape('rectangle', 340, 290), width: 100, height: 100 }
    const b = { ...createShape('rectangle', 800, 450), width: 100, height: 100 }
    st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
    st().commitDraft(a)
    st().commitDraft(b)
    const base = { ...withAbsolutePoints(createLinear('arrow', 444, 340), stairs), elbowed: true } as LinearElement
    const wps = stairs.slice(1, -1).map(([x, y]) => [x - 444, y - 340] as Point)
    st().commitDraft({ ...base, customData: { waypoints: wps } } as LinearElement, { start: a.id, end: b.id })
    const before = arrow()
    const mid = Math.floor(elbowNodes(before).length / 2)
    const next = deleteElbowNode(before, mid, none) as LinearElement
    expect(abs(next).length).toBeLessThan(abs(before).length)
    expect(axisAlignedPts(abs(next))).toBe(true)
    const kept = waypointsAbs(next)
    expect(kept.length).toBeGreaterThanOrEqual(readWaypoints(before).length - 3)
    expect(kept.some((w) => w.x === 500 && w.y === 340)).toBe(true)
    expect(kept.some((w) => w.x === 680 && w.y === 500)).toBe(true)
  })

  it('leaves an unedited route that does not change fully automatic', () => {
    setup()
    const before = arrow()
    expect(readWaypoints(before)).toHaveLength(0)
    const next = deleteElbowNode(before, 0, found) as LinearElement
    expect(next.points).toEqual(before.points)
    expect(next.customData).toBeUndefined()
  })

  it('deleting a corner of an unedited L or Z route does not crash and leaves no waypoints', () => {
    const s = setup()
    const before = arrow()
    expect(elbowNodes(before).length).toBeGreaterThan(0)
    for (let i = 0; i < elbowNodes(before).length; i++) {
      const next = deleteElbowNode(before, i, found) as LinearElement
      expect(next).not.toBeNull()
      expect(readWaypoints(next)).toHaveLength(0)
      expect(axisAligned(next)).toBe(true)
    }
    expect(s.id).toBe(before.id)
  })
})
