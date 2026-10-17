import { useEffect, useState } from 'react'
import { useStore } from '../scene/store'
import { fitViewportToBounds } from '../scene/viewport'
import { loadSlideSeconds, loadSlideTransition, saveSlideTransition } from '../scene/slideSettings'
import type { SlideTransition } from '../scene/slides'
import { TransitionToggle } from './TransitionToggle'
import { ownDuration, parseSeconds, slideFrames, slideName } from '../scene/slides'
import type { FrameElement } from '../element/types'
import { CloseIcon } from './icons'
import { ArrowDownIcon, ArrowUpIcon, PlayIcon } from './iconsExtra'

function DurationInput({ frame, label, fallback }: { frame: FrameElement; label: string; fallback: number }) {
  const setDuration = useStore((s) => s.setSlideDuration)
  const own = ownDuration(frame)
  const [text, setText] = useState(own === null ? '' : String(own))
  useEffect(() => setText(own === null ? '' : String(own)), [own])
  const commit = () => {
    const value = parseSeconds(text)
    // invalid text never clears the saved duration: the field goes back to the stored value
    if (value === null && text.trim() !== '') {
      setText(own === null ? '' : String(own))
      return
    }
    setDuration(frame.id, value)
    setText(value === null ? '' : String(value))
  }
  return (
    <label className="slide-duration">
      <span>Duración</span>
      <input
        className="text-input"
        inputMode="decimal"
        aria-label={`Duración en segundos de ${label}`}
        placeholder={String(fallback)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      <span>s</span>
    </label>
  )
}

export function SlidesPanel() {
  const open = useStore((s) => s.slidesOpen)
  const elements = useStore((s) => s.elements)
  const toggle = useStore((s) => s.toggleSlides)
  const reorder = useStore((s) => s.reorderSlide)
  const present = useStore((s) => s.startPresentation)
  const setViewport = useStore((s) => s.setViewport)
  const [transition, setTransition] = useState<SlideTransition>(loadSlideTransition)
  if (!open) return null

  const slides = slideFrames(elements)
  const fallback = loadSlideSeconds()
  const zoomTo = (f: FrameElement) =>
    setViewport(fitViewportToBounds([f.x, f.y, f.x + f.width, f.y + f.height], window.innerWidth, window.innerHeight))

  return (
    <aside className="panel library-panel slides-panel" aria-label="Diapositivas">
      <header className="library-head">
        <h2>Diapositivas</h2>
        <button type="button" className="icon-btn small" aria-label="Cerrar diapositivas" onClick={toggle}>
          <CloseIcon />
        </button>
      </header>
      <button type="button" className="btn btn-primary small" aria-label="Presentar" onClick={() => present(0)}>
        <PlayIcon /> Presentar
      </button>
      <div className="slide-transition">
        <span>Transición</span>
        <TransitionToggle
          value={transition}
          onChange={(v) => {
            setTransition(v)
            saveSlideTransition(v)
          }}
        />
      </div>
      {slides.length === 0 ? (
        <p className="library-empty">Los marcos (herramienta F) definen las diapositivas. Dibuja uno o más marcos para empezar.</p>
      ) : (
        <ol className="slide-list">
          {slides.map((f, i) => (
            <li key={f.id} className="slide-item">
              <div className="slide-row">
                <span className="slide-num" aria-hidden="true">
                  {i + 1}
                </span>
                <button
                  type="button"
                  className="slide-name"
                  data-tip="Ir a la diapositiva"
                  aria-label={`Ir a ${slideName(f, i)}`}
                  onClick={() => zoomTo(f)}
                >
                  {slideName(f, i)}
                </button>
                <button
                  type="button"
                  className="icon-btn small"
                  aria-label={`Subir ${slideName(f, i)}`}
                  data-tip="Subir"
                  disabled={i === 0}
                  onClick={() => reorder(f.id, -1)}
                >
                  <ArrowUpIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn small"
                  aria-label={`Bajar ${slideName(f, i)}`}
                  data-tip="Bajar"
                  disabled={i === slides.length - 1}
                  onClick={() => reorder(f.id, 1)}
                >
                  <ArrowDownIcon />
                </button>
              </div>
              <div className="slide-row slide-row-sub">
                <DurationInput frame={f} label={slideName(f, i)} fallback={fallback} />
                <button
                  type="button"
                  className="icon-btn small"
                  aria-label={`Presentar desde ${slideName(f, i)}`}
                  data-tip="Presentar desde aquí"
                  onClick={() => present(i)}
                >
                  <PlayIcon />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
