import { beforeEach, describe, expect, it } from 'vitest'
import { createLinear, createShape } from '../element/factory'
import { withAbsolutePoints } from '../element/geometry'
import { createLabel } from '../element/label'
import { attachLabel, bindArrowEnd, rerouteElbowArrow } from '../element/relations'
import { getHandlePositions } from '../element/handles'
import { moveElement } from '../element/resize'
import { outlinePointToward } from '../element/bind'
import { DEFAULT_STYLE_DEFAULTS, styleForNew } from '../element/style'
import type { LinearElement, SceneElement } from '../element/types'
import { useStore } from './store'
import { DEFAULT_APP_STATE } from './serialize'
import { DEFAULT_VIEWPORT } from './viewport'

const st = () => useStore.getState()
const live = () => st().elements.filter((e) => !e.isDeleted)

beforeEach(() => {
  st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
})

function add(x: number) {
  const el = { ...createShape('rectangle', x, 0), width: 10, height: 10 }
  st().commitDraft(el)
  return el
}

describe('store history', () => {
  it('creates one entry per committed action and undoes/redoes them', () => {
    const a = add(0)
    add(50)
    expect(live()).toHaveLength(2)
    st().undo()
    expect(live().map((e) => e.id)).toEqual([a.id])
    st().undo()
    expect(live()).toHaveLength(0)
    st().redo()
    expect(live()).toHaveLength(1)
    expect(st().selectedIds).toEqual([a.id])
  })

  it('does not create entries for transient updates and clears redo on new actions', () => {
    const a = add(0)
    const before = st().history.stack.length
    st().replaceElements([{ ...a, x: 99 }])
    expect(st().history.stack.length).toBe(before)
    st().undo()
    expect(st().history.index).toBe(0)
    add(5)
    expect(st().history.stack.length).toBe(2)
    st().redo()
    expect(st().history.index).toBe(1)
  })

  it('undo leaves viewport and tool untouched', () => {
    add(0)
    st().setViewport({ scrollX: 40, scrollY: 5, zoom: 2 })
    st().setTool('hand')
    st().undo()
    expect(st().viewport).toEqual({ scrollX: 40, scrollY: 5, zoom: 2 })
    expect(st().tool).toBe('hand')
  })

  it('delete and style changes are undoable and apply to the whole selection', () => {
    const a = add(0)
    const b = add(30)
    st().setSelection([a.id, b.id])
    st().applyStyle({ strokeColor: '#e03131' })
    expect(live().every((e) => e.strokeColor === '#e03131')).toBe(true)
    st().deleteSelected()
    expect(live()).toHaveLength(0)
    st().undo()
    expect(live()).toHaveLength(2)
    st().undo()
    expect(live().every((e) => e.strokeColor === '#1e1e1e')).toBe(true)
  })

  it('reorders the selection as one entry', () => {
    const a = add(0)
    const b = add(30)
    st().setSelection([a.id])
    st().reorderSelection('front')
    expect(live().map((e) => e.id)).toEqual([b.id, a.id])
    st().undo()
    expect(live().map((e) => e.id)).toEqual([a.id, b.id])
  })
})

describe('review fixes', () => {
  it('opening a file resets history and sets the file name with the scene', () => {
    add(0)
    const el = { ...createShape('rectangle', 5, 5), width: 10, height: 10 }
    st().openScene({ elements: [el], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT }, 'a.excalidraw')
    expect(st().fileName).toBe('a.excalidraw')
    expect(st().history.stack).toHaveLength(1)
    st().undo()
    expect(live().map((e) => e.id)).toEqual([el.id])
  })

  it('a pending nudge becomes its own entry before another action', () => {
    const a = add(0)
    st().setSelection([a.id])
    const before = st().history.stack.length
    st().nudgeSelection(1, 0)
    st().deleteSelected()
    expect(st().history.stack.length).toBe(before + 2)
    st().undo()
    expect(live()[0].x).toBe(1)
  })

  it('undo keeps the selection only with the selection tool', () => {
    const a = add(0)
    add(30)
    st().setSelection([a.id])
    st().setTool('hand')
    st().undo()
    expect(st().selectedIds).toEqual([])
    st().redo()
    st().setTool('selection')
    st().setSelection([a.id])
    st().undo()
    // undoing a creation changes no live element, so the selection is empty
    expect(st().selectedIds).toEqual([])
  })

  it('style changes on different selections do not merge', () => {
    const a = add(0)
    const b = add(30)
    st().setSelection([a.id])
    st().applyStyle({ opacity: 50 })
    st().setSelection([b.id])
    st().applyStyle({ opacity: 50 })
    expect(st().history.stack.length).toBe(5)
  })

  it('a drag that ends where it started creates no entry', () => {
    const a = add(0)
    const prior = st().elements
    const n = st().history.stack.length
    st().replaceElements([{ ...a, x: 40, version: a.version + 1 }])
    st().replaceElements([{ ...a, version: a.version + 2 }])
    st().endGesture('move', prior)
    expect(st().history.stack.length).toBe(n)
    expect(st().elements).toBe(prior)
  })
})

describe('point deletion', () => {
  it('Delete with a point selected never removes a two-point line', async () => {
    const { createLinear } = await import('../element/factory')
    const { deleteAction } = await import('./actions')
    const line = createLinear('line', 0, 0)
    const el = { ...line, points: [[0, 0], [50, 0]] as typeof line.points, width: 50 }
    st().commitDraft(el)
    st().setPointEdit({ id: el.id, selected: 1 })
    deleteAction()
    expect(live()).toHaveLength(1)
    expect(live()[0].isDeleted).toBe(false)
  })

  it('a nudge that fired during a gesture is flushed later', () => {
    const a = add(0)
    st().setSelection([a.id])
    const n = st().history.stack.length
    st().nudgeSelection(1, 0)
    st().flushPending()
    expect(st().history.stack.length).toBe(n + 1)
  })
})

describe('elbow path type', () => {
  const rectAt = (x: number, y: number) => ({ ...createShape('rectangle', x, y), width: 100, height: 50 })
  const arrowOf = () => live().find((e) => e.type === 'arrow') as LinearElement
  const absPoints = (a: LinearElement) => a.points.map(([x, y]) => ({ x: a.x + x, y: a.y + y }))
  const axisAligned = (a: LinearElement) => {
    const p = absPoints(a)
    return p.every((q, i) => i === 0 || Math.abs(q.x - p[i - 1].x) < 1e-6 || Math.abs(q.y - p[i - 1].y) < 1e-6)
  }

  function setup() {
    useStore.setState({ defaults: DEFAULT_STYLE_DEFAULTS })
    const a = rectAt(0, 0)
    const b = rectAt(300, 40)
    st().commitDraft(a)
    st().commitDraft(b)
    const arrow = withAbsolutePoints(createLinear('arrow', 100, 25), [[100, 25], [300, 65]])
    st().commitDraft(arrow, { start: a.id, end: b.id })
    return { a, b, id: arrow.id }
  }

  it('applies elbow, sharp and curved to a bound arrow', () => {
    const { a, b } = setup()
    st().applyStyle({ curve: 'elbow' })
    let arrow = arrowOf()
    expect(arrow.elbowed).toBe(true)
    expect(arrow.roundness).toBeNull()
    expect(axisAligned(arrow)).toBe(true)
    expect(arrow.points.length).toBeGreaterThan(2)

    st().applyStyle({ curve: 'sharp' })
    arrow = arrowOf()
    expect(arrow.elbowed).toBe(false)
    expect(arrow.points).toHaveLength(2)
    expect(arrow.roundness).toBeNull()
    const [p0, p1] = absPoints(arrow)
    const on = (shape: SceneElement, p: { x: number; y: number }) => {
      const q = outlinePointToward(shape, p)
      return Math.hypot(q.x - p.x, q.y - p.y) < 1e-6
    }
    expect(on(a, p0)).toBe(true)
    expect(on(b, p1)).toBe(true)

    st().applyStyle({ curve: 'elbow' })
    st().applyStyle({ curve: 'curved' })
    arrow = arrowOf()
    expect(arrow.elbowed).toBe(false)
    expect(arrow.points).toHaveLength(2)
    expect(arrow.roundness).toEqual({ type: 2 })
  })

  it('round-trips Recto, Codo, Curvo, Codo, Recto with one undo entry per step', () => {
    setup()
    const start = absPoints(arrowOf())
    const entries = st().history.stack.length
    for (const curve of ['elbow', 'curved', 'elbow', 'sharp'] as const) st().applyStyle({ curve })
    expect(st().history.stack.length).toBe(entries + 4)
    const end = absPoints(arrowOf())
    expect(end).toHaveLength(start.length)
    end.forEach((p, i) => {
      expect(p.x).toBeCloseTo(start[i].x, 6)
      expect(p.y).toBeCloseTo(start[i].y, 6)
    })
    for (let i = 0; i < 4; i++) st().undo()
    expect(st().history.stack.length).toBe(entries + 4)
    expect(arrowOf().elbowed).toBe(false)
    expect(absPoints(arrowOf())).toHaveLength(2)
  })

  it('treats elbow on a line as sharp and handles mixed selections', () => {
    const { id } = setup()
    const line = withAbsolutePoints(createLinear('line', 0, 200), [[0, 200], [80, 260]])
    st().commitDraft({ ...line, roundness: { type: 2 } })
    st().setSelection([id, line.id])
    st().applyStyle({ curve: 'elbow' })
    const l = live().find((e) => e.id === line.id) as LinearElement
    expect(l.elbowed).not.toBe(true)
    expect(l.roundness).toBeNull()
    expect(arrowOf().elbowed).toBe(true)
  })

  it('routes a newly committed elbow arrow between two shapes', () => {
    useStore.setState({ defaults: DEFAULT_STYLE_DEFAULTS })
    const a = rectAt(0, 0)
    const b = rectAt(300, 40)
    st().commitDraft(a)
    st().commitDraft(b)
    const draft = {
      ...withAbsolutePoints(createLinear('arrow', 100, 25, styleForNew({ ...DEFAULT_STYLE_DEFAULTS, curve: 'elbow' }, 'arrow')), [[100, 25], [300, 65]]),
    }
    expect(draft.elbowed).toBe(true)
    st().commitDraft(draft, { start: a.id, end: b.id })
    const arrow = arrowOf()
    expect(axisAligned(arrow)).toBe(true)
    expect(arrow.points.length).toBeGreaterThan(2)
    expect(arrow.roundness).toBeNull()
    expect((arrow.startBinding as { elementId: string }).elementId).toBe(a.id)
    expect((arrow.endBinding as { elementId: string }).elementId).toBe(b.id)
  })

  it('commits a multi-point elbow draft as a clean orthogonal route between its end points', () => {
    useStore.setState({ defaults: DEFAULT_STYLE_DEFAULTS })
    const draft = {
      ...withAbsolutePoints(createLinear('arrow', 0, 0, styleForNew({ ...DEFAULT_STYLE_DEFAULTS, curve: 'elbow' }, 'arrow')), [[0, 0], [50, 10], [60, 80], [200, 100]]),
    }
    st().commitDraft(draft)
    const p = absPoints(arrowOf())
    expect(axisAligned(arrowOf())).toBe(true)
    expect(p[0]).toEqual({ x: 0, y: 0 })
    expect(p[p.length - 1]).toEqual({ x: 200, y: 100 })
    for (let i = 1; i < p.length; i++) expect(Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y)).toBeGreaterThan(0)
  })

  it('undoes a newly committed elbow arrow in one step', () => {
    useStore.setState({ defaults: DEFAULT_STYLE_DEFAULTS })
    const before = st().history.stack.length
    const draft = withAbsolutePoints(createLinear('arrow', 0, 0, styleForNew({ ...DEFAULT_STYLE_DEFAULTS, curve: 'elbow' }, 'arrow')), [[0, 0], [200, 100]])
    st().commitDraft(draft)
    expect(st().history.stack.length).toBe(before + 1)
    st().undo()
    expect(live().filter((e) => e.type === 'arrow')).toHaveLength(0)
  })

  it('treats a zero-length elbow draft like a zero-length straight one', () => {
    useStore.setState({ defaults: DEFAULT_STYLE_DEFAULTS })
    const straight = createLinear('arrow', 10, 10)
    const elbow = { ...createLinear('arrow', 10, 10), elbowed: true }
    st().commitDraft(elbow)
    const a = arrowOf()
    expect(a.points).toEqual(straight.points)
    expect(Number.isFinite(a.x) && Number.isFinite(a.y)).toBe(true)
  })

  it('keeps a bound label attached and re-laid out when leaving elbow', () => {
    useStore.setState({ defaults: DEFAULT_STYLE_DEFAULTS })
    const arrow = { ...withAbsolutePoints(createLinear('arrow', 0, 0), [[0, 0], [100, 0], [100, 80]]), elbowed: true } as LinearElement
    const made = createLabel(arrow, 'hola')
    st().load({
      elements: [...attachLabel([arrow], made.container, made.label)],
      appState: DEFAULT_APP_STATE,
      files: {},
      viewport: DEFAULT_VIEWPORT,
    })
    st().setSelection([arrow.id])
    st().applyStyle({ curve: 'sharp' })
    const a = arrowOf()
    const label = live().find((e) => e.type === 'text')!
    expect((label as { containerId: string | null }).containerId).toBe(arrow.id)
    expect(a.boundElements).toContainEqual({ type: 'text', id: label.id })
    expect(label.x + label.width / 2).toBeCloseTo(a.x + a.points[1][0] / 2, 0)
    expect(label.y + label.height / 2).toBeCloseTo(a.y + a.points[1][1] / 2, 0)
  })

  it('previews a routed draft that equals the committed arrow', () => {
    useStore.setState({ defaults: DEFAULT_STYLE_DEFAULTS })
    const a = rectAt(0, 0)
    const b = rectAt(300, 40)
    st().commitDraft(a)
    st().commitDraft(b)
    const draft = withAbsolutePoints(
      createLinear('arrow', 100, 25, styleForNew({ ...DEFAULT_STYLE_DEFAULTS, curve: 'elbow' }, 'arrow')),
      [[100, 25], [300, 65]],
    )
    const preview = rerouteElbowArrow(draft, (id) => st().elements.find((e) => e.id === id), { start: a.id, end: b.id })
    expect(axisAligned(preview)).toBe(true)
    st().commitDraft(draft, { start: a.id, end: b.id })
    const committed = arrowOf()
    const p = absPoints(preview)
    const c = absPoints(committed)
    expect(c).toHaveLength(p.length)
    c.forEach((q, i) => {
      expect(q.x).toBeCloseTo(p[i].x, 6)
      expect(q.y).toBeCloseTo(p[i].y, 6)
    })
  })

  it('overrides free a bound end without clearing its binding and bind a free end', () => {
    const { a, b } = setup()
    const lookup = (i: string) => st().elements.find((e) => e.id === i)
    const arrow = arrowOf()
    const freed = rerouteElbowArrow(arrow, lookup, { end: null })
    expect(axisAligned(freed)).toBe(true)
    expect((freed.endBinding as { elementId: string }).elementId).toBe(b.id)
    expect((freed.startBinding as { elementId: string }).elementId).toBe(a.id)
    const bound = rerouteElbowArrow({ ...arrow, endBinding: null }, lookup, { end: b.id })
    expect((bound.endBinding as { elementId: string }).elementId).toBe(b.id)
  })

  it('refuses to bind both ends of an arrow to one shape, which the drag preview mirrors', () => {
    const { a, id } = setup()
    const els = bindArrowEnd(st().elements, id, 'end', a.id)
    const arrow = els.find((e) => e.id === id) as LinearElement
    expect(arrow.endBinding).toBeNull()
    expect((arrow.startBinding as { elementId: string }).elementId).toBe(a.id)
  })

  it('re-routes with a free end when a bound shape is deleted or one end is unbound', () => {
    const { b, id } = setup()
    st().applyStyle({ curve: 'elbow' })
    const oldEnd = absPoints(arrowOf()).at(-1)!
    st().unbindEnd(id, 'end')
    let arrow = arrowOf()
    expect(arrow.endBinding).toBeNull()
    expect(arrow.startBinding).not.toBeNull()
    expect(axisAligned(arrow)).toBe(true)
    expect(absPoints(arrow).at(-1)!.x).toBeCloseTo(oldEnd.x)
    st().setSelection([b.id])
    st().deleteSelected()
    arrow = arrowOf()
    expect(axisAligned(arrow)).toBe(true)
    expect(arrow.points.length).toBeGreaterThanOrEqual(2)
  })

  it('leaves point editing when the edited arrow becomes elbow', () => {
    const { id } = setup()
    st().setPointEdit({ id, selected: null })
    expect(st().pointEdit).not.toBeNull()
    st().applyStyle({ curve: 'elbow' })
    expect(st().pointEdit).toBeNull()
  })

  it('has no rotate, mid or interior point handles', () => {
    setup()
    st().applyStyle({ curve: 'elbow' })
    const arrow = arrowOf()
    for (const edit of [false, true]) {
      const kinds = getHandlePositions(arrow, edit, 1).map((h) => h.handle.kind)
      expect(kinds).toEqual(['point', 'point'])
    }
    const straight = { ...arrow, elbowed: false }
    expect(getHandlePositions(straight, false, 1).map((h) => h.handle.kind)).toContain('rotate')
  })

  it('ignores point editing and point deletion on elbow arrows only', () => {
    const { id } = setup()
    st().applyStyle({ curve: 'elbow' })
    st().setPointEdit({ id, selected: null })
    expect(st().pointEdit).toBeNull()
    st().applyStyle({ curve: 'sharp' })
    st().setPointEdit({ id, selected: null })
    expect(st().pointEdit).toEqual({ id, selected: null })
    st().setPointEdit(null)
    st().applyStyle({ curve: 'elbow' })
    useStore.setState({ pointEdit: { id, selected: 1 } })
    const before = arrowOf()
    expect(st().deletePoint()).toBe(false)
    expect(arrowOf()).toBe(before)
  })

  it('keeps its shape when a bound elbow arrow is detached and moved', () => {
    const { id } = setup()
    st().applyStyle({ curve: 'elbow' })
    const before = arrowOf()
    st().detachArrows(new Set([id]), new Set())
    const detached = arrowOf()
    expect(detached.startBinding).toBeNull()
    expect(detached.endBinding).toBeNull()
    expect(detached.points).toEqual(before.points)
    st().replaceElements([moveElement(detached, 50, 20)])
    expect(arrowOf().points).toEqual(before.points)
    expect(arrowOf().x).toBeCloseTo(before.x + 50)
  })
})
