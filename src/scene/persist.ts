import { useStore } from './store'
import type { InitialScene } from './store'
import { DEFAULT_VIEWPORT, clampZoom } from './viewport'
import type { Viewport } from './viewport'
import { parseScene, serializeScene } from './serialize'
import { canCollect, collectFileIds, filesForElements, hasDataURL, referencedFileIds, stripDataURLs } from '../element/image'
import type { FileData } from '../element/image'
import { mergeLibrary } from '../element/library'
import type { LibraryItem } from '../element/library'
import { idbDelete, idbGet, idbKeys, idbPut } from './idb'

export const STORAGE_KEY = 'jaradraw:scene'
const DEBOUNCE_MS = 300

interface SavedPayload {
  scene: unknown
  viewport: Viewport
}

export function loadSaved(): InitialScene | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const payload = JSON.parse(raw) as Partial<SavedPayload>
    const scene = parseScene(payload.scene)
    if (!scene) return null
    const vp = payload.viewport
    const viewport: Viewport =
      vp && [vp.scrollX, vp.scrollY, vp.zoom].every((n) => typeof n === 'number' && Number.isFinite(n))
        ? { scrollX: vp.scrollX, scrollY: vp.scrollY, zoom: clampZoom(vp.zoom) }
        : DEFAULT_VIEWPORT
    return { ...scene, viewport }
  } catch {
    return null
  }
}

function save(): void {
  const { elements, appState, files, viewport, setSaveError } = useStore.getState()
  try {
    const live = elements.filter((e) => !e.isDeleted)
    // binaries live in IndexedDB; localStorage only keeps the file metadata
    const meta = stripDataURLs(filesForElements(live, files))
    const payload: SavedPayload = { scene: serializeScene(live, appState, meta), viewport }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    setSaveError(false)
  } catch {
    setSaveError(true)
  }
  void syncFiles()
}

// Ids already written to IndexedDB during this session.
const persisted = new Set<string>()

/** Writes pending binaries; failures raise the separate files-error flag and are retried on later ticks. */
async function syncFiles(): Promise<void> {
  const { files, setFilesError } = useStore.getState()
  const todo = Object.entries(files).filter(([id, f]) => hasDataURL(f) && !persisted.has(id))
  if (todo.length === 0) return
  try {
    for (const [id, f] of todo) {
      await idbPut('files', id, f)
      persisted.add(id)
    }
    setFilesError(false)
  } catch {
    setFilesError(true)
  }
}

let hydration: Promise<void> | null = null

/** Resolves once the startup hydration has finished (immediately when it never started). */
export function whenHydrated(): Promise<void> {
  return hydration ?? Promise.resolve()
}

/** Loads the binaries of the scene's images from IndexedDB and merges them into the store. */
export async function hydrateFiles(): Promise<void> {
  const state = useStore.getState()
  const found: Record<string, unknown> = {}
  for (const id of collectFileIds(state.elements)) {
    if (hasDataURL(state.files[id])) continue
    const rec = await idbGet<FileData>('files', id)
    if (hasDataURL(rec)) {
      found[id] = rec
      persisted.add(id)
    }
  }
  useStore.getState().addFiles(found)
}

/**
 * Startup-only garbage collection. Files younger than 24 hours are kept (another tab may have just
 * stored them), and files this tab believes persisted but are missing are written again.
 */
export async function gcFiles(): Promise<void> {
  const keep = referencedFileIds(useStore.getState().history.stack.map((s) => s.elements))
  const keys = (await idbKeys('files')).map(String)
  const now = Date.now()
  for (const id of keys) {
    if (keep.has(id) || persisted.has(id)) continue
    const rec = await idbGet<FileData>('files', id)
    if (canCollect(rec?.created, now)) await idbDelete('files', id)
  }
  const have = new Set(keys)
  const files = useStore.getState().files
  for (const id of persisted) if (!have.has(id) && hasDataURL(files[id])) await idbPut('files', id, files[id])
}

let libraryReady = false

async function loadLibrary(): Promise<void> {
  const stored = await idbGet<LibraryItem[]>('library', 'items')
  const merged = mergeLibrary(useStore.getState().library, Array.isArray(stored) ? stored : [])
  useStore.getState().setLibrary(merged)
  libraryReady = true
  await idbPut('library', 'items', merged)
}

/** Hydrates images, garbage-collects, then merges the library. Failures only raise notices. */
export function initPersistence(): Promise<void> {
  const { setFilesError, setSaveError } = useStore.getState()
  hydration = (async () => {
    try {
      await hydrateFiles()
      await gcFiles()
    } catch {
      setFilesError(true)
    }
  })()
  return hydration.then(async () => {
    try {
      await loadLibrary()
    } catch {
      // the library stays unsaved this session rather than overwriting the stored one
      setSaveError(true)
    }
  })
}

export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let prev = useStore.getState()
  const unsubscribe = useStore.subscribe((s) => {
    if (libraryReady && s.library !== prev.library) {
      idbPut('library', 'items', s.library).catch(() => useStore.getState().setSaveError(true))
    }
    if (s.files !== prev.files) void syncFiles()
    const changed =
      s.elements !== prev.elements ||
      s.viewport !== prev.viewport ||
      s.appState !== prev.appState ||
      s.files !== prev.files
    prev = s
    if (!changed) return
    clearTimeout(timer)
    timer = setTimeout(save, DEBOUNCE_MS)
  })
  const flush = () => {
    useStore.getState().commitTextEditor()
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
      save()
    }
  }
  window.addEventListener('pagehide', flush)
  return () => {
    unsubscribe()
    window.removeEventListener('pagehide', flush)
    flush()
  }
}
