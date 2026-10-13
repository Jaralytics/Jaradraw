import { parseScene } from './serialize'
import type { SceneData } from './serialize'
import { useStore } from './store'
import { extractSceneFromPng, extractSceneFromSvg } from './embed'

export class FileError extends Error {}

interface WritableLike {
  write(data: string): Promise<void>
  close(): Promise<void>
}
export interface FileHandleLike {
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<WritableLike>
}
type PickerWindow = Window & {
  showOpenFilePicker?: (options?: unknown) => Promise<FileHandleLike[]>
  showSaveFilePicker?: (options?: unknown) => Promise<FileHandleLike>
}

const FILE_TYPES = [
  {
    description: 'Dibujo Excalidraw o imagen',
    accept: { 'application/json': ['.excalidraw', '.json'], 'image/png': ['.png'], 'image/svg+xml': ['.svg'] },
  },
]

const SCENE_NAME = /\.(excalidraw|json)$/i

let currentHandle: FileHandleLike | null = null

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

export function parseSceneFile(text: string): SceneData {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new FileError('El archivo no es un JSON válido')
  }
  const isExcalidraw =
    typeof json === 'object' && json !== null && (json as Record<string, unknown>).type === 'excalidraw'
  const data = isExcalidraw ? parseScene(json) : null
  if (!data) throw new FileError('El archivo no es un dibujo de Excalidraw válido')
  return data
}

/**
 * Scene stored in a file: .excalidraw/.json, or a PNG/SVG with an embedded scene.
 * Returns null for any other file (an image to insert); throws FileError for broken scenes.
 */
export const getCurrentHandle = () => currentHandle

/** Sets the remembered writable handle (null forgets it) so the next save asks where to write. */
export function adoptHandle(handle: FileHandleLike | null): void {
  currentHandle = handle
}

/** A handle is only kept for scene files; PNG/SVG and dropped files have no writable identity. */
export function fileIdentityHandle(file: { name: string }, handle: FileHandleLike | null): FileHandleLike | null {
  return handle && SCENE_NAME.test(file.name) ? handle : null
}

/**
 * Scene stored in a file: .excalidraw/.json, or a PNG/SVG with an embedded scene.
 * Returns null for any other file (an image to insert), including images whose embedded payload is
 * corrupt (a notice is shown); throws FileError for broken scene files.
 */
export async function readFileAsScene(file: File): Promise<SceneData | null> {
  const name = file.name.toLowerCase()
  const png = file.type === 'image/png' || name.endsWith('.png')
  const svg = file.type === 'image/svg+xml' || name.endsWith('.svg')
  if (png || svg) {
    try {
      const json = png
        ? await extractSceneFromPng(new Uint8Array(await file.arrayBuffer()))
        : await extractSceneFromSvg(await file.text())
      return json === null ? null : parseSceneFile(json)
    } catch {
      useStore.getState().notify('La escena incrustada está dañada; se inserta como imagen')
      return null
    }
  }
  try {
    if (SCENE_NAME.test(name) || file.type === 'application/json') return parseSceneFile(await file.text())
    return null
  } catch (e) {
    if (e instanceof FileError) throw e
    throw new FileError('No se pudo leer el archivo')
  }
}

export type OpenedFile =
  | { kind: 'scene'; data: SceneData; name: string; handle: FileHandleLike | null }
  | { kind: 'image'; file: File }

async function classify(file: File, handle: FileHandleLike | null): Promise<OpenedFile> {
  const data = await readFileAsScene(file)
  if (!data) return { kind: 'image', file }
  return { kind: 'scene', data, name: file.name, handle: fileIdentityHandle(file, handle) }
}

/** Returns null when the user cancels; throws FileError for unreadable or invalid files. */
export async function pickAndReadFile(): Promise<OpenedFile | null> {
  const w = window as PickerWindow
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: FILE_TYPES })
      return await classify(await handle.getFile(), handle)
    } catch (e) {
      if (isAbort(e)) return null
      if (e instanceof FileError) throw e
      throw new FileError('No se pudo leer el archivo')
    }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.excalidraw,.json,.png,.svg,application/json,image/png,image/svg+xml'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        resolve(await classify(file, null))
      } catch (e) {
        reject(e instanceof FileError ? e : new FileError('No se pudo leer el archivo'))
      }
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}

const withExtension = (name: string) => (name.endsWith('.excalidraw') ? name : `${name}.excalidraw`)

/** Returns the saved file name, or null when the user cancels. */
export async function writeSceneFile(json: string, saveAs: boolean, suggestedName: string): Promise<string | null> {
  const w = window as PickerWindow
  if (w.showSaveFilePicker) {
    try {
      let handle = saveAs ? null : currentHandle
      if (!handle) {
        handle = await w.showSaveFilePicker({ suggestedName: withExtension(suggestedName), types: FILE_TYPES })
      }
      const writable = await handle.createWritable()
      await writable.write(json)
      await writable.close()
      currentHandle = handle
      return handle.name
    } catch (e) {
      if (isAbort(e)) return null
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        // permission denied: keep the handle so the user can retry after granting access
        throw new FileError('Sin permiso para escribir en el archivo. Concede el acceso e inténtalo de nuevo')
      }
      currentHandle = null
      throw e
    }
  }
  const name = withExtension(suggestedName)
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return name
}
