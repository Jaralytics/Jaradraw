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
import { hasAnimations } from '../render/animation'
import { slideFrames } from '../scene/slides'

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
    // animations run only while the scene has animated elements, and never for reduced motion
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let pointerDown = false
    let animatedSource: readonly SceneElement[] | null = null
    let animatedCache = false
    const sceneAnimated = (elements: readonly SceneElement[]) => {
      if (animatedSource !== elements) {
        animatedSource = elements
        animatedCache = hasAnimations(elements)
      }
      return animatedCache
    }

    const draw = () => {
      raf = 0
      const s = useStore.getState()
      const animating = !reducedMotion.matches && sceneAnimated(s.elements)
      // what is being edited stays still so the gesture is not jittery
      const still = new Set<string>()
      if (animating) {
        if (s.draft) still.add(s.draft.id)
        if (s.textEditor) still.add(s.textEditor.id)
        if (s.cropping) still.add(s.cropping.id)
        if (s.pointEdit) still.add(s.pointEdit.id)
        if (pointerDown) for (const id of s.selectedIds) still.add(id)
      }
      const ids = new Set(s.selectedIds)
      const grid = gridSettings(s.appState)
      const selected = ids.size ? s.elements.filter((e) => ids.has(e.id)) : []
      const slides = s.presentation ? slideFrames(s.elements) : []
      const present = s.presentation
        ? [s.presentation.index, s.presentation.from].flatMap((i) => (i === undefined || !slides[i] ? [] : [slides[i]]))
        : undefined
      const presenting = s.presentation !== null
      renderScene({
        canvas,
        width,
        height,
        dpr,
        elements: s.elements,
        draft: presenting ? null : s.draft,
        preview: presenting ? undefined : previewElements(s.flowPreview),
        viewport: s.viewport,
        backgroundColor: s.appState.viewBackgroundColor,
        selected: presenting ? [] : selected,
        marquee: presenting ? null : s.marquee,
        hiddenId: s.textEditor ? s.textEditor.id : null,
        bindHighlight: presenting ? null : s.bindHighlight,
        bindAnchor: presenting ? null : s.bindAnchor,
        pointEdit: presenting ? null : s.pointEdit,
        cropping: presenting ? null : s.cropping,
        grid: grid.enabled && !presenting ? grid : null,
        guides: presenting ? undefined : s.snapGuides,
        presentFrames: present,
        fadedIds: s.erasing,
        editingGroupId: s.editingGroupId,
        dark: s.dark,
        files: s.files,
        time: animating ? performance.now() : undefined,
        stillIds: animating ? still : undefined,
      })
      if (animating) schedule()
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

    const onDown = () => {
      pointerDown = true
    }
    const onUp = () => {
      pointerDown = false
    }
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    reducedMotion.addEventListener('change', schedule)

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
      if (useStore.getState().presentation) return
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
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      reducedMotion.removeEventListener('change', schedule)
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
