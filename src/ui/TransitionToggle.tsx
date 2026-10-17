import type { ReactNode } from 'react'
import type { SlideTransition } from '../scene/slides'
import { TransitionPanIcon, TransitionZoomIcon } from './iconsExtra'

const OPTIONS: { value: SlideTransition; label: string; icon: ReactNode }[] = [
  { value: 'pan', label: 'Desplazar', icon: <TransitionPanIcon /> },
  { value: 'zoom', label: 'Zoom', icon: <TransitionZoomIcon /> },
]

/** Two-option segmented choice of the transition between slides. */
export function TransitionToggle({ value, onChange }: { value: SlideTransition; onChange: (v: SlideTransition) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Transición">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className="icon-btn small"
          aria-pressed={value === o.value}
          aria-label={o.label}
          data-tip={o.label}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}
