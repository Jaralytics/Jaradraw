import { describe, expect, it } from 'vitest'
import { baseDefaults, createShape, createText } from '../element/factory'
import { createImageElement, collectFileIds, filesForElements, fitSize, limitSide, referencedFileIds, sha1Hex, stripDataURLs } from '../element/image'
import { resizeElement } from '../element/resize'
import { flipElements } from '../element/transform'
import { assignFrames, createFrame, releaseFrameChildren, withFrameChildren } from '../element/frame'
import { cloneElements } from '../element/clone'
import { parseLibrary, serializeLibrary, createLibraryItem } from '../element/library'
import { parseClipboardData, serializeClipboard } from './clipboard'
import { crc32, decodeSceneEnvelope, embedSceneInPng, embedSceneInSvg, encodeSceneEnvelope, extractSceneFromPng, extractSceneFromSvg, insertTextChunk, readPngChunks, readTextChunk, writePngChunks } from './embed'
import { parseScene, serializeScene } from './serialize'
import { transformColor } from '../render/color'
import { buildSvg } from '../render/svg'
import { selectExportElements } from '../render/bounds'
import { useStore } from './store'
import type { FreedrawElement, SceneElement } from '../element/types'

const file = (id: string) => ({ id, mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA', created: 1, lastRetrieved: 1 })

function tinyPng(): Uint8Array {
  const ihdr = new Uint8Array(13)
  new DataView(ihdr.buffer).setUint32(0, 1)
  new DataView(ihdr.buffer).setUint32(4, 1)
  ihdr[8] = 8
  ihdr[9] = 6
  return writePngChunks([
    { type: 'IHDR', data: ihdr },
    { type: 'IDAT', data: new Uint8Array([1, 2, 3, 4]) },
    { type: 'IEND', data: new Uint8Array(0) },
  ])
}

describe('images', () => {
  it('creates an image element with the Excalidraw fields', () => {
    const el = createImageElement('abc', 10, 20, 100, 50)
    expect(el).toMatchObject({ type: 'image', fileId: 'abc', status: 'saved', scale: [1, 1], crop: null, width: 100, height: 50 })
  })

  it('fits sizes and limits the longest side', () => {
    expect(fitSize(400, 200, 100, 100)).toEqual({ width: 100, height: 50 })
    expect(fitSize(40, 20, 100, 100)).toEqual({ width: 40, height: 20 })
    expect(limitSide(4000, 1000)).toEqual({ width: 2000, height: 500 })
    expect(limitSide(500, 500)).toEqual({ width: 500, height: 500 })
  })

  it('hashes bytes with SHA-1', async () => {
    expect(await sha1Hex(new TextEncoder().encode('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('keeps the aspect ratio from every handle unless freed', () => {
    const img = createImageElement('f', 0, 0, 200, 100)
    for (const dir of ['se', 'nw', 'e', 'w', 'n', 's'] as const) {
      const px = dir.includes('e') ? 300 : dir.includes('w') ? -100 : 100
      const py = dir.includes('s') ? 160 : dir.includes('n') ? -60 : 50
      const out = resizeElement(img, dir, px, py)
      expect(out.width / out.height).toBeCloseTo(2, 5)
    }
    const free = resizeElement(img, 'se', 300, 100, true)
    expect(free.width / free.height).not.toBeCloseTo(2, 3)
  })

  it('flips through scale', () => {
    const img = createImageElement('f', 0, 0, 200, 100)
    expect((flipElements([img], 'horizontal')[0] as typeof img).scale).toEqual([-1, 1])
    expect((flipElements([img], 'vertical')[0] as typeof img).scale).toEqual([1, -1])
  })

  it('collects file references for saving and garbage collection', () => {
    const a = createImageElement('a', 0, 0, 10, 10)
    const b = { ...createImageElement('b', 0, 0, 10, 10), isDeleted: true }
    const files = { a: file('a'), b: file('b'), c: file('c') }
    expect([...collectFileIds([a, b])]).toEqual(['a'])
    expect(Object.keys(filesForElements([a, b], files))).toEqual(['a'])
    // history snapshots keep deleted and older elements alive
    const old = createImageElement('c', 0, 0, 10, 10)
    expect([...referencedFileIds([[a, b], [old]])].sort()).toEqual(['a', 'b', 'c'])
    expect(stripDataURLs(files).a).toEqual({ id: 'a', mimeType: 'image/png', created: 1, lastRetrieved: 1 })
  })

  it('round trips images through a scene and keeps unknown fields', () => {
    const img = { ...createImageElement('a', 0, 0, 10, 10), extra: 7 } as SceneElement
    const scene = parseScene(JSON.parse(JSON.stringify(serializeScene([img], undefined, { a: file('a') }))))
    expect(scene?.elements[0]).toMatchObject({ type: 'image', fileId: 'a', extra: 7 })
    expect(Object.keys(scene?.files ?? {})).toEqual(['a'])
  })

  it('carries files in the clipboard payload', () => {
    const img = createImageElement('a', 0, 0, 10, 10)
    const text = serializeClipboard([img], { a: file('a'), z: file('z') })
    const data = parseClipboardData(text)
    expect(Object.keys(data?.files ?? {})).toEqual(['a'])
    expect(data?.elements[0].type).toBe('image')
  })
})

describe('PNG chunks and embedded scenes', () => {
  it('computes CRC32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('writes and reads tEXt chunks before IEND with a valid CRC', () => {
    const out = insertTextChunk(tinyPng(), 'application/vnd.excalidraw+json', 'holaé')
    const chunks = readPngChunks(out)
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'tEXt', 'IEND'])
    expect(readTextChunk(out, 'application/vnd.excalidraw+json')).toBe('holaé')
    // verify the stored CRC of the tEXt chunk
    const view = new DataView(out.buffer, out.byteOffset)
    let pos = 8
    for (let i = 0; i < chunks.length; i++) {
      const len = view.getUint32(pos)
      const crc = view.getUint32(pos + 8 + len)
      expect(crc).toBe(crc32(out.subarray(pos + 4, pos + 8 + len)))
      pos += 12 + len
    }
  })

  it('replaces an existing chunk with the same keyword', () => {
    const once = insertTextChunk(tinyPng(), 'k', 'one')
    const twice = insertTextChunk(once, 'k', 'two')
    expect(readPngChunks(twice).filter((c) => c.type === 'tEXt')).toHaveLength(1)
    expect(readTextChunk(twice, 'k')).toBe('two')
  })

  it('round trips the scene envelope', async () => {
    const json = JSON.stringify({ hello: 'mundo ñ', n: [1, 2, 3] })
    const env = await encodeSceneEnvelope(json)
    expect(JSON.parse(env)).toMatchObject({ version: '1', encoding: 'bstring', compressed: true })
    expect(await decodeSceneEnvelope(env)).toBe(json)
  })

  it('embeds and extracts a scene in a PNG', async () => {
    const json = JSON.stringify(serializeScene([createShape('rectangle', 1, 2)]))
    const png = await embedSceneInPng(tinyPng(), json)
    expect(await extractSceneFromPng(png)).toBe(json)
    expect(await extractSceneFromPng(tinyPng())).toBeNull()
  })

  it('embeds and extracts a scene in an SVG', async () => {
    const json = JSON.stringify(serializeScene([createShape('ellipse', 1, 2)]))
    const svg = await embedSceneInSvg('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', json)
    expect(svg).toContain('<!-- svg-source:excalidraw --><metadata>')
    expect(svg).toContain('<!-- payload-version:2 -->')
    expect(await extractSceneFromSvg(svg)).toBe(json)
    expect(await extractSceneFromSvg('<svg></svg>')).toBeNull()
  })
})

describe('SVG export', () => {
  const freedraw = {
    ...baseDefaults(),
    id: 'fd',
    type: 'freedraw',
    points: [[0, 0], [10, 5], [20, 0]],
    pressures: [],
    simulatePressure: true,
    lastCommittedPoint: null,
    width: 20,
    height: 5,
  } as unknown as FreedrawElement

  it('emits nodes for each element type', () => {
    const rect = { ...createShape('rectangle', 0, 0), width: 100, height: 60, angle: 0.5, opacity: 50 }
    const text = createText(10, 10, 'Hola\nmundo', { width: 50, height: 50 })
    const img = { ...createImageElement('a', 120, 0, 40, 40), scale: [-1, 1] as const }
    const res = buildSvg([rect, text, img, freedraw, createShape('diamond', 0, 80)], {
      background: '#ffffff',
      files: { a: file('a') },
    })
    expect(res).not.toBeNull()
    const svg = res!.svg
    expect(svg).toContain('<path')
    expect(svg.match(/<text /g)).toHaveLength(2)
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"')
    expect(svg).toContain('rotate(28.65')
    expect(svg).toContain('opacity="0.5"')
    expect(svg).toContain('scale(-1 1)')
    expect(svg).toContain('fill="#ffffff"')
  })

  it('draws a placeholder for missing files and omits the background when transparent', () => {
    const res = buildSvg([createImageElement('missing', 0, 0, 10, 10)], { background: null, files: {} })
    expect(res!.svg).toContain('<rect width="10" height="10" fill="#f1f1f4"')
    expect(res!.svg).not.toContain('<image')
  })

  it('clips frame children and crops to the frame', () => {
    const frame = { ...createFrame(0, 0), width: 100, height: 100 }
    const child = { ...createShape('rectangle', 10, 10), width: 200, height: 20, frameId: frame.id }
    const res = buildSvg([child, frame], { background: null, files: {}, crop: frame })
    expect(res!.svg).toContain('<clipPath id="clip-0">')
    expect(res!.svg).toContain('clip-path="url(#clip-0)"')
    expect(res!.width).toBe(100)
    expect(res!.svg).toContain('>Marco</text>')
  })

  it('selects a frame with its children for the selection export', () => {
    const frame = { ...createFrame(0, 0), width: 100, height: 100 }
    const child = { ...createShape('rectangle', 10, 10), width: 20, height: 20, frameId: frame.id }
    const other = createShape('rectangle', 500, 500)
    const out = selectExportElements([frame, child, other], [frame.id])
    expect(out.map((e) => e.id)).toEqual([frame.id, child.id])
  })
})

describe('dark mode colors', () => {
  it('matches invert(93%) hue-rotate(180deg) for known values', () => {
    expect(transformColor('#ffffff')).toBe('#121212')
    expect(transformColor('#000000')).toBe('#ededed')
    expect(transformColor('#fff')).toBe('#121212')
    expect(transformColor('#ff0000')).toBe('#ff9090')
  })

  it('leaves transparent and unknown values untouched and caches results', () => {
    expect(transformColor('transparent')).toBe('transparent')
    expect(transformColor('rebeccapurple')).toBe('rebeccapurple')
    expect(transformColor('#1e1e1e')).toBe(transformColor('#1e1e1e'))
    expect(transformColor('rgba(0, 0, 0, 0)')).toBe('rgba(0, 0, 0, 0)')
    expect(transformColor('rgba(255, 255, 255, 0.5)')).toBe('rgba(18, 18, 18, 0.5)')
  })
})

describe('library format', () => {
  const rect = createShape('rectangle', 0, 0)

  it('reads version 1', () => {
    const items = parseLibrary({ type: 'excalidrawlib', version: 1, library: [[rect], [], [createShape('ellipse', 5, 5)]] })
    expect(items).toHaveLength(2)
    expect(items![0].elements[0].type).toBe('rectangle')
    expect(items![0].status).toBe('unpublished')
  })

  it('reads version 2 and writes it back', () => {
    const text = JSON.stringify({
      type: 'excalidrawlib',
      version: 2,
      source: 'x',
      libraryItems: [{ id: 'one', status: 'published', created: 5, name: 'Caja', elements: [rect] }],
    })
    const items = parseLibrary(text)!
    expect(items[0]).toMatchObject({ id: 'one', created: 5, name: 'Caja', status: 'published' })
    const out = JSON.parse(serializeLibrary(items))
    expect(out).toMatchObject({ type: 'excalidrawlib', version: 2 })
    expect(out.libraryItems[0]).toMatchObject({ id: 'one', name: 'Caja', created: 5 })
    expect(parseLibrary(JSON.stringify(out))![0].elements[0].id).toBe(rect.id)
  })

  it('rejects other documents and validates elements', () => {
    expect(parseLibrary({ type: 'excalidraw' })).toBeNull()
    expect(parseLibrary('nope')).toBeNull()
    const items = parseLibrary({ type: 'excalidrawlib', version: 2, libraryItems: [{ elements: [{ type: 'rectangle', x: 'bad' }] }] })!
    expect(items[0].elements[0].x).toBe(0)
  })

  it('library items carry the image files they use', () => {
    const img = createImageElement('a', 0, 0, 10, 10)
    const item = createLibraryItem([img], { a: file('a'), b: file('b') })!
    expect(Object.keys(item.files!)).toEqual(['a'])
  })
})

describe('frames', () => {
  const frame = { ...createFrame(0, 0), width: 200, height: 200 }
  const inside = { ...createShape('rectangle', 50, 50), width: 20, height: 20 }
  const outside = { ...createShape('rectangle', 400, 400), width: 20, height: 20 }

  it('assigns membership by the center', () => {
    const out = assignFrames([frame, inside, outside])
    expect(out[1].frameId).toBe(frame.id)
    expect(out[2].frameId).toBeNull()
    // straddling the border: the center decides
    const edge = { ...createShape('rectangle', 195, 50), width: 20, height: 20 }
    expect(assignFrames([frame, edge])[1].frameId).toBeNull()
    const edge2 = { ...createShape('rectangle', 185, 50), width: 20, height: 20 }
    expect(assignFrames([frame, edge2])[1].frameId).toBe(frame.id)
  })

  it('moves groups in and out as a unit', () => {
    const a = { ...inside, id: 'a', groupIds: ['g'] }
    const b = { ...createShape('rectangle', 300, 50), id: 'b', width: 20, height: 20, groupIds: ['g'] }
    // group center (x from 50 to 320 -> 185) is inside, so both join
    const joined = assignFrames([frame, a, b])
    expect(joined[1].frameId).toBe(frame.id)
    expect(joined[2].frameId).toBe(frame.id)
    const far = { ...b, x: 700 }
    const left = assignFrames([frame, { ...a, frameId: frame.id }, { ...far, frameId: frame.id }])
    expect(left[1].frameId).toBeNull()
    expect(left[2].frameId).toBeNull()
  })

  it('labels follow their container', () => {
    const label = { ...createText(55, 55, 'x', { width: 10, height: 10 }), containerId: inside.id }
    const out = assignFrames([frame, inside, label])
    expect(out[2].frameId).toBe(frame.id)
  })

  it('only re-evaluates the given ids', () => {
    const stale = { ...outside, frameId: 'gone' }
    expect(assignFrames([frame, inside, stale], new Set([inside.id]))[2].frameId).toBe('gone')
    expect(releaseFrameChildren([frame, stale])[1].frameId).toBeNull()
  })

  it('deleting a frame releases its children', () => {
    const child = { ...inside, frameId: frame.id }
    useStore.setState({ elements: [frame, child], selectedIds: [frame.id] })
    useStore.getState().deleteSelected()
    const els = useStore.getState().elements
    expect(els.find((e) => e.id === frame.id)?.isDeleted).toBe(true)
    const kid = els.find((e) => e.id === child.id)!
    expect(kid.isDeleted).toBe(false)
    expect(kid.frameId).toBeNull()
  })

  it('duplicating a frame carries its children with remapped ids', () => {
    const child = { ...inside, frameId: frame.id }
    const copies = cloneElements(withFrameChildren([frame, child], [frame]), 10, 10)
    expect(copies).toHaveLength(2)
    const [f2, c2] = copies
    expect(f2.id).not.toBe(frame.id)
    expect(c2.frameId).toBe(f2.id)
    expect(c2.id).not.toBe(child.id)
  })

  it('a duplicated frame does not steal the original children', () => {
    const child = { ...inside, frameId: frame.id }
    const copies = cloneElements(withFrameChildren([frame, child], [frame]), 10, 10)
    const out = assignFrames([frame, child, ...copies], new Set(copies.map((c) => c.id)))
    expect(out[1].frameId).toBe(frame.id)
    expect(out[3].frameId).toBe(copies[0].id)
  })

  it('creating a frame adopts the elements inside it', () => {
    useStore.setState({ elements: [inside, outside], selectedIds: [], history: useStore.getState().history })
    useStore.getState().commitDraft(frame)
    const els = useStore.getState().elements
    expect(els.find((e) => e.id === inside.id)?.frameId).toBe(frame.id)
    expect(els.find((e) => e.id === outside.id)?.frameId).toBeNull()
  })
})
