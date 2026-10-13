import type { SceneElement } from '../element/types'
import { parseElement } from './serialize'
import { sanitizeRelations } from '../element/relations'
import { filesForElements, sanitizeFiles } from '../element/image'

export const CLIPBOARD_TYPE = 'excalidraw/clipboard'

export function serializeClipboard(elements: readonly SceneElement[], files: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: CLIPBOARD_TYPE, elements, files: filesForElements(elements, files) })
}

export interface ClipboardData {
  elements: SceneElement[]
  files: Record<string, unknown>
}

/** Returns the elements of an Excalidraw clipboard payload, or null for anything else. */
export function parseClipboard(text: string): SceneElement[] | null {
  return parseClipboardData(text)?.elements ?? null
}

export function parseClipboardData(text: string): ClipboardData | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (obj.type !== CLIPBOARD_TYPE || !Array.isArray(obj.elements)) return null
  const elements: SceneElement[] = []
  for (const raw of obj.elements) {
    const el = parseElement(raw)
    if (el && !el.isDeleted) elements.push(el)
  }
  const files: Record<string, unknown> = sanitizeFiles(obj.files)
  return elements.length > 0 ? { elements: sanitizeRelations(elements), files } : null
}
