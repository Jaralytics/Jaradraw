import type { FrameElement, SceneElement } from '../element/types'
import { isFrame } from '../element/types'
import { updateElement } from '../element/factory'
import { getElementCorners } from '../element/geometry'
import type { Viewport } from './viewport'
import { clampZoom } from './viewport'

export const DEFAULT_SLIDE_SECONDS = 5
export const SLIDE_TRANSITION_MS = 400
export const ZOOM_TRANSITION_MS = 900
/** Share of a zoom transition spent zooming out; the rest zooms in on the next slide. */
export const ZOOM_OUT_SHARE = 0.45

/** "pan" goes straight to the next frame; "zoom" backs out to show both, then zooms in. */
export type SlideTransition = 'pan' | 'zoom'

export const transitionDuration = (kind: SlideTransition): number => (kind === 'zoom' ? ZOOM_TRANSITION_MS : SLIDE_TRANSITION_MS)
const INDEX_KEY = 'slideIndex'
const DURATION_KEY = 'slideDuration'

const numberAt = (el: SceneElement, key: string): number | null => {
  const v = el.customData?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * Frames in slide order: those with a `slideIndex` first (ascending, ties in scene order), then the
 * rest in scene order.
 */
export function slideFrames(elements: readonly SceneElement[]): FrameElement[] {
  const frames = elements.filter((e): e is FrameElement => isFrame(e) && !e.isDeleted)
  const order = new Map(frames.map((f, i) => [f.id, i]))
  const at = (f: FrameElement) => order.get(f.id) ?? 0
  return [...frames].sort((a, b) => {
    const ra = numberAt(a, INDEX_KEY)
    const rb = numberAt(b, INDEX_KEY)
    if (ra !== null && rb !== null) return ra - rb || at(a) - at(b)
    if (ra !== null) return -1
    if (rb !== null) return 1
    return at(a) - at(b)
  })
}

export const slideName = (frame: FrameElement, position: number): string =>
  frame.name && frame.name.trim() !== '' ? frame.name : `Diapositiva ${position + 1}`

/** `customData` with one key set or removed; other keys are kept. undefined when nothing is left. */
function customDataWithKey(el: SceneElement, key: string, value: number | null): Record<string, unknown> | undefined {
  const { [key]: _drop, ...rest } = el.customData ?? {}
  const next = value === null ? rest : { ...rest, [key]: value }
  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * Moves a slide by `delta` positions and renumbers every slide's `slideIndex` (0..n-1).
 * Returns the same array when nothing moves.
 */
export function reorderSlides(elements: readonly SceneElement[], id: string, delta: number): readonly SceneElement[] {
  const slides = slideFrames(elements)
  const from = slides.findIndex((f) => f.id === id)
  const to = Math.max(0, Math.min(slides.length - 1, from + delta))
  if (from < 0 || to === from) return elements
  const order = slides.map((f) => f.id)
  order.splice(to, 0, order.splice(from, 1)[0])
  const position = new Map(order.map((fid, i) => [fid, i]))
  return elements.map((e) => {
    const i = position.get(e.id)
    if (i === undefined || numberAt(e, INDEX_KEY) === i) return e
    return updateElement(e, { customData: customDataWithKey(e, INDEX_KEY, i) })
  })
}

/** Sets (or with null/invalid clears) the per-slide duration in seconds. */
export function withSlideDuration(elements: readonly SceneElement[], id: string, seconds: number | null): readonly SceneElement[] {
  const value = seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null
  return elements.map((e) => {
    if (e.id !== id || !isFrame(e) || numberAt(e, DURATION_KEY) === value) return e
    return updateElement(e, { customData: customDataWithKey(e, DURATION_KEY, value) })
  })
}

/** The slide's own duration in seconds, if it has a valid one. */
export function ownDuration(frame: SceneElement): number | null {
  const v = numberAt(frame, DURATION_KEY)
  return v !== null && v > 0 ? v : null
}

/** Seconds a slide stays on screen: its own duration, else the global default. */
export function slideDuration(frame: SceneElement, defaultSeconds: number): number {
  return ownDuration(frame) ?? defaultSeconds
}

/** Manual navigation: moves by `step` and stays within the slides. */
export function stepSlide(index: number, count: number, step: number): number {
  return Math.max(0, Math.min(count - 1, index + step))
}

/** Autoplay: the slide after `index`, the first one when looping, or null at the end. */
export function nextAutoplay(index: number, count: number, loop: boolean): number | null {
  if (count === 0) return null
  if (index + 1 < count) return index + 1
  return loop ? 0 : null
}

/** Share (0 to 1) of a slide's time that has elapsed. */
export function slideProgress(elapsedMs: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 1
  return Math.max(0, Math.min(1, elapsedMs / (durationSeconds * 1000)))
}

export function parseSeconds(raw: string): number | null {
  const n = Number(raw.replace(',', '.'))
  return raw.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : null
}

export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

/** Viewport that centers the frame on screen with a margin, filling as much as fits (no 1x cap). */
export function fitFrame(frame: Pick<FrameElement, 'x' | 'y' | 'width' | 'height'> & { angle?: number }, width: number, height: number, margin = 24): Viewport {
  // a rotated frame is fitted by the bounding box of its rotated corners (same center)
  const cos = Math.abs(Math.cos(frame.angle ?? 0))
  const sin = Math.abs(Math.sin(frame.angle ?? 0))
  const bw = Math.max(frame.width * cos + frame.height * sin, 1)
  const bh = Math.max(frame.width * sin + frame.height * cos, 1)
  const zoom = clampZoom(Math.min((width - margin * 2) / bw, (height - margin * 2) / bh))
  return {
    zoom,
    scrollX: width / (2 * zoom) - (frame.x + frame.width / 2),
    scrollY: height / (2 * zoom) - (frame.y + frame.height / 2),
  }
}

/** Viewport that fits all the given frames (bounding box of their rotated corners) with the same margin. */
export function overviewViewport(frames: readonly FrameElement[], width: number, height: number, margin = 24): Viewport {
  const pts = frames.flatMap((f) => getElementCorners(f))
  const x1 = Math.min(...pts.map((p) => p.x))
  const y1 = Math.min(...pts.map((p) => p.y))
  const x2 = Math.max(...pts.map((p) => p.x))
  const y2 = Math.max(...pts.map((p) => p.y))
  return fitFrame({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, width, height, margin)
}

/**
 * Viewport at progress t (0 to 1, linear in time) of a transition from `from` to `to`. The zoom kind
 * passes through `overview` (ease out to it, then ease in); both phases interpolate zoom in log space.
 */
export function transitionViewport(
  kind: SlideTransition,
  from: Viewport,
  to: Viewport,
  overview: Viewport | null,
  t: number,
  width: number,
  height: number,
): Viewport {
  if (kind !== 'zoom' || !overview) return lerpViewport(from, to, easeInOut(t), width, height)
  if (t < ZOOM_OUT_SHARE) return lerpViewport(from, overview, easeInOut(t / ZOOM_OUT_SHARE), width, height)
  return lerpViewport(overview, to, easeInOut((t - ZOOM_OUT_SHARE) / (1 - ZOOM_OUT_SHARE)), width, height)
}

/** Interpolates the visible center and the zoom (geometrically), so a pan/zoom looks even. */
export function lerpViewport(a: Viewport, b: Viewport, t: number, width: number, height: number): Viewport {
  const zoom = a.zoom * Math.pow(b.zoom / a.zoom, t)
  const cx = (width / (2 * a.zoom) - a.scrollX) * (1 - t) + (width / (2 * b.zoom) - b.scrollX) * t
  const cy = (height / (2 * a.zoom) - a.scrollY) * (1 - t) + (height / (2 * b.zoom) - b.scrollY) * t
  return { zoom, scrollX: width / (2 * zoom) - cx, scrollY: height / (2 * zoom) - cy }
}
