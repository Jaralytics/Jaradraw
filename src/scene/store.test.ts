import { beforeEach, describe, expect, it } from 'vitest'
import { createShape } from '../element/factory'
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
