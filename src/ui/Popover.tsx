import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

interface Props {
  /** Accessible name of the trigger and of the popover. */
  label: string
  trigger: ReactNode
  children: (close: () => void) => ReactNode
  className?: string
  triggerClass?: string
  disabled?: boolean
}

/** Small popover: closes on Escape (returning focus to the trigger), outside click and selection. */
export function Popover({ label, trigger, children, className = '', triggerClass = 'icon-btn small', disabled }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    root.current
      ?.querySelector<HTMLElement>('.popover [aria-pressed="true"], .popover button:not(:disabled)')
      ?.focus()
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    button.current?.focus()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  return (
    <div className={`popover-wrap ${className}`} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={triggerClass}
        aria-label={label}
        data-tip={label}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <div className="popover" role="group" aria-label={label}>
          {children(close)}
        </div>
      )}
    </div>
  )
}
