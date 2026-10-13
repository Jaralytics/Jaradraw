import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getShortcut, hintFor, primaryChips } from './shortcuts'

const SHOW_DELAY_MS = 300
const GAP = 8
const MARGIN = 8
const TOOLTIP_ID = 'app-tooltip'

/** Key chips; the single rendering of shortcut keys (tooltip, menus, shortcuts modal). */
export function Keys({ chips }: { chips: readonly string[] }) {
  return (
    <span className="keys">
      {chips.map((c, i) => (
        <kbd key={i}>{c}</kbd>
      ))}
    </span>
  )
}

/** Props that attach the custom tooltip to a control; name and keys come from the shortcut registry. */
export function tip(id: string, label?: string): { 'data-tip': string; 'data-tip-id': string } {
  return { 'data-tip': label ?? getShortcut(id).label, 'data-tip-id': id }
}

/** Tooltip without a registered shortcut. */
export function tipName(name: string): { 'data-tip': string } {
  return { 'data-tip': name }
}

/** Corner hint for single-key controls. */
export function KeyHint({ id }: { id: string }) {
  return (
    <span className="key-hint" aria-hidden="true">
      {hintFor(id)}
    </span>
  )
}

interface Active {
  el: HTMLElement
  name: string
  chips: string[]
}

function read(el: Element): Active | null {
  const host = el.closest<HTMLElement>('[data-tip]')
  if (!host) return null
  const id = host.dataset.tipId
  let chips: string[] = []
  if (id) {
    try {
      chips = primaryChips(id)
    } catch {
      chips = []
    }
  }
  return { el: host, name: host.dataset.tip ?? '', chips }
}

/** One tooltip for the whole app: hover after a short delay, immediate on keyboard focus. */
export function TooltipLayer() {
  const [active, setActive] = useState<Active | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const hide = () => {
      clearTimeout(timer.current)
      if (current.current) current.current.removeAttribute('aria-describedby')
      current.current = null
      setActive(null)
    }
    const show = (a: Active) => {
      if (current.current && current.current !== a.el) current.current.removeAttribute('aria-describedby')
      current.current = a.el
      a.el.setAttribute('aria-describedby', TOOLTIP_ID)
      setActive(a)
    }
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || !(e.target instanceof Element)) return
      const a = read(e.target)
      if (!a) {
        hide()
        return
      }
      if (a.el === current.current) return
      hide()
      timer.current = setTimeout(() => show(a), SHOW_DELAY_MS)
    }
    const onOut = (e: PointerEvent) => {
      const to = e.relatedTarget
      if (to instanceof Node && current.current?.contains(to)) return
      hide()
    }
    const onFocusIn = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLElement) || !e.target.matches(':focus-visible')) return
      const a = read(e.target)
      if (a) {
        clearTimeout(timer.current)
        show(a)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  useLayoutEffect(() => {
    const t = box.current
    if (!active || !t) return
    const r = active.el.getBoundingClientRect()
    const w = t.offsetWidth
    const h = t.offsetHeight
    const left = Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, r.left + r.width / 2 - w / 2))
    const below = r.bottom + GAP
    const top = below + h + MARGIN <= window.innerHeight ? below : Math.max(MARGIN, r.top - GAP - h)
    t.style.left = `${left}px`
    t.style.top = `${top}px`
  }, [active])

  if (!active) return null
  return (
    <div ref={box} id={TOOLTIP_ID} role="tooltip" className="tooltip">
      <span>{active.name}</span>
      {active.chips.length > 0 && <Keys chips={active.chips} />}
    </div>
  )
}
