import { useStore, getSelectedElements } from './store'
import { cloneCentered, cloneElements } from '../element/clone'
import { createText } from '../element/factory'
import { measureText } from '../element/text'
import { getCommonBounds } from '../element/geometry'
import { isLinear, isRenderable, isShape, isText } from '../element/types'
import { expandWithLabels } from '../element/relations'
import { withFrameChildren } from '../element/frame'
import { filesForElements, hasDataURL, isImageMime, missingFileIds } from '../element/image'
import { parseLibrary, serializeLibrary } from '../element/library'
import type { SceneElement } from '../element/types'
import { downloadBlob } from '../render/export'
import { isTypingTarget } from '../ui/dom'
import { DIRECTION_BY_KEY, isNode } from '../element/flowchart'
import { parseClipboardData, serializeClipboard } from './clipboard'
import { FileError, adoptHandle, pickAndReadFile, readFileAsScene, writeSceneFile } from './files'
import { displaySize, imageMimeOf, prepareImage } from './images'
import type { PreparedImage } from './images'
import { whenHydrated } from './persist'
import { getLastPointerScene } from './pointer'
import { serializeScene } from './serialize'
import { TEMPLATES } from './templates'
import type { SceneData } from './serialize'
import { screenToScene, fitViewportToBounds, zoomViewportAt } from './viewport'

const st = () => useStore.getState()

export const liveElements = (): SceneElement[] => st().elements.filter((e) => !e.isDeleted && isRenderable(e))

/** Selected elements plus the labels of selected containers and the children of selected frames. */
export function selectedWithLabels(): SceneElement[] {
  const all = st().elements
  return withFrameChildren(all, expandWithLabels(all, getSelectedElements(st())))
}

export function deleteAction(): void {
  const pe = st().pointEdit
  if (pe?.selected != null || pe?.waypoint !== undefined) {
    if (st().deletePoint()) return
    // a stale node never takes the whole element with it; a locked element is left to deleteSelected, which skips it
    if (!st().elements.find((e) => e.id === pe.id)?.locked) {
      st().setPointEdit(null)
      return
    }
  }
  st().deleteSelected()
}

/** Enter: edit the label of the selected shape or arrow, or a free text. */
export function editSelected(): void {
  const sel = getSelectedElements(st())
  if (sel.length !== 1) return
  const el = sel[0]
  if (el.locked) return
  if (el.type === 'frame') {
    st().showModal({ kind: 'renameFrame', id: el.id })
    return
  }
  if (isLinear(el)) {
    if (el.type === 'arrow') st().openLabelEditor(el.id)
  } else if (isShape(el)) {
    st().openLabelEditor(el.id)
  } else if (isText(el) && el.containerId == null) {
    st().openTextEditor({ id: el.id, x: el.x, y: el.y, existing: true })
  }
}

const viewSize = () => ({ width: window.innerWidth, height: window.innerHeight })

/** Ctrl+Arrow: preview connected nodes in the pressed direction; releasing Ctrl inserts them. */
export function createConnectedNode(e?: KeyboardEvent): void {
  const dir = e ? DIRECTION_BY_KEY[e.key.toLowerCase()] : undefined
  if (dir) st().previewConnectedNodes(dir, viewSize())
}

/** Ctrl/Cmd released: insert the pending flowchart nodes. */
export function commitConnectedNodes(): void {
  st().commitFlowPreview(viewSize())
}

/** Alt+Shift+Arrow: move the selection along the arrows to the connected node in that direction. */
export function goToConnectedNode(e?: KeyboardEvent): void {
  const dir = e ? DIRECTION_BY_KEY[e.key.toLowerCase()] : undefined
  if (dir) st().selectConnected(dir, viewSize())
}

/** Tab / Shift+Tab: cycle the type of the selected nodes. */
export function cycleShapeType(e?: KeyboardEvent): void {
  st().cycleNodeTypes(!!e?.shiftKey)
}

/** True when at least one selected element is a node, so Tab has something to convert. */
export function hasSelectedNode(): boolean {
  return getSelectedElements(st()).some(isNode)
}

// In-memory fallback used when the system clipboard is unavailable.
let memoryClipboard: string | null = null

export function duplicateSelection(): void {
  const els = selectedWithLabels()
  if (els.length === 0) return
  st().addElements(cloneElements(els, 10, 10), 'duplicate')
}

function pointerOrCenter() {
  return (
    getLastPointerScene() ??
    screenToScene(st().viewport, window.innerWidth / 2, window.innerHeight / 2)
  )
}

function onCopy(e: ClipboardEvent, cut: boolean): void {
  if (st().modal || isTypingTarget(e.target)) return
  const els = selectedWithLabels()
  if (els.length === 0) return
  if (missingFileIds(els, st().files).length > 0) {
    st().notify('No se puede copiar: hay imágenes que aún no se han cargado')
    return
  }
  const json = serializeClipboard(els, st().files)
  memoryClipboard = json
  if (e.clipboardData) {
    try {
      e.clipboardData.setData('text/plain', json)
      memoryClipboard = null
      e.preventDefault()
    } catch {
      // keep the in-memory copy
    }
  }
  if (cut) st().deleteSelected()
}

function onPaste(e: ClipboardEvent): void {
  if (st().modal || isTypingTarget(e.target)) return
  e.preventDefault()
  let text = ''
  let systemAvailable = false
  let imageFiles: File[] = []
  try {
    if (e.clipboardData) {
      text = e.clipboardData.getData('text/plain')
      imageFiles = Array.from(e.clipboardData.files).filter((f) => imageMimeOf(f) !== null)
      systemAvailable = true
    }
  } catch {
    systemAvailable = false
  }
  // The in-memory copy only stands in when the system clipboard cannot be read at all
  if (!systemAvailable && memoryClipboard) text = memoryClipboard
  const p = pointerOrCenter()
  const data = parseClipboardData(text)
  if (data) {
    const files: Record<string, unknown> = {}
    for (const [id, f] of Object.entries(data.files)) if (hasDataURL(f)) files[id] = f
    st().addFiles(files)
    st().addElements(cloneCentered(data.elements, p.x, p.y), 'paste')
    return
  }
  if (imageFiles.length > 0) {
    void insertImageFiles(imageFiles, p)
    return
  }
  if (text.trim() === '') return
  const { defaults } = st()
  const plain = text.replace(/\r\n?/g, '\n')
  const size = measureText(plain, 20, 2, 1.25)
  st().addElements(
    [createText(p.x, p.y, plain, size, { strokeColor: defaults.strokeColor, opacity: defaults.opacity })],
    'paste',
  )
}

export function attachClipboard(): () => void {
  const copy = (e: ClipboardEvent) => onCopy(e, false)
  const cut = (e: ClipboardEvent) => onCopy(e, true)
  document.addEventListener('copy', copy)
  document.addEventListener('cut', cut)
  document.addEventListener('paste', onPaste)
  return () => {
    document.removeEventListener('copy', copy)
    document.removeEventListener('cut', cut)
    document.removeEventListener('paste', onPaste)
  }
}

/* Images */

async function prepareAll(files: readonly File[]): Promise<{ items: PreparedImage[]; failed: number }> {
  const items: PreparedImage[] = []
  let failed = 0
  for (const f of files) {
    try {
      const p = await prepareImage(f)
      if (p) items.push(p)
      else failed++
    } catch {
      failed++
    }
  }
  return { items, failed }
}

function toPending(items: readonly PreparedImage[]) {
  const vp = st().viewport
  st().addFiles(Object.fromEntries(items.map((i) => [i.file.id, i.file])))
  return items.map((i) => {
    const size = displaySize(i.width, i.height, window.innerWidth, window.innerHeight, vp.zoom)
    return { fileId: i.file.id, ...size }
  })
}

/** Inserts image files (paste, drop) centered on `at`, or on the viewport center. */
export async function insertImageFiles(files: readonly File[], at?: { x: number; y: number }): Promise<void> {
  const { items, failed } = await prepareAll(files.filter((f) => imageMimeOf(f) !== null))
  if (failed > 0 || (items.length === 0 && files.length > 0)) st().notify('No se pudo cargar alguna imagen')
  if (items.length === 0) return
  const p = at ?? screenToScene(st().viewport, window.innerWidth / 2, window.innerHeight / 2)
  st().insertImages(toPending(items), p.x, p.y)
}

/** Toolbar button / key 9: pick files, then place them where the user clicks. */
export function pickImages(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.png,.jpg,.jpeg,.gif,.webp,.svg'
  input.onchange = async () => {
    const files = Array.from(input.files ?? [])
    if (files.length === 0) return
    const { items, failed } = await prepareAll(files)
    if (failed > 0) st().notify('No se pudo cargar alguna imagen')
    if (items.length === 0) return
    st().setPendingImages(toPending(items))
    st().notify('Haz clic en el lienzo para colocar la imagen')
  }
  input.click()
}

/* Files */

function applyScene(data: SceneData, name: string | null): void {
  const visible = data.elements.filter((e) => !e.isDeleted && isRenderable(e))
  const viewport = fitViewportToBounds(getCommonBounds(visible), window.innerWidth, window.innerHeight)
  st().openScene({ ...data, viewport }, name)
}

/** Replaces the scene and its file identity (handle and name) in one step. */
export function replaceScene(data: SceneData, name: string | null, handle: Parameters<typeof adoptHandle>[0]): void {
  adoptHandle(handle)
  applyScene(data, name)
}

/**
 * Runs `proceed` once every live image has its binary data. Waits for the startup hydration first;
 * if images are still missing the user must confirm (cancel is the default focus).
 */
export function guardMissingFiles(elements: readonly SceneElement[], proceed: () => void): void {
  void (async () => {
    let missing = missingFileIds(elements, st().files)
    if (missing.length > 0) {
      try {
        await whenHydrated()
      } catch {
        // handled by the persistence layer
      }
      missing = missingFileIds(elements, st().files)
    }
    if (missing.length === 0) return proceed()
    st().showModal({
      kind: 'confirm',
      title: 'Imágenes sin cargar',
      message: `No se pudieron cargar ${missing.length} imágenes y faltarán en el resultado. ¿Continuar de todos modos?`,
      confirmLabel: 'Continuar',
      cancelFocus: true,
      onConfirm: proceed,
    })
  })()
}

function confirmReplace(
  apply: () => void,
  copy = {
    title: 'Abrir archivo',
    message: 'El dibujo actual se reemplazará por el contenido del archivo. Esta acción no se puede deshacer.',
    confirmLabel: 'Abrir',
  },
): void {
  if (liveElements().length === 0) {
    apply()
    return
  }
  st().showModal({ kind: 'confirm', ...copy, onConfirm: apply })
}

/** Replaces the drawing with a fresh copy of a template; it has no file identity until saved. */
export function loadTemplate(id: string): void {
  const template = TEMPLATES.find((t) => t.id === id)
  if (!template) return
  confirmReplace(
    () => replaceScene({ elements: template.build(), appState: st().appState, files: {} }, null, null),
    {
      title: 'Cargar plantilla',
      message: `El dibujo actual se reemplazará por la plantilla "${template.name}". Esta acción no se puede deshacer.`,
      confirmLabel: 'Cargar',
    },
  )
}

/** Starts an empty drawing with no file identity; grid and background settings are kept. */
export function newFile(): void {
  confirmReplace(() => replaceScene({ elements: [], appState: st().appState, files: {} }, null, null), {
    title: 'Nuevo boceto',
    message: 'El dibujo actual se borrará para empezar uno nuevo. Esta acción no se puede deshacer.',
    confirmLabel: 'Empezar de cero',
  })
}

export async function openFile(): Promise<void> {
  try {
    const result = await pickAndReadFile()
    if (!result) return
    if (result.kind === 'image') {
      await insertImageFiles([result.file])
      return
    }
    confirmReplace(() => replaceScene(result.data, result.name, result.handle))
  } catch (e) {
    st().notify(e instanceof FileError ? e.message : 'No se pudo abrir el archivo')
  }
}

/** Files dropped on the canvas: a scene (with confirmation) or images at the drop position. */
export async function handleDroppedFiles(files: readonly File[], at: { x: number; y: number }): Promise<void> {
  try {
    const first = files[0]
    if (!first) return
    const data = await readFileAsScene(first)
    if (data) {
      confirmReplace(() => replaceScene(data, first.name, null))
      return
    }
    await insertImageFiles(
      files.filter((f) => isImageMime(imageMimeOf(f) ?? '')),
      at,
    )
  } catch (e) {
    st().notify(e instanceof FileError ? e.message : 'No se pudo abrir el archivo')
  }
}

export function saveFile(saveAs: boolean): void {
  const live = st().elements.filter((e) => !e.isDeleted)
  guardMissingFiles(live, () => void writeScene(saveAs))
}

async function writeScene(saveAs: boolean): Promise<void> {
  const { appState, files, fileName } = st()
  const live = st().elements.filter((e) => !e.isDeleted)
  const json = JSON.stringify(serializeScene(live, appState, filesForElements(live, files)), null, 2)
  try {
    const base = fileName ? fileName.replace(/\.(excalidraw|json|png|svg)$/i, '') : 'jaradraw'
    const name = await writeSceneFile(json, saveAs, base)
    if (name) st().setFileName(name)
  } catch (e) {
    st().notify(e instanceof FileError ? e.message : 'No se pudo guardar el archivo')
  }
}

export function openExportDialog(): void {
  if (liveElements().length === 0) {
    st().notify('No hay nada que exportar')
    return
  }
  st().showModal({ kind: 'export' })
}

/* Library */

export function importLibraryFile(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.excalidrawlib,.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const items = parseLibrary(await file.text().catch(() => ''))
    if (!items) st().notify('El archivo no es una biblioteca válida')
    else if (items.length === 0) st().notify('La biblioteca está vacía')
    else {
      const added = st().importLibraryItems(items)
      st().notify(
        added === 0
          ? 'Esos elementos ya estaban en la biblioteca'
          : `Se importaron ${added} ${added === 1 ? 'elemento' : 'elementos'}`,
      )
    }
  }
  input.click()
}

export function exportLibraryFile(): void {
  const items = st().library
  if (items.length === 0) {
    st().notify('La biblioteca está vacía')
    return
  }
  downloadBlob(new Blob([serializeLibrary(items)], { type: 'application/json' }), 'jaradraw.excalidrawlib')
}

const ZOOM_STEP = 1.2

export function zoomBy(factor: number | 'reset'): void {
  const { viewport, setViewport } = st()
  const z = factor === 'reset' ? 1 : viewport.zoom * factor
  setViewport(zoomViewportAt(viewport, window.innerWidth / 2, window.innerHeight / 2, z))
}

export const zoomIn = () => zoomBy(ZOOM_STEP)
export const zoomOut = () => zoomBy(1 / ZOOM_STEP)
