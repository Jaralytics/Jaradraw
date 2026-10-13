import { nanoid } from 'nanoid'
import type { SceneElement } from './types'
import { parseElement } from '../scene/serialize'
import { sanitizeRelations } from './relations'
import { filesForElements, sanitizeFiles } from './image'

export interface LibraryItem {
  id: string
  status: 'published' | 'unpublished'
  elements: SceneElement[]
  created: number
  name?: string
  /** Binary data of the images used by the elements (not part of the standard format). */
  files?: Record<string, unknown>
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function parseElements(raw: unknown): SceneElement[] {
  if (!Array.isArray(raw)) return []
  const els: SceneElement[] = []
  for (const r of raw) {
    const el = parseElement(r)
    if (el && !el.isDeleted) els.push(el)
  }
  return sanitizeRelations(els)
}

/** Reads .excalidrawlib versions 1 and 2. Returns null when the input is not a library. */
export function parseLibrary(input: unknown): LibraryItem[] | null {
  let data = input
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (!isObject(data) || data.type !== 'excalidrawlib') return null
  const items: LibraryItem[] = []
  const now = Date.now()
  if (data.version === 1) {
    if (!Array.isArray(data.library)) return null
    for (const entry of data.library) {
      const elements = parseElements(entry)
      if (elements.length) items.push({ id: nanoid(), status: 'unpublished', elements, created: now })
    }
    return items.length === 0 && data.library.length > 0 ? null : items
  }
  const list = Array.isArray(data.libraryItems) ? data.libraryItems : Array.isArray(data.library) ? data.library : null
  if (!list) return null
  for (const entry of list) {
    if (Array.isArray(entry)) {
      const elements = parseElements(entry)
      if (elements.length) items.push({ id: nanoid(), status: 'unpublished', elements, created: now })
    } else if (isObject(entry)) {
      const elements = parseElements(entry.elements)
      if (!elements.length) continue
      const item: LibraryItem = {
        id: typeof entry.id === 'string' && entry.id ? entry.id : nanoid(),
        status: entry.status === 'published' ? 'published' : 'unpublished',
        elements,
        created: typeof entry.created === 'number' ? entry.created : now,
      }
      if (typeof entry.name === 'string') item.name = entry.name
      if (isObject(entry.files)) item.files = sanitizeFiles(entry.files)
      items.push(item)
    }
  }
  return items.length === 0 && list.length > 0 ? null : items
}

/** Current items first (added during startup), then stored ones not already present, by id. */
export function mergeLibrary(current: readonly LibraryItem[], stored: readonly LibraryItem[]): LibraryItem[] {
  const have = new Set(current.map((i) => i.id))
  return [...current, ...stored.filter((i) => !have.has(i.id))]
}

export function serializeLibrary(items: readonly LibraryItem[]): string {
  return JSON.stringify(
    {
      type: 'excalidrawlib',
      version: 2,
      source: 'jaradraw',
      libraryItems: items.map((it) => ({
        id: it.id,
        status: it.status,
        elements: it.elements,
        created: it.created,
        ...(it.name ? { name: it.name } : {}),
        ...(it.files && Object.keys(it.files).length ? { files: it.files } : {}),
      })),
    },
    null,
    2,
  )
}

/** Library item from a selection (labels and frame children already expanded by the caller). */
export function createLibraryItem(elements: readonly SceneElement[], files: Record<string, unknown>): LibraryItem | null {
  const live = elements.filter((e) => !e.isDeleted)
  if (live.length === 0) return null
  return {
    id: nanoid(),
    status: 'unpublished',
    elements: live.map((e) => ({ ...e })),
    created: Date.now(),
    files: filesForElements(live, files),
  }
}
