import { beforeEach, describe, expect, it } from 'vitest'
import { createLinear, createShape } from '../element/factory'
import { withAbsolutePoints, getAbsolutePoints } from '../element/geometry'
import { pointInsideElement, BIND_GAP } from '../element/bind'
import { parseLibrary } from '../element/library'
import { SHORTCUTS, matchesBinding, bindingChips } from '../ui/shortcuts'
import type { Binding } from '../ui/shortcuts'
import { targetOwnsKey } from '../ui/dom'
import { transformColor } from '../render/color'
import { DEFAULT_APP_STATE, coerceAppState, parseScene } from './serialize'
import { DEFAULT_VIEWPORT } from './viewport'
import { useStore } from './store'
import type { LinearElement } from '../element/types'

const st = () => useStore.getState()
const rect = (x: number, y: number, w: number, h: number) => ({ ...createShape('rectangle', x, y), width: w, height: h })
const arrowBetween = (x1: number, y1: number, x2: number, y2: number): LinearElement =>
  withAbsolutePoints(createLinear('arrow', x1, y1), [
    [x1, y1],
    [x2, y2],
  ])
const find = (id: string) => st().elements.find((e) => e.id === id)!

beforeEach(() => {
  st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
})

function key(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: '', ...init } as unknown as KeyboardEvent
}

describe('A2 keyboard layout independence', () => {
  it('has no punctuation physical-code bindings', () => {
    const codes = SHORTCUTS.flatMap((s) => s.keys).filter((b) => b.code)
    for (const b of codes) expect(b.code).toMatch(/^Key[A-Z]$/)
    expect(JSON.stringify(SHORTCUTS.map((s) => s.keys))).not.toContain('Bracket')
  })

  it('zooms with Ctrl and + typed on a Spanish keyboard, never reordering layers', () => {
    const e = key({ key: '+', code: 'BracketRight', ctrlKey: true })
    const hits = SHORTCUTS.filter((s) => s.keys.some((b) => matchesBinding(b, e))).map((s) => s.id)
    expect(hits).toEqual(['view.zoomIn'])
    const minus = SHORTCUTS.filter((s) => s.keys.some((b) => matchesBinding(b, key({ key: '-', code: 'NumpadSubtract', ctrlKey: true })))).map((s) => s.id)
    expect(minus).toEqual(['view.zoomOut'])
    const zero = SHORTCUTS.filter((s) => s.keys.some((b) => matchesBinding(b, key({ key: '0', code: 'Numpad0', ctrlKey: true })))).map((s) => s.id)
    expect(zero).toEqual(['view.zoomReset'])
  })

  it('labels keys as on a Spanish keyboard', () => {
    const b: Binding = { key: 'delete', mod: true, shift: true }
    expect(bindingChips(b, 'other')).toEqual(['Ctrl', 'Mayús', 'Supr'])
    expect(bindingChips({ key: 'enter' }, 'other')).toEqual(['Intro'])
    expect(bindingChips({ key: 'arrowup', mod: true }, 'other')).toEqual(['Ctrl', '↑'])
  })
})

describe('A3 key filtering per element', () => {
  const fake = (tagName: string, type = '', attrs: Record<string, string> = {}) => ({
    tagName,
    type,
    getAttribute: (n: string) => attrs[n] ?? null,
  })
  const input = (type: string) => fake('INPUT', type)
  it('lets a range input keep only its own keys', () => {
    const r = input('range')
    expect(targetOwnsKey(r, { key: 'ArrowLeft' })).toBe(true)
    expect(targetOwnsKey(r, { key: 'Home' })).toBe(true)
    expect(targetOwnsKey(r, { key: 'z' })).toBe(false)
    expect(targetOwnsKey(r, { key: 'Delete' })).toBe(false)
    expect(targetOwnsKey(r, { key: 'Escape' })).toBe(false)
  })
  it('blocks every key only for text-like fields', () => {
    expect(targetOwnsKey(input('text'), { key: 'z' })).toBe(true)
    expect(targetOwnsKey(input('number'), { key: 'Delete' })).toBe(true)
    expect(targetOwnsKey(fake('TEXTAREA'), { key: 'a' })).toBe(true)
    for (const t of ['checkbox', 'radio', 'color']) expect(targetOwnsKey(input(t), { key: 'z' })).toBe(false)
  })
  it('leaves Enter and Space to buttons', () => {
    const b = fake('BUTTON')
    expect(targetOwnsKey(b, { key: 'Enter' })).toBe(true)
    expect(targetOwnsKey(b, { key: ' ', code: 'Space' })).toBe(true)
    expect(targetOwnsKey(b, { key: 'z' })).toBe(false)
    const tab = fake('DIV', '', { role: 'tab' })
    expect(targetOwnsKey(tab, { key: 'Enter' })).toBe(true)
    expect(targetOwnsKey(fake('BODY'), { key: 'Enter' })).toBe(false)
  })
})

describe('A4 selection after undo and redo', () => {
  it('selects every element a multi-element step changed', () => {
    const els = [rect(0, 0, 10, 10), rect(50, 0, 10, 10), rect(100, 0, 10, 10)]
    for (const e of els) st().commitDraft(e)
    st().setTool('selection')
    st().setSelection(els.map((e) => e.id))
    st().applyStyle({ strokeColor: '#e03131' })
    st().setSelection([])
    st().undo()
    expect([...st().selectedIds].sort()).toEqual(els.map((e) => e.id).sort())
    st().redo()
    expect([...st().selectedIds].sort()).toEqual(els.map((e) => e.id).sort())
  })

  it('undoing a creation leaves an empty selection', () => {
    st().commitDraft(rect(0, 0, 10, 10))
    st().undo()
    expect(st().selectedIds).toEqual([])
  })
})

describe('A5 and A8 bound arrow ends', () => {
  it('puts a bound end on the outline right after binding', () => {
    const target = rect(200, 0, 100, 100)
    const arrow = arrowBetween(0, 50, 250, 50)
    st().insertElements([target, arrow])
    st().bindEnds(arrow.id, { end: target.id })
    const pts = getAbsolutePoints(find(arrow.id) as LinearElement)
    const end = pts[pts.length - 1]
    expect(end[0]).toBeCloseTo(200 - BIND_GAP, 3)
    expect(pointInsideElement(find(target.id), end[0], end[1])).toBe(false)
  })

  it('places the end on the outline when the arrow is committed with a binding', () => {
    const target = rect(200, 0, 100, 100)
    st().commitDraft(target)
    const arrow = arrowBetween(0, 50, 250, 50)
    st().commitDraft(arrow, { end: target.id })
    const pts = getAbsolutePoints(find(arrow.id) as LinearElement)
    expect(pts[pts.length - 1][0]).toBeCloseTo(200 - BIND_GAP, 3)
  })

  it('does not bind the end being placed when it would reverse the arrow between overlapping shapes', () => {
    const a = rect(0, 0, 100, 100)
    const b = rect(60, 0, 100, 100)
    st().insertElements([a, b])
    const arrow = arrowBetween(20, 50, 140, 50)
    st().commitDraft(arrow, { start: a.id, end: b.id })
    const el = find(arrow.id) as LinearElement
    const pts = getAbsolutePoints(el)
    expect(pts[pts.length - 1][0]).toBeGreaterThan(pts[0][0])
    expect(el.endBinding).toBeNull()
    expect(pts[pts.length - 1][0]).toBeCloseTo(140, 3)
  })
})

describe('A6 appState coercion', () => {
  it('replaces wrong-typed fields with defaults', () => {
    for (const bad of [5, null, {}, '']) {
      const s = coerceAppState({ viewBackgroundColor: bad, gridModeEnabled: 'yes', gridSize: -3, objectsSnapModeEnabled: 1 })
      expect(s.viewBackgroundColor).toBe('#ffffff')
      expect(s.gridModeEnabled).toBe(false)
      expect(s.gridSize).toBe(DEFAULT_APP_STATE.gridSize)
      expect(s.objectsSnapModeEnabled).toBe(true)
    }
    expect(coerceAppState('nope').viewBackgroundColor).toBe('#ffffff')
    expect(coerceAppState({ viewBackgroundColor: '#123456', custom: 1 })).toMatchObject({ viewBackgroundColor: '#123456', custom: 1 })
  })

  it('parseScene sanitizes the appState and the color transform tolerates non-strings', () => {
    const scene = parseScene({ elements: [], appState: { viewBackgroundColor: 5 } })
    expect(scene?.appState.viewBackgroundColor).toBe('#ffffff')
    expect(() => transformColor(5 as unknown as string)).not.toThrow()
    expect(() => transformColor(null as unknown as string)).not.toThrow()
  })
})

describe('A13 library import', () => {
  const lib = (items: unknown[]) => ({ type: 'excalidrawlib', version: 2, libraryItems: items })
  const item = (id: string) => ({ id, status: 'unpublished', created: 1, elements: [rect(0, 0, 10, 10)] })

  it('reports how many items were actually added', () => {
    const items = parseLibrary(lib([item('a'), item('b')]))!
    expect(st().importLibraryItems(items)).toBe(2)
    expect(st().importLibraryItems(items)).toBe(0)
    expect(st().library).toHaveLength(2)
  })

  it('treats a file whose items are all invalid as not a library', () => {
    expect(parseLibrary(lib([{ id: 'x', elements: [{ nope: true }] }]))).toBeNull()
    expect(parseLibrary(lib([]))).toEqual([])
  })
})
