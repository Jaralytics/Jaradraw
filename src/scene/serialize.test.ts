import { describe, expect, it } from 'vitest'
import { createLinear, createShape, createText } from '../element/factory'
import { parseScene, serializeScene } from './serialize'

describe('serialization', () => {
  it('serialize then parse equals input', () => {
    const elements = [
      createShape('rectangle', 1, 2, { strokeColor: '#e03131' }),
      createShape('ellipse', 5, 5, { backgroundColor: '#a5d8ff' }),
      createShape('diamond', 0, 0),
      createLinear('arrow', 10, 10),
      createLinear('line', 3, 3),
      createText(0, 0, 'a\nb', { width: 12, height: 50 }),
    ]
    const file = serializeScene(elements, { gridSize: null, viewBackgroundColor: '#fafafa' })
    const parsed = parseScene(JSON.parse(JSON.stringify(file)))
    expect(parsed).not.toBeNull()
    expect(parsed!.elements).toEqual(elements)
    expect(parsed!.appState.viewBackgroundColor).toBe('#fafafa')
    expect(file.type).toBe('excalidraw')
    expect(file.version).toBe(2)
    expect(file.source).toBe('jaradraw')
  })

  it('keeps unknown element types and unknown extra fields', () => {
    const sample = {
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: [
        {
          id: 'f1',
          type: 'freedraw',
          x: 1,
          y: 2,
          width: 10,
          height: 10,
          points: [[0, 0], [5, 5]],
          pressures: [0.5, 0.6],
          simulatePressure: true,
          customThing: { nested: [1, 2, 3] },
        },
        { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 5, height: 5, futureField: 'keep-me' },
      ],
      appState: { gridSize: 20, viewBackgroundColor: '#ffffff', theme: 'dark' },
      files: { abc: { id: 'abc', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA', created: 1, lastRetrieved: 1 } },
    }
    const parsed = parseScene(sample)!
    const again = parseScene(JSON.parse(JSON.stringify(serializeScene(parsed.elements, parsed.appState, parsed.files))))!
    expect(again.elements).toEqual(parsed.elements)

    const free = again.elements[0] as unknown as Record<string, unknown>
    expect(free.type).toBe('freedraw')
    expect(free.pressures).toEqual([0.5, 0.6])
    expect(free.customThing).toEqual({ nested: [1, 2, 3] })
    const rect = again.elements[1] as unknown as Record<string, unknown>
    expect(rect.futureField).toBe('keep-me')
    expect(again.appState.theme).toBe('dark')
    expect(again.appState.gridSize).toBe(20)
    expect(again.files).toEqual(sample.files)
  })

  it('fills missing fields with defaults', () => {
    const parsed = parseScene({ elements: [{ type: 'arrow', id: 'a' }, { type: 'text', id: 't', text: 'x' }] })!
    const arrow = parsed.elements[0] as unknown as Record<string, unknown>
    expect(arrow.strokeColor).toBe('#1e1e1e')
    expect(arrow.backgroundColor).toBe('transparent')
    expect(arrow.fillStyle).toBe('solid')
    expect(arrow.strokeWidth).toBe(2)
    expect(arrow.roughness).toBe(1)
    expect(arrow.opacity).toBe(100)
    expect(arrow.isDeleted).toBe(false)
    expect(arrow.endArrowhead).toBe('arrow')
    expect(arrow.points).toEqual([[0, 0], [0, 0]])
    expect(typeof arrow.seed).toBe('number')
    const text = parsed.elements[1] as unknown as Record<string, unknown>
    expect(text.fontSize).toBe(20)
    expect(text.fontFamily).toBe(2)
    expect(text.lineHeight).toBe(1.25)
    expect(parsed.appState).toEqual({
      gridSize: 20,
      gridStep: 5,
      gridModeEnabled: false,
      objectsSnapModeEnabled: true,
      viewBackgroundColor: '#ffffff',
    })
  })

  it('coerces malformed known fields and repairs bad points', () => {
    const parsed = parseScene({
      elements: [
        { id: 'r', type: 'rectangle', x: 'a', width: null, strokeColor: 5, fillStyle: 'bogus' },
        { id: 't', type: 'text', text: null, fontSize: null, lineHeight: 0 },
        { id: 'l', type: 'line', points: [[0], [1, 2], 'x'] },
        { id: 'k', type: 'arrow', points: [[0, 0], [3, 4], [NaN, 1]] },
        { id: 'f', type: 'freedraw', points: [[0], 5] },
      ],
    })!
    const [r, t, l, k, f] = parsed.elements as unknown as Record<string, unknown>[]
    expect(r.x).toBe(0)
    expect(r.width).toBe(0)
    expect(r.strokeColor).toBe('#1e1e1e')
    expect(r.fillStyle).toBe('solid')
    expect(t.text).toBe('')
    expect(t.fontSize).toBe(20)
    expect(t.lineHeight).toBe(1.25)
    expect(l.points).toEqual([[0, 0], [0, 0]])
    expect(k.points).toEqual([[0, 0], [3, 4]])
    expect(f.points).toEqual([[0, 0]])
  })

  it('rejects invalid input without throwing', () => {
    expect(parseScene(null)).toBeNull()
    expect(parseScene({ elements: 'nope' })).toBeNull()
    expect(parseScene({ elements: [null, 3, { noType: true }] })!.elements).toEqual([])
  })
})

describe('elbow arrows', () => {
  it('round-trips the elbow fields', () => {
    const shape = createShape('rectangle', 0, 0)
    const arrow = {
      ...createLinear('arrow', 0, 0),
      elbowed: true,
      roundness: null,
      fixedSegments: null,
      startIsSpecial: null,
      endIsSpecial: null,
      startBinding: { elementId: shape.id, focus: 0, gap: 4, fixedPoint: [1.0001, 0.5001] },
    }
    const parsed = parseScene(JSON.parse(JSON.stringify(serializeScene([shape, arrow]))))!
    expect(parsed.elements[1]).toMatchObject({
      elbowed: true,
      roundness: null,
      fixedSegments: null,
      startIsSpecial: null,
      endIsSpecial: null,
      startBinding: { fixedPoint: [1.0001, 0.5001] },
    })
  })
})
