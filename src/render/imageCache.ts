interface Entry {
  url: string
  img: HTMLImageElement
  ready: boolean
  failed: boolean
}

// Decoded images live outside the store, keyed by fileId.
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()

export function onImageLoaded(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function start(fileId: string, url: string): Entry {
  const img = new Image()
  const entry: Entry = { url, img, ready: false, failed: false }
  img.onload = () => {
    entry.ready = true
    listeners.forEach((fn) => fn())
  }
  // a failed entry is kept, so redraws do not decode again until the dataURL changes
  img.onerror = () => {
    entry.failed = true
  }
  img.src = url
  cache.set(fileId, entry)
  return entry
}

/** Returns the decoded image when ready; starts loading (and notifies listeners later) otherwise. */
export function getDecodedImage(fileId: string, dataURL: string | undefined): HTMLImageElement | null {
  if (!dataURL) return null
  let entry = cache.get(fileId)
  if (!entry || entry.url !== dataURL) entry = start(fileId, dataURL)
  return entry.ready ? entry.img : null
}

/** Pixel size of a decoded image, or null while it is not ready. */
export function getImageSize(fileId: string, dataURL: string | undefined): { width: number; height: number } | null {
  const img = getDecodedImage(fileId, dataURL)
  return img && img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null
}

/** Drops decoded images of files no element refers to any more. */
export function pruneImages(referenced: ReadonlySet<string>): void {
  for (const id of cache.keys()) if (!referenced.has(id)) cache.delete(id)
}

/** Waits until every listed file is decoded (used before exporting). Failed files are skipped. */
export async function ensureImages(files: Record<string, unknown>, ids: Iterable<string>): Promise<void> {
  const waits: Promise<void>[] = []
  for (const id of ids) {
    const url = (files[id] as { dataURL?: string } | undefined)?.dataURL
    if (!url) continue
    let entry = cache.get(id)
    if (!entry || entry.url !== url) entry = start(id, url)
    const e = entry
    if (e.ready || e.failed) continue
    waits.push(
      new Promise<void>((resolve) => {
        const done = () => resolve()
        e.img.addEventListener('load', done, { once: true })
        e.img.addEventListener('error', done, { once: true })
      }),
    )
  }
  await Promise.all(waits)
}
