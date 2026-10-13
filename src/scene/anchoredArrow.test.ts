import { beforeEach, describe, expect, it } from 'vitest'
import { createLinear, createShape } from '../element/factory'
import { getAbsolutePoints, withAbsolutePoints } from '../element/geometry'
import { anchorArrowPreview, clickEndsArrow, outlinePointToward } from '../element/bind'
import { bindingTarget } from '../element/relations'
import type { LinearElement } from '../element/types'
import { useStore } from './store'
import { DEFAULT_APP_STATE } from './serialize'
import { DEFAULT_VIEWPORT } from './viewport'

const st = () => useStore.getState()

beforeEach(() => {
  st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
})

function shapes() {
  const a = { ...createShape('rectangle', 300, 300), width: 140, height: 80 }
  const b = { ...createShape('ellipse', 800, 300), width: 140, height: 80 }
  st().commitDraft(a)
  st().commitDraft(b)
  return { a, b }
}

describe('arrows anchored at both ends', () => {
  for (const roundness of [false, true]) {
    for (const mid of [false, true]) {
      it(`binds start and end on the outlines (curved ${roundness}, intermediate ${mid})`, () => {
        const { a, b } = shapes()
        const pts: [number, number][] = mid ? [[370, 340], [600, 200], [870, 340]] : [[370, 340], [870, 340]]
        const base = createLinear('arrow', 370, 340)
        const arrow = withAbsolutePoints(roundness ? { ...base, roundness: { type: 2 } } : base, pts) as LinearElement
        st().commitDraft(arrow, { start: a.id, end: b.id })
        const out = st().elements.find((e) => e.id === arrow.id) as LinearElement
        expect(bindingTarget(out.startBinding)).toBe(a.id)
        expect(bindingTarget(out.endBinding)).toBe(b.id)
        const abs = getAbsolutePoints(out)
        const first = outlinePointToward(a, { x: abs[1][0], y: abs[1][1] })
        const last = outlinePointToward(b, { x: abs[abs.length - 2][0], y: abs[abs.length - 2][1] })
        expect(abs[0][0]).toBeCloseTo(first.x, 3)
        expect(abs[0][1]).toBeCloseTo(first.y, 3)
        expect(abs[abs.length - 1][0]).toBeCloseTo(last.x, 3)
        expect(abs[abs.length - 1][1]).toBeCloseTo(last.y, 3)
      })
    }
  }

  it('previews the same ends the committed arrow gets', () => {
    const { a, b } = shapes()
    const arrow = withAbsolutePoints(createLinear('arrow', 370, 340), [[370, 340], [870, 340]]) as LinearElement
    const prev = getAbsolutePoints(anchorArrowPreview(arrow, a, b))
    st().commitDraft(arrow, { start: a.id, end: b.id })
    const done = getAbsolutePoints(st().elements.find((e) => e.id === arrow.id) as LinearElement)
    expect(prev[0][0]).toBeCloseTo(done[0][0], 3)
    expect(prev[1][0]).toBeCloseTo(done[1][0], 3)
  })
})

describe('clickEndsArrow', () => {
  const base = { tool: 'arrow' as const, elbowed: false, target: 'b', startTarget: 'a', fixedCount: 1, noBind: false }
  it('ends on another shape', () => expect(clickEndsArrow(base)).toBe(true))
  it('ignores lines', () => expect(clickEndsArrow({ ...base, tool: 'line' })).toBe(false))
  it('ignores empty canvas', () => expect(clickEndsArrow({ ...base, target: null })).toBe(false))
  it('ignores the start shape with only the first point', () =>
    expect(clickEndsArrow({ ...base, target: 'a' })).toBe(false))
  it('accepts the start shape once there are more points', () =>
    expect(clickEndsArrow({ ...base, target: 'a', fixedCount: 2 })).toBe(true))
  it('does nothing while Ctrl is held', () => expect(clickEndsArrow({ ...base, noBind: true })).toBe(false))
  it('leaves elbow arrows to their two-click rule', () => expect(clickEndsArrow({ ...base, elbowed: true })).toBe(false))
})
