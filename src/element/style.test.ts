import { describe, expect, it } from 'vitest'
import { createLinear, createShape, createText } from './factory'
import { withAbsolutePoints } from './geometry'
import type { LinearElement } from './types'
import { applyStyleToElement, cornerRadius, curveOf, roundnessFor, styleForNew, DEFAULT_STYLE_DEFAULTS } from './style'
import { parseScene } from '../scene/serialize'

describe('roundness', () => {
  it('maps edges to excalidraw roundness per type', () => {
    expect(roundnessFor('rectangle', 'round')).toEqual({ type: 3 })
    expect(roundnessFor('diamond', 'round')).toEqual({ type: 2 })
    expect(roundnessFor('arrow', 'round')).toEqual({ type: 2 })
    expect(roundnessFor('rectangle', 'sharp')).toBeNull()
    expect(roundnessFor('ellipse', 'round')).toBeUndefined()
    expect(roundnessFor('text', 'round')).toBeUndefined()
  })

  it('computes corner radius for adaptive and proportional roundness', () => {
    expect(cornerRadius({ roundness: null, width: 100, height: 100 })).toBe(0)
    expect(cornerRadius({ roundness: { type: 3 }, width: 100, height: 40 })).toBe(10)
    expect(cornerRadius({ roundness: { type: 3 }, width: 400, height: 400 })).toBe(32)
    expect(cornerRadius({ roundness: { type: 2 }, width: 100, height: 80 })).toBe(20)
    expect(cornerRadius({ roundness: { type: 3, value: 8 }, width: 100, height: 80 })).toBe(8)
  })

  it('parses roundness from files and repairs invalid values', () => {
    const p = parseScene({
      elements: [
        { id: 'a', type: 'rectangle', roundness: { type: 3 } },
        { id: 'b', type: 'diamond', roundness: { type: 2, value: 0.3 } },
        { id: 'c', type: 'rectangle', roundness: 'round' },
        { id: 'd', type: 'rectangle' },
      ],
    })!
    const r = p.elements as unknown as { roundness: unknown }[]
    expect(r[0].roundness).toEqual({ type: 3 })
    expect(r[1].roundness).toEqual({ type: 2, value: 0.3 })
    expect(r[2].roundness).toBeNull()
    expect(r[3].roundness).toBeNull()
  })
})

describe('style application', () => {
  it('applies only relevant props per element type', () => {
    const rect = createShape('rectangle', 0, 0)
    const text = createText(0, 0, 'a', { width: 5, height: 5 })
    const patch = { backgroundColor: '#ffc9c9', strokeWidth: 4, opacity: 50, edges: 'round' as const }
    const r = applyStyleToElement(rect, patch)
    expect(r).toMatchObject({ backgroundColor: '#ffc9c9', strokeWidth: 4, opacity: 50, roundness: { type: 3 } })
    expect(r.version).toBe(rect.version + 1)
    const t = applyStyleToElement(text, patch)
    expect(t).toMatchObject({ opacity: 50, strokeWidth: 2, backgroundColor: 'transparent', roundness: null })
    expect(applyStyleToElement(text, { backgroundColor: '#fff' })).toBe(text)
  })

  it('builds creation style from defaults', () => {
    const s = styleForNew({ ...DEFAULT_STYLE_DEFAULTS, edges: 'round', strokeWidth: 4 }, 'rectangle')
    expect(s).toMatchObject({ strokeWidth: 4, roundness: { type: 3 } })
    expect('edges' in s).toBe(false)
    expect('roundness' in styleForNew({ ...DEFAULT_STYLE_DEFAULTS, edges: 'round' }, 'ellipse')).toBe(false)
  })
})

describe('curve option', () => {
  const arrow = (extra: Record<string, unknown> = {}) =>
    ({ ...withAbsolutePoints(createLinear('arrow', 0, 0), [[0, 0], [100, 0], [100, 60]]), ...extra }) as LinearElement

  it('maps elbow to elbowed arrows and sharp for lines in styleForNew', () => {
    const d = { ...DEFAULT_STYLE_DEFAULTS, curve: 'elbow' as const }
    expect(styleForNew(d, 'arrow')).toMatchObject({ elbowed: true, roundness: null })
    const line = styleForNew(d, 'line')
    expect(line.elbowed).toBeUndefined()
    expect(line.roundness).toBeNull()
  })

  it('applies elbow to arrows and treats it as sharp on lines', () => {
    const a = applyStyleToElement(arrow({ roundness: { type: 2 } }), { curve: 'elbow' }) as LinearElement
    expect(a.elbowed).toBe(true)
    expect(a.roundness).toBeNull()
    const line = applyStyleToElement(createLinear('line', 0, 0, { roundness: { type: 2 } }), { curve: 'elbow' }) as LinearElement
    expect(line.elbowed).not.toBe(true)
    expect(line.roundness).toBeNull()
  })

  it('collapses an elbow arrow to a straight one when switching away', () => {
    const e = arrow({ elbowed: true })
    const sharp = applyStyleToElement(e, { curve: 'sharp' }) as LinearElement
    expect(sharp.elbowed).toBe(false)
    expect(sharp.points).toEqual([[0, 0], [100, 60]])
    expect(sharp.width).toBe(100)
    expect(sharp.height).toBe(60)
    const curved = applyStyleToElement(e, { curve: 'curved' }) as LinearElement
    expect(curved.points).toHaveLength(2)
    expect(curved.roundness).toEqual({ type: 2 })
  })

  it('leaves a non-elbow arrow with the previous behaviour', () => {
    const a = arrow()
    const sharp = applyStyleToElement(a, { curve: 'sharp' }) as LinearElement
    expect(sharp.points).toEqual(a.points)
    expect(sharp.elbowed).toBe(false)
  })

  it('reads elbow from an imported arrow', () => {
    const p = parseScene({ elements: [{ id: 'x', type: 'arrow', elbowed: true, roundness: null }] })!
    expect(curveOf(p.elements[0] as LinearElement)).toBe('elbow')
    expect(curveOf(arrow({ roundness: { type: 2 } }))).toBe('curved')
    expect(curveOf(arrow())).toBe('sharp')
  })
})

describe('leaving elbow', () => {
  it('keeps the real first and last points of a free arrow', () => {
    const e = {
      ...withAbsolutePoints(createLinear('arrow', 0, 0), [[50, 70], [150, 70], [150, 130]]),
      elbowed: true,
    } as LinearElement
    const out = applyStyleToElement(e, { curve: 'sharp' }) as LinearElement
    expect(out.x).toBe(50)
    expect(out.y).toBe(70)
    expect(out.points).toEqual([[0, 0], [100, 60]])
  })

  it('resets the elbow bookkeeping fields', () => {
    const e = {
      ...withAbsolutePoints(createLinear('arrow', 0, 0), [[0, 0], [100, 0], [100, 60]]),
      elbowed: true,
      fixedSegments: [{ index: 1, start: [1, 1], end: [2, 2] }],
      startIsSpecial: true,
      endIsSpecial: true,
    } as LinearElement
    const out = applyStyleToElement(e, { curve: 'curved' }) as LinearElement
    expect(out.fixedSegments).toBeNull()
    expect(out.startIsSpecial).toBeNull()
    expect(out.endIsSpecial).toBeNull()
  })
})
