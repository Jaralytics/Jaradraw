import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import type { SceneElement } from '../element/types'
import { ANIMATION_PERIOD_MS, hasAnimations } from './animation'
import { effectiveScale, exportBounds } from './bounds'
import { renderToCanvas } from './export'
import type { RenderOptions } from './export'

export const GIF_FPS = 20
export const GIF_FRAME_COUNT = (ANIMATION_PERIOD_MS / 1000) * GIF_FPS
export const GIF_DELAY_MS = 1000 / GIF_FPS
/** Longest side of the output; larger scenes are scaled down. */
export const GIF_MAX_SIDE = 2000
const PALETTE_SAMPLE_FRAMES = 8
const PALETTE_SAMPLE_PIXELS = 400_000

export interface GifSize {
  width: number
  height: number
  scale: number
  /** The requested scale was reduced to respect GIF_MAX_SIDE. */
  capped: boolean
}

/** Output size of the GIF for these options (same bounds the frames use, pulses included). */
export function gifSize(elements: readonly SceneElement[], opts: Pick<RenderOptions, 'scale' | 'crop'>): GifSize | null {
  const b = exportBounds(elements, opts.crop ?? null, true)
  if (!b) return null
  const scale = effectiveScale(b.width, b.height, opts.scale, GIF_MAX_SIDE)
  return {
    width: Math.max(1, Math.ceil(b.width * scale)),
    height: Math.max(1, Math.ceil(b.height * scale)),
    scale,
    capped: scale < opts.scale - 1e-6,
  }
}

const pixelsOf = (canvas: HTMLCanvasElement): Uint8ClampedArray => {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Animated GIF of one loop. GIF has no alpha, so `opts.background` must be a color. A single global
 * palette is quantized from a few sampled frames so colors do not flicker between frames.
 */
export async function renderGifBlob(
  elements: readonly SceneElement[],
  opts: RenderOptions & { background: string },
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const frameOpts = { ...opts, maxSide: GIF_MAX_SIDE }
  const animated = hasAnimations(elements)
  const total = animated ? GIF_FRAME_COUNT : 1
  const frameTime = (i: number) => i * GIF_DELAY_MS
  const render = (i: number) => renderToCanvas(elements, { ...frameOpts, time: frameTime(i) })

  // pass 1: shared palette from evenly spaced frames, each subsampled so the total stays small
  const sampleFrames = animated ? PALETTE_SAMPLE_FRAMES : 1
  const perFrame = Math.floor(PALETTE_SAMPLE_PIXELS / sampleFrames)
  const parts: Uint8Array[] = []
  for (let k = 0; k < sampleFrames; k++) {
    const canvas = await render(Math.floor((k * total) / sampleFrames))
    if (!canvas || signal?.aborted) return null
    const data = pixelsOf(canvas)
    const pixels = data.length / 4
    const step = Math.max(1, Math.floor(pixels / perFrame))
    const part = new Uint8Array(Math.ceil(pixels / step) * 4)
    for (let p = 0, o = 0; p < pixels; p += step, o += 4) part.set(data.subarray(p * 4, p * 4 + 4), o)
    parts.push(part)
    await nextTick()
    if (signal?.aborted) return null
  }
  const sample = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    sample.set(part, at)
    at += part.length
  }
  const palette = quantize(sample, 256)

  // pass 2: encode one frame at a time so only one canvas is alive
  const gif = GIFEncoder()
  for (let i = 0; i < total; i++) {
    const canvas = await render(i)
    if (!canvas || signal?.aborted) return null
    const index = applyPalette(pixelsOf(canvas), palette)
    gif.writeFrame(index, canvas.width, canvas.height, { palette: i === 0 ? palette : undefined, delay: GIF_DELAY_MS, repeat: 0 })
    onProgress?.(i + 1, total)
    await nextTick()
    if (signal?.aborted) return null
  }
  gif.finish()
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' })
}
