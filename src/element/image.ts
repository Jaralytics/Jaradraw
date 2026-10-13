import { nanoid } from 'nanoid'
import type { ImageElement, SceneElement } from './types'
import { isImage } from './types'
import { baseDefaults } from './factory'

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] as const
export const MAX_IMAGE_SIDE = 2000

export interface FileData {
  id: string
  mimeType: string
  dataURL: string
  created: number
  lastRetrieved: number
}

export function isImageMime(type: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(type)
}

export function createImageElement(fileId: string, x: number, y: number, width: number, height: number): ImageElement {
  return {
    ...baseDefaults(),
    id: nanoid(),
    type: 'image',
    x,
    y,
    width,
    height,
    strokeColor: 'transparent',
    fileId,
    status: 'saved',
    scale: [1, 1],
    crop: null,
  }
}

/** Largest size that keeps the aspect ratio, fits in maxW x maxH and never upscales. */
export function fitSize(w: number, h: number, maxW: number, maxH: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: Math.max(1, maxW), height: Math.max(1, maxH) }
  const s = Math.min(1, maxW / w, maxH / h)
  return { width: Math.max(1, w * s), height: Math.max(1, h * s) }
}

/** Size after limiting the longest side to `max`. */
export function limitSide(w: number, h: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(w, h, 1))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** File ids used by (non-deleted, unless `includeDeleted`) image elements. */
export function collectFileIds(elements: readonly SceneElement[], includeDeleted = false): Set<string> {
  const out = new Set<string>()
  for (const e of elements) if (isImage(e) && e.fileId && (includeDeleted || !e.isDeleted)) out.add(e.fileId)
  return out
}

/** The subset of `files` referenced by live image elements; this is what saved files carry. */
export function filesForElements(
  elements: readonly SceneElement[],
  files: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const id of collectFileIds(elements)) if (files[id] !== undefined) out[id] = files[id]
  return out
}

/** Every file id referenced by any snapshot (deleted elements included): the garbage-collection root set. */
export function referencedFileIds(snapshots: readonly (readonly SceneElement[])[]): Set<string> {
  const out = new Set<string>()
  for (const s of snapshots) for (const id of collectFileIds(s, true)) out.add(id)
  return out
}

export const DATA_URL_RE = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,/
export const GC_MIN_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Validated copy of an untrusted file map: only base64 image data URLs whose mimeType matches are
 * kept, and entries that already carry a dataURL in `existing` are never overwritten.
 */
export function sanitizeFiles(incoming: unknown, existing: Record<string, unknown> = {}): Record<string, FileData> {
  const out: Record<string, FileData> = {}
  if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) return out
  for (const [id, raw] of Object.entries(incoming)) {
    if (typeof raw !== 'object' || raw === null) continue
    const f = raw as Record<string, unknown>
    if (typeof f.dataURL !== 'string') continue
    const m = DATA_URL_RE.exec(f.dataURL)
    if (!m || f.mimeType !== m[1]) continue
    if (hasDataURL(existing[id])) continue
    const now = Date.now()
    out[id] = {
      ...(f as object),
      id,
      mimeType: m[1],
      dataURL: f.dataURL,
      created: typeof f.created === 'number' ? f.created : now,
      lastRetrieved: typeof f.lastRetrieved === 'number' ? f.lastRetrieved : now,
    }
  }
  return out
}

/** Ids of live images whose binary data is not available. */
export function missingFileIds(elements: readonly SceneElement[], files: Record<string, unknown>): string[] {
  return [...collectFileIds(elements)].filter((id) => !hasDataURL(files[id]))
}

/** Garbage-collection age rule: only files older than 24 hours may be removed. */
export function canCollect(created: unknown, now: number): boolean {
  return typeof created === 'number' && now - created > GC_MIN_AGE_MS
}

export function hasDataURL(f: unknown): f is FileData {
  return typeof f === 'object' && f !== null && typeof (f as FileData).dataURL === 'string'
}

/** Copy of the file map without binary payloads (what localStorage keeps). */
export function stripDataURLs(files: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [id, f] of Object.entries(files)) {
    if (typeof f === 'object' && f !== null) {
      const { dataURL: _omit, ...meta } = f as Record<string, unknown>
      void _omit
      out[id] = meta
    }
  }
  return out
}
