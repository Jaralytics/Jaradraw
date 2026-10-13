import type { Box, FrameElement, SceneElement } from '../element/types'
import { containerIdOf, isBoundText, isFrame, isRenderable } from '../element/types'
import { getCommonBounds } from '../element/geometry'
import { FRAME_NAME_HEIGHT } from '../element/frame'

export const EXPORT_PADDING = 16

export function getExportableElements(elements: readonly SceneElement[]): SceneElement[] {
  return elements.filter((e) => !e.isDeleted && isRenderable(e))
}

/**
 * Elements to export for a selection: the selected ones, their labels and the children of selected
 * frames. With nothing selected, everything exportable.
 */
export function selectExportElements(elements: readonly SceneElement[], selectedIds: readonly string[]): SceneElement[] {
  const all = getExportableElements(elements)
  if (selectedIds.length === 0) return all
  const ids = new Set(selectedIds)
  const frames = new Set(all.filter((e) => isFrame(e) && ids.has(e.id)).map((e) => e.id))
  return all.filter(
    (e) =>
      ids.has(e.id) ||
      (isBoundText(e) && ids.has(containerIdOf(e) as string)) ||
      (e.frameId !== null && frames.has(e.frameId)),
  )
}

/** A single selected frame crops the export to its bounds. */
export function exportCrop(elements: readonly SceneElement[], selectedIds: readonly string[]): FrameElement | null {
  if (selectedIds.length !== 1) return null
  const f = elements.find((e) => e.id === selectedIds[0] && !e.isDeleted)
  return f && isFrame(f) ? f : null
}

export interface ExportBounds {
  minX: number
  minY: number
  width: number
  height: number
}

export const MAX_EXPORT_SIDE = 16000
export const MAX_EXPORT_PIXELS = 64_000_000

/** Scale actually used: the requested one, reduced to respect the side and area limits. */
export function effectiveScale(width: number, height: number, scale: number, maxSide?: number): number {
  let s = Math.min(scale, MAX_EXPORT_SIDE / Math.max(width, height), Math.sqrt(MAX_EXPORT_PIXELS / Math.max(1, width * height)))
  if (maxSide) s = Math.min(s, maxSide / Math.max(width, height))
  return s
}

/** Export bounds; the name drawn above each frame (also a cropped one) is included. */
export function exportBounds(elements: readonly SceneElement[], crop: Box | null = null): ExportBounds | null {
  if (crop) {
    return { minX: crop.x, minY: crop.y - FRAME_NAME_HEIGHT, width: crop.width, height: crop.height + FRAME_NAME_HEIGHT }
  }
  const b = getCommonBounds(elements)
  if (!b) return null
  const thick = Math.max(0, ...elements.filter((e) => e.type === 'freedraw').map((e) => e.strokeWidth * 2.5))
  const top = Math.min(b[1], ...elements.filter(isFrame).map((f) => f.y - FRAME_NAME_HEIGHT))
  const minX = b[0] - thick - EXPORT_PADDING
  const minY = top - thick - EXPORT_PADDING
  return { minX, minY, width: b[2] + thick + EXPORT_PADDING - minX, height: b[3] + thick + EXPORT_PADDING - minY }
}
