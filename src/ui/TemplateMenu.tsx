import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { loadTemplate } from '../scene/actions'
import { useStore } from '../scene/store'
import { templatePreview } from './templatePreview'
import { TEMPLATES } from '../scene/templates'
import { ChevronIcon, TemplateIcon } from './icons'

export function TemplateMenu() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const dark = useStore((s) => s.dark)
  const preview = (id: string) => templatePreview(id, dark)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const i = Math.max(items.indexOf(document.activeElement as HTMLElement), 0)
    const menu = root.current?.querySelector('.menu')
    const cols = menu ? Math.max(getComputedStyle(menu).gridTemplateColumns.split(' ').length, 1) : 1
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : Math.min(Math.max(i + step[e.key], 0), items.length - 1)
    items[next].focus()
  }

  return (
    <div className="template-area" ref={root} onKeyDown={onKeyDown}>
      <div className="panel-inline">
        <button
          ref={button}
          type="button"
          className="menu-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Plantillas"
          data-tip="Plantillas"
          onClick={() => setOpen((v) => !v)}
        >
          <TemplateIcon />
          <span className="menu-btn-text">Plantillas</span>
          <ChevronIcon />
        </button>
        {open && (
          <div className="menu" role="menu" aria-label="Plantillas">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className="menu-item template-item"
                onClick={() => {
                  setOpen(false)
                  loadTemplate(t.id)
                }}
              >
                <span className="template-thumb" aria-hidden="true">
                  {preview(t.id) && <img src={preview(t.id) ?? ''} alt="" draggable={false} />}
                </span>
                <span className="template-text">
                  <span className="template-name">{t.name}</span>
                  <span className="template-desc">{t.description}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
