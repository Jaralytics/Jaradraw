import { useEffect, useRef } from 'react'
import { useStore } from '../scene/store'
import type { FlowPreview } from '../scene/store'
import type { SceneElement } from '../element/types'
import { renderScene } from '../render/scene'
import { attachInteraction } from './interaction'
import { attachClipboard, handleDroppedFiles } from '../scene/actions'
import { onImageLoaded } from '../render/imageCache'
import { screenToScene } from '../scene/viewport'
import { gridSettings } from '../scene/serialize'

let previewCache: { source: FlowPreview; out: SceneElement[] } | null = null

/** The new nodes and arrows (and their bound texts) of a pending preview, memoized per preview. */
function previewElements(p: FlowPreview | null): SceneElement[] | undefined {
  if (!p) return undefined
  if (previewCache?.source === p) return previewCache.out
  const ids = new Set([...p.plan.nodeIds, ...p.plan.arrowIds])
  const out = p.plan.elements.filter((e) => ids.has(e.id))
  previewCache = { source: p, out }
  return out
}

export function Canvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  const cursor = useStore((s) => s.cursor)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    let raf = 0
    let width = 0
    let height = 0
    let dpr = 1

    const draw = () => {
      raf = 0
      const s = useStore.getState()
      const ids = new Set(s.selectedIds)
      const grid = gridSettings(s.appState)
      const selected = ids.size ? s.elements.filter((e) => ids.has(e.id)) : []
      renderScene({
        canvas,
        width,
        height,
        dpr,
        elements: s.elements,
        draft: s.draft,
        preview: previewElements(s.flowPreview),
        viewport: s.viewport,
        backgroundColor: s.appState.viewBackgroundColor,
        selected,
        marquee: s.marquee,
        hiddenId: s.textEditor ? s.textEditor.id : null,
        bindHighlight: s.bindHighlight,
        bindAnchor: s.bindAnchor,
        pointEdit: s.pointEdit,
        cropping: s.cropping,
        grid: grid.enabled ? grid : null,
        guides: s.snapGuides,
        fadedIds: s.erasing,
        editingGroupId: s.editingGroupId,
        dark: s.dark,
        files: s.files,
      })
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw)
    }

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      draw()
    }

    resize()
    window.addEventListener('resize', resize)
    const unsubscribe = useStore.subscribe(schedule)
    const unsubscribeImages = onImageLoaded(schedule)
    // window level, so a file dropped on a panel never navigates the browser away
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return
      void handleDroppedFiles(files, screenToScene(useStore.getState().viewport, e.clientX, e.clientY))
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    const detach = attachInteraction(canvas)
    const detachClipboard = attachClipboard()

    return () => {
      window.removeEventListener('resize', resize)
      unsubscribe()
      unsubscribeImages()
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      detach()
      detachClipboard()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={ref} className="canvas" style={{ cursor }} aria-label="Lienzo" />
}
