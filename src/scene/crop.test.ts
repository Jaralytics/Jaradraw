import { beforeEach, describe, expect, it } from 'vitest'
import { cloneElements } from '../element/clone'
import { createLinear } from '../element/factory'
import { withAbsolutePoints } from '../element/geometry'
import { createImageElement } from '../element/image'
import { dragCropHandle } from '../element/crop'
import { resizeElement } from '../element/resize'
import { flipElements } from '../element/transform'
import type { ImageCrop, ImageElement, LinearElement } from '../element/types'
import { buildSvg } from '../render/svg'
import { DEFAULT_APP_STATE, parseScene, serializeScene } from './serialize'
import { useStore } from './store'
import { DEFAULT_VIEWPORT } from './viewport'

const st = () => useStore.getState()
const NATURAL = { width: 400, height: 200 }
const FULL: ImageCrop = { x: 0, y: 0, width: 400, height: 200, naturalWidth: 400, naturalHeight: 200 }
const FILE = { id: 'f', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA', created: 1, lastRetrieved: 1 }
const img = (): ImageElement => createImageElement('f', 100, 50, 200, 100)
const image = () => st().elements.find((e) => e.type === 'image') as ImageElement
const entries = () => st().history.stack.length

function setup(el: ImageElement = img(), files: Record<string, unknown> = { f: FILE }) {
  st().load({ elements: [el], appState: DEFAULT_APP_STATE, files, viewport: DEFAULT_VIEWPORT })
  st().setSelection([el.id])
  return el
}

/** Crops the top-left quarter of the 400 x 200 binary away through the store. */
function cropTopLeftOff() {
  expect(st().startCrop(NATURAL)).toBe(true)
  const crop = dragCropHandle(st().cropping!.frame, FULL, 'nw', { x: 150, y: 75 })
  st().updateCrop(crop)
  return crop
}

beforeEach(() => {
  st().load({ elements: [], appState: DEFAULT_APP_STATE, files: {}, viewport: DEFAULT_VIEWPORT })
  st().setTool('selection')
})

describe('crop mode in the store', () => {
  it('applies a crop as one undo entry and undo restores the full image', () => {
    setup()
    const before = entries()
    const crop = cropTopLeftOff()
    expect(entries()).toBe(before)
    expect(st().cropping).not.toBeNull()
    st().applyCrop()
    expect(st().cropping).toBeNull()
    expect(entries()).toBe(before + 1)
    expect(image().crop).toMatchObject({ x: crop.x, y: crop.y, width: crop.width, height: crop.height, naturalWidth: 400, naturalHeight: 200 })
    expect(image()).toMatchObject({ x: 150, y: 75, width: 150, height: 75 })
    st().undo()
    expect(image().crop).toBeNull()
    expect(image()).toMatchObject({ x: 100, y: 50, width: 200, height: 100 })
    st().redo()
    expect(image().crop).not.toBeNull()
  })

  it('records nothing when the crop did not change', () => {
    setup()
    const before = entries()
    const elements = st().elements
    expect(st().startCrop(NATURAL)).toBe(true)
    st().updateCrop({ ...FULL, x: 100, width: 300 })
    st().updateCrop(FULL)
    st().applyCrop()
    expect(entries()).toBe(before)
    expect(st().elements.map((e) => e.id)).toEqual(elements.map((e) => e.id))
    expect(image().crop).toBeNull()
    expect(image()).toMatchObject({ x: 100, y: 50, width: 200, height: 100 })
  })

  it('cancels back to the previous crop', () => {
    setup()
    cropTopLeftOff()
    st().applyCrop()
    const cropped = image()
    const before = entries()
    expect(st().startCrop()).toBe(true)
    st().updateCrop({ ...FULL, width: 100, height: 50 })
    st().cancelCrop()
    expect(st().cropping).toBeNull()
    expect(image()).toBe(cropped)
    expect(entries()).toBe(before)
  })

  it('shows the full image again when entering on a cropped image', () => {
    setup()
    cropTopLeftOff()
    st().applyCrop()
    expect(st().startCrop()).toBe(true)
    const f = st().cropping!.frame
    expect(f).toMatchObject({ width: 200, height: 100, naturalWidth: 400, naturalHeight: 200 })
    expect(f.center.x).toBeCloseTo(200, 6)
    expect(f.center.y).toBeCloseTo(100, 6)
    const wider = { ...FULL, x: 50, width: 350 }
    st().updateCrop(wider)
    st().applyCrop()
    expect(image().crop).toMatchObject(wider)
    expect(image().x).toBeCloseTo(125, 6)
  })

  it('refuses locked images, missing binaries, multi selection and other tools', () => {
    setup({ ...img(), locked: true })
    expect(st().startCrop(NATURAL)).toBe(false)
    setup(img(), {})
    expect(st().startCrop(NATURAL)).toBe(false)
    setup()
    st().insertElements([{ ...img(), id: 'other' }])
    st().setSelection([image().id, 'other'])
    expect(st().startCrop(NATURAL)).toBe(false)
    st().setSelection([image().id])
    st().setTool('rectangle')
    expect(st().startCrop(NATURAL)).toBe(false)
  })

  it('clears the crop keeping the visible region in place, as one entry', () => {
    setup()
    cropTopLeftOff()
    st().applyCrop()
    const before = entries()
    st().clearCrop()
    expect(entries()).toBe(before + 1)
    expect(image().crop).toBeNull()
    expect(image()).toMatchObject({ x: 100, y: 50, width: 200, height: 100 })
    st().undo()
    expect(image().crop).not.toBeNull()
    st().clearCrop()
    st().clearCrop()
    expect(entries()).toBe(before + 1)
  })

  it('keeps arrows bound to the image while it is cropped', () => {
    setup()
    const arrow = withAbsolutePoints(createLinear('arrow', 150, 20), [[150, 20], [150, 75]]) as LinearElement
    st().commitDraft(arrow)
    st().bindEnds(arrow.id, { end: image().id })
    st().setSelection([image().id])
    cropTopLeftOff()
    st().applyCrop()
    const a = st().elements.find((e) => e.id === arrow.id) as LinearElement
    expect((a.endBinding as { elementId?: string } | null)?.elementId).toBe(image().id)
  })
})

describe('cropped images as ordinary images', () => {
  const cropped = (): ImageElement => {
    setup()
    cropTopLeftOff()
    st().applyCrop()
    return image()
  }

  it('keeps the crop and the visible aspect ratio when resized', () => {
    const el = cropped()
    const out = resizeElement(el, 'se', el.x + 600, el.y + 100)
    expect(out.crop).toEqual(el.crop)
    expect(out.width / out.height).toBeCloseTo(el.width / el.height, 6)
    expect(out.width).toBeGreaterThan(el.width)
  })

  it('keeps the crop when flipped, duplicated and saved', () => {
    const el = cropped()
    expect(flipElements([el], 'horizontal')[0]).toMatchObject({ crop: el.crop })
    expect((cloneElements([el], 5, 5)[0] as ImageElement).crop).toEqual(el.crop)
    const back = parseScene(JSON.parse(JSON.stringify(serializeScene([el], DEFAULT_APP_STATE, { f: FILE }))))!
    expect((back.elements[0] as ImageElement).crop).toEqual(el.crop)
  })

  it('ignores a malformed crop and keeps unknown fields', () => {
    const bad: unknown[] = [
      { ...FULL, width: 0 },
      { ...FULL, x: 5 },
      { ...FULL, x: 'a' },
      { ...FULL, height: NaN },
      'crop',
    ]
    for (const crop of bad) {
      const raw = { ...img(), crop, customData: { keep: 1 }, extra: 'yes' }
      const parsed = parseScene({ type: 'excalidraw', elements: [raw], appState: {}, files: {} })!
      const el = parsed.elements[0] as ImageElement & { extra?: string; customData?: unknown }
      expect(el.crop).toBeNull()
      expect(el.extra).toBe('yes')
      expect(el.customData).toEqual({ keep: 1 })
    }
  })

  it('accepts an absent crop field', () => {
    const { crop: _omit, ...raw } = img()
    void _omit
    const parsed = parseScene({ type: 'excalidraw', elements: [raw], appState: {}, files: {} })!
    expect((parsed.elements[0] as ImageElement).crop).toBeNull()
  })
})

describe('svg export of a cropped image', () => {
  const crop: ImageCrop = { x: 100, y: 50, width: 200, height: 100, naturalWidth: 400, naturalHeight: 200 }

  it('references only the cropped region through a nested viewBox', () => {
    const el = { ...img(), x: 0, y: 0, width: 100, height: 50, crop }
    const svg = buildSvg([el], { background: null, files: { f: FILE } })!.svg
    expect(svg).toContain('viewBox="100 50 200 100"')
    expect(svg).toContain('<svg width="100" height="50"')
    expect(svg).toContain('<image href="data:image/png;base64,AAAA" x="0" y="0" width="400" height="200"')
    expect(svg).toContain('overflow="hidden"')
  })

  it('keeps flips and rotation around the visible box', () => {
    const el = { ...img(), x: 0, y: 0, width: 100, height: 50, crop, angle: Math.PI / 2, scale: [-1, 1] as const }
    const svg = buildSvg([el], { background: null, files: { f: FILE } })!.svg
    expect(svg).toContain('rotate(90')
    expect(svg).toContain('scale(-1 1)')
    expect(svg.indexOf('scale(-1 1)')).toBeLessThan(svg.indexOf('<svg width'))
  })

  it('exports uncropped images exactly as before', () => {
    const svg = buildSvg([img()], { background: null, files: { f: FILE } })!.svg
    expect(svg).not.toContain('viewBox="100')
    expect(svg).toContain('<image href="data:image/png;base64,AAAA" width="200" height="100" preserveAspectRatio="none"/>')
  })
})

describe('leaving a crop session', () => {
  it('applies when the tool or the selection changes', () => {
    setup()
    cropTopLeftOff()
    st().setTool('rectangle')
    expect(st().cropping).toBeNull()
    expect(image().crop).not.toBeNull()
    st().setTool('selection')
    st().setSelection([image().id])
    cropTopLeftOff()
    st().setSelection([])
    expect(st().cropping).toBeNull()
  })

  it('survives the cropped element being deleted', () => {
    setup()
    cropTopLeftOff()
    st().removeElements([image().id])
    st().applyCrop()
    expect(st().cropping).toBeNull()
    expect(st().elements).toHaveLength(0)
  })

  it('load and openScene leave the new scene untouched', () => {
    const el = setup()
    const scene = { elements: [el], appState: DEFAULT_APP_STATE, files: { f: FILE }, viewport: DEFAULT_VIEWPORT }
    cropTopLeftOff()
    st().load(scene)
    expect(st().cropping).toBeNull()
    expect(image()).toBe(el)
    st().setSelection([el.id])
    cropTopLeftOff()
    st().openScene(scene, null)
    expect(st().cropping).toBeNull()
    expect(image()).toBe(el)
  })

  it('cancel restores only the cropped element', () => {
    setup()
    cropTopLeftOff()
    const other = { ...img(), id: 'other', x: 900 }
    st().insertElements([other])
    st().cancelCrop()
    expect(image().crop).toBeNull()
    expect(image()).toMatchObject({ x: 100, y: 50, width: 200, height: 100 })
    expect(st().elements.some((e) => e.id === 'other')).toBe(true)
  })

  it('does not drift over repeated crop and reset cycles', () => {
    setup()
    for (let i = 0; i < 25; i++) {
      expect(st().startCrop(NATURAL)).toBe(true)
      st().updateCrop(dragCropHandle(st().cropping!.frame, FULL, i % 2 ? 'se' : 'nw', { x: 180 + i, y: 90 + i }))
      st().applyCrop()
      st().clearCrop()
    }
    const e = image()
    expect(e.crop).toBeNull()
    for (const [k, v] of [['x', 100], ['y', 50], ['width', 200], ['height', 100]] as const) expect(Math.abs(e[k] - v)).toBeLessThan(1e-6)
  })
})
