import { describe, expect, it } from 'vitest'
import { createShape } from '../element/factory'
import { canCollect, createImageElement, missingFileIds, sanitizeFiles } from '../element/image'
import { assignFrames, createFrame } from '../element/frame'
import { mergeLibrary } from '../element/library'
import type { LibraryItem } from '../element/library'
import { setColorResolver, transformColor } from '../render/color'
import { exportBounds, effectiveScale } from '../render/bounds'
import { escapeXml } from '../render/svg'
import { adoptHandle, fileIdentityHandle, getCurrentHandle } from './files'
import type { FileHandleLike } from './files'
import { useStore } from './store'
import type { SceneElement } from '../element/types'

const good = { id: 'a', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA', created: 1, lastRetrieved: 1 }
const handle = { name: 'A.excalidraw' } as FileHandleLike

describe('file identity on open', () => {
  it('keeps a handle only for scene files', () => {
    expect(fileIdentityHandle({ name: 'A.excalidraw' }, handle)).toBe(handle)
    expect(fileIdentityHandle({ name: 'b.json' }, handle)).toBe(handle)
    expect(fileIdentityHandle({ name: 'b.png' }, handle)).toBeNull()
    expect(fileIdentityHandle({ name: 'b.svg' }, handle)).toBeNull()
    expect(fileIdentityHandle({ name: 'dropped.excalidraw' }, null)).toBeNull()
  })

  it('adopting null forgets the previous handle', () => {
    adoptHandle(handle)
    expect(getCurrentHandle()).toBe(handle)
    adoptHandle(null)
    expect(getCurrentHandle()).toBeNull()
  })
})

describe('missing binaries and file validation', () => {
  it('detects live images without data', () => {
    const a = createImageElement('a', 0, 0, 1, 1)
    const b = createImageElement('b', 0, 0, 1, 1)
    const gone = { ...createImageElement('c', 0, 0, 1, 1), isDeleted: true }
    expect(missingFileIds([a, b, gone], { a: good, b: { id: 'b', mimeType: 'image/png' } })).toEqual(['b'])
  })

  it('applies the 24 hour age rule to garbage collection', () => {
    const now = 10 * 24 * 3600 * 1000
    expect(canCollect(now - 3600 * 1000, now)).toBe(false)
    expect(canCollect(now - 25 * 3600 * 1000, now)).toBe(true)
    expect(canCollect(undefined, now)).toBe(false)
  })

  it('accepts only base64 image data URLs with a matching mimeType', () => {
    const out = sanitizeFiles({
      a: good,
      http: { ...good, id: 'http', dataURL: 'https://example.com/x.png' },
      mime: { ...good, mimeType: 'image/jpeg' },
      html: { ...good, mimeType: 'text/html', dataURL: 'data:text/html;base64,AAAA' },
      nodata: { id: 'nodata', mimeType: 'image/png' },
    })
    expect(Object.keys(out)).toEqual(['a'])
  })

  it('never overwrites an entry that already has data', () => {
    const other = { ...good, dataURL: 'data:image/png;base64,BBBB' }
    expect(sanitizeFiles({ a: other }, { a: good })).toEqual({})
    useStore.setState({ files: { a: good } })
    useStore.getState().addFiles({ a: other, b: { ...good, id: 'b' } })
    const files = useStore.getState().files as Record<string, { dataURL: string }>
    expect(files.a.dataURL).toBe(good.dataURL)
    expect(files.b).toBeDefined()
  })
})

describe('library merge', () => {
  const item = (id: string): LibraryItem => ({ id, status: 'unpublished', elements: [], created: 1 })
  it('merges by id keeping current items first', () => {
    const out = mergeLibrary([item('new'), item('x')], [item('x'), item('old')])
    expect(out.map((i) => i.id)).toEqual(['new', 'x', 'old'])
  })
})

describe('xml escaping', () => {
  it('strips control characters and escapes markup', () => {
    expect(escapeXml('a\u0000b\u0008c\u001fd<&>"')).toBe('abcd&lt;&amp;&gt;&quot;')
    expect(escapeXml('t\nu\tv')).toBe('t\nu\tv')
  })
})

describe('export bounds', () => {
  it('includes the frame name height, also when cropped', () => {
    const frame = { ...createFrame(0, 100), width: 100, height: 50 }
    const alone = exportBounds([frame])!
    expect(alone.minY).toBeLessThanOrEqual(100 - 22 - 16)
    const cropped = exportBounds([frame], frame)!
    expect(cropped).toMatchObject({ minY: 78, height: 72, width: 100 })
  })

  it('reduces the scale by area as well as by side', () => {
    expect(effectiveScale(100, 100, 2)).toBe(2)
    expect(effectiveScale(10000, 10000, 3) * 10000 * (effectiveScale(10000, 10000, 3) * 10000)).toBeLessThanOrEqual(64_000_001)
    expect(effectiveScale(100, 100, 3, 50)).toBeCloseTo(0.5)
  })
})

describe('frame membership details', () => {
  const frame = { ...createFrame(0, 0), width: 200, height: 200 }
  const box = (x: number, y: number): SceneElement => ({ ...createShape('rectangle', x, y), width: 20, height: 20 })

  it('skips locked elements', () => {
    const locked = { ...box(50, 50), locked: true }
    expect(assignFrames([frame, locked])[1].frameId).toBeNull()
  })

  it('tests containment in the rotated frame space', () => {
    // a 200x100 frame turned a quarter turn around its center covers x 50..150, y -50..150
    const wide = { ...createFrame(0, 0), width: 200, height: 100, angle: Math.PI / 2 }
    const inRotated = box(90, 120) // inside the rotated frame, outside the unrotated box
    const inOriginal = box(10, 10) // inside the unrotated box, outside the rotated frame
    const out = assignFrames([wide, inRotated, inOriginal])
    expect(out[1].frameId).toBe(wide.id)
    expect(out[2].frameId).toBeNull()
  })

  it('arrows bound to a re-evaluated child follow its frame', () => {
    const child = box(50, 50)
    const arrow = {
      ...createShape('rectangle', 600, 600),
      type: 'arrow',
      startBinding: { elementId: child.id, focus: 0, gap: 4 },
      endBinding: null,
      points: [[0, 0], [10, 10]],
    } as unknown as SceneElement
    const out = assignFrames([frame, child, arrow], new Set([child.id]))
    expect(out[1].frameId).toBe(frame.id)
    expect(out[2].frameId).toBe(frame.id)
  })
})

describe('color resolution', () => {
  it('transforms named and hsl colors through the injected resolver', () => {
    setColorResolver((c) => ({ red: '#ff0000', 'hsl(0, 100%, 50%)': 'rgb(255, 0, 0)' })[c] ?? null)
    expect(transformColor('red')).toBe('#ff9090')
    expect(transformColor('hsl(0, 100%, 50%)')).toBe('#ff9090')
    expect(transformColor('notacolor')).toBe('notacolor')
    setColorResolver(null)
  })
})
