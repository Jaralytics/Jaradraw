import type { ImageCrop, ImageElement } from './types'
import { updateElement } from './factory'
import { rotatePoint } from './geometry'
import type { Vec } from './geometry'
import type { Dir } from './resize'

export const MIN_CROP_PX = 10
const EPS = 1e-6

/**
 * The whole image placed on the canvas: where it sits (center, size, angle, flips) while the crop
 * window moves over it. It does not change during a crop session.
 */
export interface CropFrame {
  center: Vec
  width: number
  height: number
  angle: number
  flipX: boolean
  flipY: boolean
  naturalWidth: number
  naturalHeight: number
}

/** Crop window in the frame's own space: origin at the full image's top-left, flips already applied. */
interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** A well-formed crop, or null: non-finite numbers, empty sizes and regions outside the image are rejected. */
export function parseCrop(raw: unknown): ImageCrop | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const c = raw as Record<string, unknown>
  const { x, y, width, height, naturalWidth, naturalHeight } = c
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height) || !finite(naturalWidth) || !finite(naturalHeight)) return null
  if (width <= 0 || height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return null
  if (x < -EPS || y < -EPS || x + width > naturalWidth + EPS || y + height > naturalHeight + EPS) return null
  return { x, y, width, height, naturalWidth, naturalHeight }
}

export function isFullCrop(c: ImageCrop): boolean {
  return c.x <= EPS && c.y <= EPS && Math.abs(c.width - c.naturalWidth) <= EPS && Math.abs(c.height - c.naturalHeight) <= EPS
}

export function sameCrop(a: ImageCrop | null, b: ImageCrop | null): boolean {
  if (!a || !b) return !a && !b
  return (
    Math.abs(a.x - b.x) <= EPS &&
    Math.abs(a.y - b.y) <= EPS &&
    Math.abs(a.width - b.width) <= EPS &&
    Math.abs(a.height - b.height) <= EPS &&
    a.naturalWidth === b.naturalWidth &&
    a.naturalHeight === b.naturalHeight
  )
}

/** The crop to edit: the stored one, or the whole image of the given natural size. */
export function effectiveCrop(el: ImageElement, natural?: { width: number; height: number }): ImageCrop | null {
  const crop = parseCrop(el.crop)
  if (crop) return crop
  if (!natural || !(natural.width > 0) || !(natural.height > 0)) return null
  return { x: 0, y: 0, width: natural.width, height: natural.height, naturalWidth: natural.width, naturalHeight: natural.height }
}

/** Placement of the full image implied by a cropped element (the visible region stays where it is drawn). */
export function cropFrame(el: ImageElement, natural?: { width: number; height: number }): CropFrame | null {
  const region = effectiveCrop(el, natural)
  if (!region) return null
  const flipX = el.scale[0] < 0
  const flipY = el.scale[1] < 0
  const kx = el.width / region.width
  const ky = el.height / region.height
  const width = region.naturalWidth * kx
  const height = region.naturalHeight * ky
  const left = flipX ? el.x + el.width + region.x * kx - width : el.x - region.x * kx
  const top = flipY ? el.y + el.height + region.y * ky - height : el.y - region.y * ky
  const own = { x: el.x + el.width / 2, y: el.y + el.height / 2 }
  const center = rotatePoint(left + width / 2, top + height / 2, own.x, own.y, el.angle)
  return { center, width, height, angle: el.angle, flipX, flipY, naturalWidth: region.naturalWidth, naturalHeight: region.naturalHeight }
}

/** The full image as an unflipped element box (x, y, width, height, angle). */
export function fullBox(frame: CropFrame): { x: number; y: number; width: number; height: number; angle: number } {
  return { x: frame.center.x - frame.width / 2, y: frame.center.y - frame.height / 2, width: frame.width, height: frame.height, angle: frame.angle }
}

export function fullCrop(frame: CropFrame): ImageCrop {
  return { x: 0, y: 0, width: frame.naturalWidth, height: frame.naturalHeight, naturalWidth: frame.naturalWidth, naturalHeight: frame.naturalHeight }
}

function toRect(f: CropFrame, c: ImageCrop): Rect {
  const kx = f.width / f.naturalWidth
  const ky = f.height / f.naturalHeight
  const x0 = f.flipX ? (f.naturalWidth - c.x - c.width) * kx : c.x * kx
  const y0 = f.flipY ? (f.naturalHeight - c.y - c.height) * ky : c.y * ky
  return { x0, y0, x1: x0 + c.width * kx, y1: y0 + c.height * ky }
}

function toCrop(f: CropFrame, r: Rect): ImageCrop {
  const kx = f.width / f.naturalWidth
  const ky = f.height / f.naturalHeight
  const w = Math.min((r.x1 - r.x0) / kx, f.naturalWidth)
  const h = Math.min((r.y1 - r.y0) / ky, f.naturalHeight)
  const x = Math.min(Math.max(f.flipX ? f.naturalWidth - r.x1 / kx : r.x0 / kx, 0), f.naturalWidth - w)
  const y = Math.min(Math.max(f.flipY ? f.naturalHeight - r.y1 / ky : r.y0 / ky, 0), f.naturalHeight - h)
  return { x, y, width: w, height: h, naturalWidth: f.naturalWidth, naturalHeight: f.naturalHeight }
}

/** The element showing `crop` of the framed image; a crop covering everything is stored as null. */
export function elementAtCrop(el: ImageElement, f: CropFrame, crop: ImageCrop): ImageElement {
  const r = toRect(f, crop)
  const width = r.x1 - r.x0
  const height = r.y1 - r.y0
  const offset = rotatePoint(r.x0 + width / 2 - f.width / 2, r.y0 + height / 2 - f.height / 2, 0, 0, f.angle)
  const cx = f.center.x + offset.x
  const cy = f.center.y + offset.y
  return updateElement(el, { x: cx - width / 2, y: cy - height / 2, width, height, crop: isFullCrop(crop) ? null : crop })
}

/** The whole image, in the place the visible region keeps. */
export function resetCrop(el: ImageElement): ImageElement {
  const f = el.crop ? cropFrame(el) : null
  return f ? elementAtCrop(el, f, fullCrop(f)) : el
}

/** Source rectangle for drawImage: crop coordinates are in the pixels the element was cropped at, the decoded image may differ. */
export function cropSourceRect(crop: ImageCrop, imageWidth: number, imageHeight: number) {
  const rx = imageWidth / crop.naturalWidth
  const ry = imageHeight / crop.naturalHeight
  return { sx: crop.x * rx, sy: crop.y * ry, sw: crop.width * rx, sh: crop.height * ry }
}

/** Pointer position in the frame's space. */
function toFrameSpace(f: CropFrame, p: Vec): Vec {
  const q = rotatePoint(p.x, p.y, f.center.x, f.center.y, -f.angle)
  return { x: q.x - f.center.x + f.width / 2, y: q.y - f.center.y + f.height / 2 }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

export interface CropDragOptions {
  /** Smallest side of the window, in scene units. */
  minSize?: number
  keepAspect?: boolean
}

/** New crop after dragging a handle of the window to a scene point; the window stays inside the image. */
export function dragCropHandle(f: CropFrame, crop: ImageCrop, dir: Dir, point: Vec, opts: CropDragOptions = {}): ImageCrop {
  const r = toRect(f, crop)
  const q = toFrameSpace(f, point)
  const w0 = r.x1 - r.x0
  const h0 = r.y1 - r.y0
  // a window already smaller than the minimum keeps its own size as the limit
  const minX = Math.min(opts.minSize ?? MIN_CROP_PX, f.width, w0)
  const minY = Math.min(opts.minSize ?? MIN_CROP_PX, f.height, h0)
  const west = dir.includes('w')
  const east = dir.includes('e')
  const north = dir.includes('n')
  const south = dir.includes('s')
  const next = { ...r }

  if (opts.keepAspect && (west || east) && (north || south)) {
    const ax = west ? r.x1 : r.x0
    const ay = north ? r.y1 : r.y0
    const wanted = Math.max(Math.abs(q.x - ax) / w0, Math.abs(q.y - ay) / h0)
    const roomX = west ? ax : f.width - ax
    const roomY = north ? ay : f.height - ay
    const scale = Math.min(Math.max(wanted, minX / w0, minY / h0), roomX / w0, roomY / h0)
    if (west) next.x0 = ax - w0 * scale
    else next.x1 = ax + w0 * scale
    if (north) next.y0 = ay - h0 * scale
    else next.y1 = ay + h0 * scale
  } else if (opts.keepAspect) {
    const ratio = w0 / h0
    if (west || east) {
      const cy = (r.y0 + r.y1) / 2
      const maxW = Math.min(west ? r.x1 : f.width - r.x0, 2 * Math.min(cy, f.height - cy) * ratio)
      const lo = Math.max(minX, minY * ratio)
      if (lo > maxW) return crop
      const w = clamp(west ? r.x1 - q.x : q.x - r.x0, lo, maxW)
      if (west) next.x0 = r.x1 - w
      else next.x1 = r.x0 + w
      next.y0 = cy - w / ratio / 2
      next.y1 = cy + w / ratio / 2
    } else {
      const cx = (r.x0 + r.x1) / 2
      const maxH = Math.min(north ? r.y1 : f.height - r.y0, (2 * Math.min(cx, f.width - cx)) / ratio)
      const lo = Math.max(minY, minX / ratio)
      if (lo > maxH) return crop
      const h = clamp(north ? r.y1 - q.y : q.y - r.y0, lo, maxH)
      if (north) next.y0 = r.y1 - h
      else next.y1 = r.y0 + h
      next.x0 = cx - (h * ratio) / 2
      next.x1 = cx + (h * ratio) / 2
    }
  } else {
    if (west) next.x0 = clamp(q.x, 0, r.x1 - minX)
    if (east) next.x1 = clamp(q.x, r.x0 + minX, f.width)
    if (north) next.y0 = clamp(q.y, 0, r.y1 - minY)
    if (south) next.y1 = clamp(q.y, r.y0 + minY, f.height)
  }
  return toCrop(f, next)
}

/** New crop after sliding the window by a scene-space delta, kept inside the image. */
export function moveCropWindow(f: CropFrame, crop: ImageCrop, dx: number, dy: number): ImageCrop {
  const r = toRect(f, crop)
  const d = rotatePoint(dx, dy, 0, 0, -f.angle)
  const mx = Math.min(Math.max(d.x, -r.x0), f.width - r.x1)
  const my = Math.min(Math.max(d.y, -r.y0), f.height - r.y1)
  return toCrop(f, { x0: r.x0 + mx, y0: r.y0 + my, x1: r.x1 + mx, y1: r.y1 + my })
}

/** True when the scene point lies inside the crop window of `el`. */
export function pointInCropWindow(el: ImageElement, x: number, y: number): boolean {
  const c = { x: el.x + el.width / 2, y: el.y + el.height / 2 }
  const q = el.angle === 0 ? { x, y } : rotatePoint(x, y, c.x, c.y, -el.angle)
  return q.x >= el.x && q.x <= el.x + el.width && q.y >= el.y && q.y <= el.y + el.height
}
