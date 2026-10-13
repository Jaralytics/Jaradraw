import { describe, expect, it } from 'vitest'
import { createShape, createText } from '../element/factory'
import { CLIPBOARD_TYPE, parseClipboard, serializeClipboard } from './clipboard'

describe('clipboard', () => {
  it('round-trips elements through the excalidraw clipboard format', () => {
    const els = [createShape('rectangle', 1, 2), createText(5, 5, 'hola', { width: 40, height: 25 })]
    const text = serializeClipboard(els)
    expect(JSON.parse(text)).toMatchObject({ type: CLIPBOARD_TYPE, files: {} })
    expect(parseClipboard(text)).toEqual(els)
  })

  it('keeps unknown fields and types', () => {
    const text = JSON.stringify({
      type: CLIPBOARD_TYPE,
      elements: [{ id: 'a', type: 'freedraw', x: 1, extra: { k: 1 } }],
      files: {},
    })
    const out = parseClipboard(text) as unknown as Record<string, unknown>[]
    expect(out[0].extra).toEqual({ k: 1 })
    expect(out[0].type).toBe('freedraw')
  })

  it('rejects foreign JSON and plain text', () => {
    expect(parseClipboard('hello')).toBeNull()
    expect(parseClipboard('{"a":1}')).toBeNull()
    expect(parseClipboard('{"type":"other","elements":[]}')).toBeNull()
    expect(parseClipboard(JSON.stringify({ type: CLIPBOARD_TYPE, elements: [] }))).toBeNull()
    expect(parseClipboard('null')).toBeNull()
  })
})
