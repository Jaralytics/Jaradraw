import { describe, expect, it } from 'vitest'
import { createImageElement } from './image'
import { rotatePoint } from './geometry'
import type { Dir } from './resize'
import type { ImageCrop, ImageElement } from './types'
import {
  MIN_CROP_PX,
  cropSourceRect,
  cropFrame,
  dragCropHandle,
  effectiveCrop,
  elementAtCrop,
  fullBox,
  isFullCrop,
  moveCropWindow,
  parseCrop,
  resetCrop,
  sameCrop,
} from './crop'

const NATURAL = { width: 400, height: 200 }

function make(angle: number, flipX: boolean, flipY: boolean): ImageElement {
  return { ...createImageElement('f', 100, 50, 200, 100), angle, scale: [flipX ? -1 : 1, flipY ? -1 : 1] }
}

/** Where pixel (u, v) of the binary is drawn, using only the element's own box, crop and flips. */
function pixelToWorld(el: ImageElement, u: number, v: number) {
  const c = effectiveCrop(el, NATURAL) as ImageCrop
  const kx = el.width / c.width
  const ky = el.height / c.height
  const dx = el.scale[0] < 0 ? el.x + el.width - (u - c.x) * kx : el.x + (u - c.x) * kx
  const dy = el.scale[1] < 0 ? el.y + el.height - (v - c.y) * ky : el.y + (v - c.y) * ky
  return rotatePoint(dx, dy, el.x + el.width / 2, el.y + el.height / 2, el.angle)
}

function expectSamePlace(a: ImageElement, b: ImageElement, crop: ImageCrop) {
  for (const [u, v] of [
    [crop.x, crop.y],
    [crop.x + crop.width, crop.y + crop.height],
    [crop.x + crop.width / 3, crop.y + crop.height / 2],
  ]) {
    const pa = pixelToWorld(a, u, v)
    const pb = pixelToWorld(b, u, v)
    expect(pa.x).toBeCloseTo(pb.x, 6)
    expect(pa.y).toBeCloseTo(pb.y, 6)
  }
}

const cases: [string, number, boolean, boolean][] = [
  ['unrotated', 0, false, false],
  ['rotated 90', Math.PI / 2, false, false],
  ['rotated 30', Math.PI / 6, false, false],
  ['flipped x', 0, true, false],
  ['flipped y', 0, false, true],
  ['flipped both and rotated', Math.PI / 6, true, true],
]

describe('parseCrop', () => {
  const ok = { x: 10, y: 20, width: 100, height: 50, naturalWidth: 400, naturalHeight: 200 }
  it('accepts a region inside the image', () => {
    expect(parseCrop(ok)).toEqual(ok)
  })
  it.each([
    ['null', null],
    ['array', []],
    ['text', 'x'],
    ['NaN', { ...ok, x: NaN }],
    ['infinite', { ...ok, width: Infinity }],
    ['string number', { ...ok, y: '3' }],
    ['zero width', { ...ok, width: 0 }],
    ['negative height', { ...ok, height: -5 }],
    ['zero natural', { ...ok, naturalWidth: 0 }],
    ['negative origin', { ...ok, x: -1 }],
    ['outside right', { ...ok, x: 350 }],
    ['outside bottom', { ...ok, y: 160 }],
    ['missing field', { x: 0, y: 0, width: 1, height: 1 }],
  ])('rejects %s', (_n, raw) => {
    expect(parseCrop(raw)).toBeNull()
  })
})

describe('cropFrame', () => {
  it('places the full image under an uncropped element', () => {
    const f = cropFrame(make(0, false, false), NATURAL)!
    expect(f.width).toBe(200)
    expect(f.height).toBe(100)
    expect(f.center).toEqual({ x: 200, y: 100 })
  })
  it('needs a natural size when there is no crop', () => {
    expect(cropFrame(make(0, false, false))).toBeNull()
  })
  it('keeps full images and equal crops comparable', () => {
    const f = cropFrame(make(0, false, false), NATURAL)!
    expect(isFullCrop(effectiveCrop(make(0, false, false), NATURAL)!)).toBe(true)
    expect(sameCrop(null, null)).toBe(true)
    expect(sameCrop(null, effectiveCrop(make(0, false, false), NATURAL))).toBe(false)
    expect(fullBox(f).x).toBe(100)
  })
})

describe.each(cases)('crop geometry, %s', (_name, angle, fx, fy) => {
  const el = make(angle, fx, fy)
  const frame = cropFrame(el, NATURAL)!
  const full = effectiveCrop(el, NATURAL)!
  // a point in the frame's space, taken to the scene
  const scenePoint = (u: number, v: number) => {
    const dx = frame.center.x - frame.width / 2 + u
    const dy = frame.center.y - frame.height / 2 + v
    return rotatePoint(dx, dy, frame.center.x, frame.center.y, angle)
  }

  it('keeps the visible region in place when a corner is dragged', () => {
    const crop = dragCropHandle(frame, full, 'se', scenePoint(150, 60))
    const next = elementAtCrop(el, frame, crop)
    expect(crop.width).toBeLessThan(full.width)
    expectSamePlace(el, next, crop)
    const again = cropFrame(next)!
    expect(again.center.x).toBeCloseTo(frame.center.x, 6)
    expect(again.center.y).toBeCloseTo(frame.center.y, 6)
    expect(again.width).toBeCloseTo(frame.width, 6)
    expect(again.height).toBeCloseTo(frame.height, 6)
  })

  it('keeps the visible region in place when the window moves', () => {
    const start = dragCropHandle(frame, full, 'se', scenePoint(120, 70))
    const first = elementAtCrop(el, frame, start)
    const d = rotatePoint(30, 10, 0, 0, angle)
    const moved = moveCropWindow(frame, start, d.x, d.y)
    const next = elementAtCrop(first, frame, moved)
    expectSamePlace(el, next, moved)
    expect(moved.width).toBeCloseTo(start.width, 6)
    expect(moved.height).toBeCloseTo(start.height, 6)
  })

  it('round trips crop and reset to the same full box', () => {
    const crop = dragCropHandle(frame, full, 'nw', scenePoint(40, 30))
    const cropped = elementAtCrop(el, frame, crop)
    expect(cropped.crop).not.toBeNull()
    const back = resetCrop(cropped)
    expect(back.crop).toBeNull()
    expect(back.x).toBeCloseTo(el.x, 6)
    expect(back.y).toBeCloseTo(el.y, 6)
    expect(back.width).toBeCloseTo(el.width, 6)
    expect(back.height).toBeCloseTo(el.height, 6)
  })

  it('clamps every edge to the image', () => {
    const inner = dragCropHandle(frame, full, 'se', scenePoint(150, 75))
    const far = 5000
    const dirs: [Dir, number, number][] = [
      ['w', -far, 0],
      ['e', far, 0],
      ['n', 0, -far],
      ['s', 0, far],
      ['nw', -far, -far],
      ['se', far, far],
      ['ne', far, -far],
      ['sw', -far, far],
    ]
    for (const [dir, ox, oy] of dirs) {
      const c = dragCropHandle(frame, inner, dir, scenePoint(frame.width / 2 + ox, frame.height / 2 + oy))
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.y).toBeGreaterThanOrEqual(0)
      expect(c.x + c.width).toBeLessThanOrEqual(400 + 1e-9)
      expect(c.y + c.height).toBeLessThanOrEqual(200 + 1e-9)
      expect(parseCrop(c)).not.toBeNull()
    }
  })

  it('keeps a minimum size on every side', () => {
    const k = frame.width / frame.naturalWidth
    for (const dir of ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'] as Dir[]) {
      const c = dragCropHandle(frame, full, dir, scenePoint(frame.width / 2, frame.height / 2), { minSize: MIN_CROP_PX })
      const east = dir.includes('e')
      const west = dir.includes('w')
      if (east || west) expect(c.width * k).toBeGreaterThanOrEqual(MIN_CROP_PX - 1e-9)
      if (dir.includes('n') || dir.includes('s')) expect(c.height * k).toBeGreaterThanOrEqual(MIN_CROP_PX - 1e-9)
    }
  })

  it('keeps the aspect ratio with a corner or an edge', () => {
    const start = dragCropHandle(frame, full, 'se', scenePoint(160, 60))
    const ratio = start.width / start.height
    for (const dir of ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'] as Dir[]) {
      for (const [u, v] of [
        [20, 20],
        [190, 90],
        [90, 40],
        [-300, 400],
      ]) {
        const c = dragCropHandle(frame, start, dir, scenePoint(u, v), { keepAspect: true })
        expect(c.width / c.height).toBeCloseTo(ratio, 6)
        expect(parseCrop(c)).not.toBeNull()
      }
    }
  })

  it('stops a window move at the image edges', () => {
    const start = dragCropHandle(frame, full, 'se', scenePoint(100, 50))
    const right = moveCropWindow(frame, start, ...(Object.values(rotatePoint(9999, 0, 0, 0, angle)) as [number, number]))
    const left = moveCropWindow(frame, start, ...(Object.values(rotatePoint(-9999, 0, 0, 0, angle)) as [number, number]))
    const down = moveCropWindow(frame, start, ...(Object.values(rotatePoint(0, 9999, 0, 0, angle)) as [number, number]))
    const up = moveCropWindow(frame, start, ...(Object.values(rotatePoint(0, -9999, 0, 0, angle)) as [number, number]))
    const xs = [right, left].map((c) => (fx ? 400 - (c.x + c.width) : c.x)).sort((a, b) => a - b)
    const ys = [down, up].map((c) => (fy ? 200 - (c.y + c.height) : c.y)).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(0, 9)
    expect(xs[1]).toBeCloseTo(400 - start.width, 9)
    expect(ys[0]).toBeCloseTo(0, 9)
    expect(ys[1]).toBeCloseTo(200 - start.height, 9)
    for (const c of [right, left, up, down]) {
      expect(c.width).toBeCloseTo(start.width, 9)
      expect(c.height).toBeCloseTo(start.height, 9)
    }
  })
})

describe('crop edge cases', () => {
  const el = make(0, false, false)
  const frame = cropFrame(el, NATURAL)!
  const full = effectiveCrop(el, NATURAL)!

  it('leaves the window unchanged when the aspect-locked range is empty', () => {
    // a very wide window in a short image: the minimum width for the minimum height exceeds the room
    const wide = { x: 0, y: 90, width: 400, height: 4, naturalWidth: 400, naturalHeight: 200 }
    const out = dragCropHandle(frame, wide, 'e', { x: 150, y: 100 }, { keepAspect: true, minSize: 60 })
    expect(out).toEqual(wide)
  })

  it('does not snap up a window already smaller than the minimum', () => {
    const tiny = { x: 100, y: 50, width: 8, height: 8, naturalWidth: 400, naturalHeight: 200 }
    const out = dragCropHandle(frame, tiny, 'se', { x: 0, y: 0 }, { minSize: MIN_CROP_PX })
    expect(out.width).toBeCloseTo(8, 6)
    expect(out.height).toBeCloseTo(8, 6)
    void full
  })

  it('scales the source rectangle by the decoded size', () => {
    const crop = { x: 100, y: 50, width: 200, height: 100, naturalWidth: 400, naturalHeight: 200 }
    expect(cropSourceRect(crop, 200, 100)).toEqual({ sx: 50, sy: 25, sw: 100, sh: 50 })
    expect(cropSourceRect(crop, 400, 200)).toEqual({ sx: 100, sy: 50, sw: 200, sh: 100 })
  })
})
