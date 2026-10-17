import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../scene/store'
import { loadSlideLoop, loadSlideSeconds, loadSlideTransition, saveSlideLoop, saveSlideSeconds, saveSlideTransition } from '../scene/slideSettings'
import {
  fitFrame,
  nextAutoplay,
  overviewViewport,
  parseSeconds,
  slideDuration,
  slideFrames,
  slideProgress,
  stepSlide,
  transitionDuration,
  transitionViewport,
} from '../scene/slides'
import type { SlideTransition } from '../scene/slides'
import { TransitionToggle } from './TransitionToggle'
import { isTypingTarget } from './dom'
import { CloseIcon } from './icons'
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon } from './iconsExtra'

const BAR_IDLE_MS = 2500

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function Presentation() {
  const active = useStore((s) => s.presentation !== null)
  return active ? <PresentationView /> : null
}

function PresentationView() {
  const elements = useStore((s) => s.elements)
  const index = useStore((s) => s.presentation?.index ?? 0)
  const setIndex = useStore((s) => s.setPresentationIndex)
  const end = useStore((s) => s.endPresentation)
  const setViewport = useStore((s) => s.setViewport)
  const settle = useStore((s) => s.settlePresentation)

  const slides = useMemo(() => slideFrames(elements), [elements])
  const count = slides.length
  const frame = slides[Math.min(index, count - 1)]

  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(loadSlideLoop)
  const [seconds, setSeconds] = useState(loadSlideSeconds)
  const [secondsText, setSecondsText] = useState(() => String(loadSlideSeconds()))
  const [transition, setTransition] = useState<SlideTransition>(loadSlideTransition)
  const transitionRef = useRef(transition)
  transitionRef.current = transition
  const [visible, setVisible] = useState(true)
  // bumped by every manual navigation so the slide timer restarts even when the index does not change
  const [cycle, setCycle] = useState(0)
  const bar = useRef<HTMLDivElement>(null)
  const idleTimer = useRef(0)
  const cancelMove = useRef<() => void>(() => {})

  // the last frame was deleted while presenting
  useEffect(() => {
    if (count === 0) end()
    else if (index > count - 1) setIndex(count - 1)
  }, [count, index, end, setIndex])

  // fullscreen on enter (best effort); leaving it by any means ends the presentation
  useEffect(() => {
    // tracked from the events, not the request promise, so a remount (StrictMode) cannot lose it
    let entered = document.fullscreenElement !== null
    const root = document.documentElement
    if (!entered) {
      root.requestFullscreen?.()
        .then(() => {
          // the presentation ended before the request resolved
          if (useStore.getState().presentation === null && document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {})
          }
        })
        .catch(() => {})
    }
    const onChange = () => {
      if (document.fullscreenElement) entered = true
      else if (entered) end()
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [end])

  // pan/zoom to the current frame (eased, instant for reduced motion)
  const frameKey = frame ? `${frame.id}:${frame.x}:${frame.y}:${frame.width}:${frame.height}` : ''
  useEffect(() => {
    if (!frame) return
    const w = window.innerWidth
    const h = window.innerHeight
    const from = useStore.getState().viewport
    const to = fitFrame(frame, w, h)
    if (reducedMotion()) {
      setViewport(to)
      settle()
      return
    }
    // the zoom kind needs the slide being left; a jump of several slides uses the same transition
    const fromIndex = useStore.getState().presentation?.from
    const prev = fromIndex === undefined ? undefined : slides[fromIndex]
    const kind = prev && transitionRef.current === 'zoom' ? 'zoom' : 'pan'
    const overview = kind === 'zoom' && prev ? overviewViewport([prev, frame], w, h) : null
    const duration = transitionDuration(kind)
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setViewport(transitionViewport(kind, from, to, overview, t, w, h))
      if (t < 1) raf = requestAnimationFrame(step)
      else settle()
    }
    raf = requestAnimationFrame(step)
    cancelMove.current = () => cancelAnimationFrame(raf)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, setViewport, settle])

  // a resized window refits at once
  useEffect(() => {
    const onResize = () => {
      if (!frame) return
      cancelMove.current()
      setViewport(fitFrame(frame, window.innerWidth, window.innerHeight))
      settle()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [frame, setViewport, settle])

  // autoplay: the progress bar and the timer of the current slide
  useEffect(() => {
    const fill = bar.current
    const paint = (p: number) => {
      if (fill) fill.style.transform = `scaleX(${p})`
    }
    paint(0)
    if (!playing || !frame) return
    const duration = slideDuration(frame, seconds)
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = slideProgress(now - start, duration)
      paint(p)
      if (p >= 1) {
        const next = nextAutoplay(index, count, loop)
        if (next === null) setPlaying(false)
        else if (next === index) setCycle((c) => c + 1)
        else setIndex(next)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, frame, index, count, loop, seconds, cycle, setIndex])

  const go = (target: number) => {
    setIndex(Math.max(0, Math.min(count - 1, target)))
    setCycle((c) => c + 1)
  }
  const step = (n: number) => go(stepSlide(index, count, n))

  // the control bar fades after a while without mouse movement
  const wake = () => {
    setVisible(true)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setVisible(false), BAR_IDLE_MS)
  }
  useEffect(() => {
    wake()
    window.addEventListener('mousemove', wake)
    return () => {
      window.removeEventListener('mousemove', wake)
      window.clearTimeout(idleTimer.current)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        end()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      let handled = true
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          step(1)
          break
        case 'ArrowLeft':
        case 'PageUp':
          step(-1)
          break
        case 'Home':
          go(0)
          break
        case 'End':
          go(count - 1)
          break
        case 'p':
        case 'P':
          setPlaying((v) => !v)
          break
        default:
          handled = false
      }
      if (!handled) return
      e.preventDefault()
      e.stopPropagation()
      // a focused button must not also activate on Space
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur()
      wake()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count, end])

  const commitSeconds = () => {
    const value = parseSeconds(secondsText)
    if (value !== null) {
      setSeconds(value)
      saveSlideSeconds(value)
    }
    setSecondsText(String(value ?? seconds))
  }

  return (
    <div className="presentation" data-idle={!visible} onClick={(e) => e.target === e.currentTarget && step(1)}>
      <div className="present-progress" aria-hidden="true">
        <div ref={bar} className="present-progress-fill" />
      </div>
      <div className="panel present-bar" role="toolbar" aria-label="Controles de presentación" data-hidden={!visible}>
        <button type="button" className="icon-btn" aria-label="Anterior" data-tip="Anterior" disabled={index === 0} onClick={() => step(-1)}>
          <PrevIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={playing ? 'Pausa' : 'Reproducir'}
          data-tip={playing ? 'Pausa (P)' : 'Reproducir (P)'}
          onClick={() => setPlaying((v) => !v)}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" className="icon-btn" aria-label="Siguiente" data-tip="Siguiente" disabled={index >= count - 1} onClick={() => step(1)}>
          <NextIcon />
        </button>
        <output className="present-counter" aria-live="polite">
          {Math.min(index, count - 1) + 1} / {count}
        </output>
        <span className="present-sep" aria-hidden="true" />
        <label className="present-seconds">
          <input
            className="text-input"
            inputMode="decimal"
            aria-label="Segundos por diapositiva"
            data-tip="Segundos por diapositiva"
            value={secondsText}
            onChange={(e) => setSecondsText(e.target.value)}
            onBlur={commitSeconds}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <span>s</span>
        </label>
        <button
          type="button"
          className="icon-btn"
          aria-label="Repetir"
          aria-pressed={loop}
          data-tip="Repetir"
          onClick={() => {
            setLoop(!loop)
            saveSlideLoop(!loop)
          }}
        >
          <RepeatIcon />
        </button>
        <TransitionToggle
          value={transition}
          onChange={(v) => {
            setTransition(v)
            saveSlideTransition(v)
          }}
        />
        <span className="present-sep" aria-hidden="true" />
        <button type="button" className="icon-btn" aria-label="Salir" data-tip="Salir (Esc)" onClick={end}>
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
