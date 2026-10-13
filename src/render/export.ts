import type { Box, SceneElement } from '../element/types'
import { collectFileIds, filesForElements } from '../element/image'
import { drawElements } from './draw'
import { effectiveScale, exportBounds } from './bounds'
import { ensureImages } from './imageCache'
import { buildSvg } from './svg'
import { embedSceneInPng, embedSceneInSvg } from '../scene/embed'
import { serializeScene } from '../scene/serialize'
import type { AppStateFile } from '../scene/serialize'

export { getExportableElements } from './bounds'

export interface RenderOptions {
  /** Background color, or null for a transparent export. */
  background: string | null
  scale: number
  files: Record<string, unknown>
  crop?: Box | null
  /** Caps the longest output side (previews). */
  maxSide?: number
}

/** Always rendered in light mode, whatever the UI theme. */
export async function renderToCanvas(
  elements: readonly SceneElement[],
  opts: RenderOptions,
): Promise<HTMLCanvasElement | null> {
  const visible = elements.filter((e) => !e.isDeleted)
  const b = exportBounds(visible, opts.crop ?? null)
  if (!b) return null
  await ensureImages(opts.files, collectFileIds(visible))
  const scale = effectiveScale(b.width, b.height, opts.scale, opts.maxSide)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(b.width * scale))
  canvas.height = Math.max(1, Math.ceil(b.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (opts.background) {
    ctx.fillStyle = opts.background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.scale(scale, scale)
  ctx.translate(-b.minX, -b.minY)
  drawElements(ctx, canvas, visible, opts.background ?? '#ffffff', null, undefined, null, { files: opts.files })
  return canvas
}

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))

export interface ExportRequest extends RenderOptions {
  embed: boolean
  appState: AppStateFile
}

function sceneJson(elements: readonly SceneElement[], req: ExportRequest): string {
  return JSON.stringify(serializeScene(elements, req.appState, filesForElements(elements, req.files)))
}

export async function renderPngBlob(elements: readonly SceneElement[], req: ExportRequest): Promise<Blob | null> {
  const canvas = await renderToCanvas(elements, req)
  if (!canvas) return null
  const blob = await toBlob(canvas)
  if (!blob || !req.embed) return blob
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const withScene = await embedSceneInPng(bytes, sceneJson(elements, req))
  return new Blob([withScene as BlobPart], { type: 'image/png' })
}

export async function renderSvgText(elements: readonly SceneElement[], req: ExportRequest): Promise<string | null> {
  const built = buildSvg(elements, { background: req.background, files: req.files, crop: req.crop })
  if (!built) return null
  return req.embed ? embedSceneInSvg(built.svg, sceneJson(elements, req)) : built.svg
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
