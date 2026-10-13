import { MAX_IMAGE_SIDE, fitSize, isImageMime, limitSide, sha1Hex } from '../element/image'
import type { FileData } from '../element/image'

export interface PreparedImage {
  file: FileData
  width: number
  height: number
}

const EXT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** MIME type of a file, falling back to its extension when the browser reports none. */
export function imageMimeOf(file: { type: string; name: string }): string | null {
  if (isImageMime(file.type)) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type === '' || file.type === 'application/octet-stream' ? (EXT_TYPES[ext] ?? null) : null
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Imagen no válida'))
    img.src = url
  })
}

function readDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** Decodes an image file, downscales it when its longest side exceeds 2000 px and hashes its bytes. */
export async function prepareImage(source: File): Promise<PreparedImage | null> {
  const mime = imageMimeOf(source)
  if (!mime) return null
  let blob: Blob = source.type === mime ? source : new Blob([await source.arrayBuffer()], { type: mime })
  const url = URL.createObjectURL(blob)
  let width: number
  let height: number
  try {
    const img = await loadImage(url)
    width = img.naturalWidth || 300
    height = img.naturalHeight || 150
    if (mime !== 'image/svg+xml' && Math.max(width, height) > MAX_IMAGE_SIDE) {
      const size = limitSide(width, height)
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      canvas.getContext('2d')?.drawImage(img, 0, 0, size.width, size.height)
      const outType = mime === 'image/jpeg' || mime === 'image/webp' ? mime : 'image/png'
      const scaled = await new Promise<Blob | null>((res) => canvas.toBlob(res, outType, 0.92))
      if (scaled) {
        blob = scaled
        width = size.width
        height = size.height
      }
    }
  } finally {
    URL.revokeObjectURL(url)
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const id = await sha1Hex(bytes)
  const now = Date.now()
  return { file: { id, mimeType: blob.type || mime, dataURL: await readDataURL(blob), created: now, lastRetrieved: now }, width, height }
}

/** Initial display size: fits in about half the viewport (in scene units), keeping the aspect ratio. */
export function displaySize(width: number, height: number, viewportW: number, viewportH: number, zoom: number) {
  return fitSize(width, height, viewportW / 2 / zoom, viewportH / 2 / zoom)
}
