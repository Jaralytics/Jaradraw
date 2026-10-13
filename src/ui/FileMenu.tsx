import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useStore } from '../scene/store'
import { ChevronIcon, FileIcon } from './icons'
import { chipsOf, getShortcut, runShortcut } from './shortcuts'
import { Keys } from './Tooltip'
import type { ThemePref } from '../scene/theme'

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Tema claro' },
  { value: 'dark', label: 'Tema oscuro' },
  { value: 'system', label: 'Tema del sistema' },
]

const ITEMS = ['file.open', 'file.save', 'file.saveAs', 'file.export']

export function FileMenu() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const fileName = useStore((s) => s.fileName)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const empty = useStore((s) => s.elements.every((e) => e.isDeleted))

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [open])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (items.length === 0) return
    e.preventDefault()
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
  }

  return (
    <div className="file-area" ref={root} onKeyDown={onKeyDown}>
      {fileName && (
        <span className="file-name" title={fileName}>
          {fileName}
        </span>
      )}
      <div className="panel-inline">
        <button
          ref={button}
          type="button"
          className="menu-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Archivo"
          data-tip="Archivo"
          onClick={() => setOpen((v) => !v)}
        >
          <FileIcon />
          <span className="menu-btn-text">Archivo</span>
          <ChevronIcon />
        </button>
        {open && (
          <div className="menu" role="menu" aria-label="Archivo">
            {ITEMS.map((id) => {
              const s = getShortcut(id)
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  disabled={id === 'file.export' && empty}
                  onClick={() => {
                    setOpen(false)
                    runShortcut(id)
                  }}
                >
                  <span>{s.label}</span>
                  <Keys chips={chipsOf(s)[0] ?? []} />
                </button>
              )
            })}
            <div className="menu-sep" role="separator" />
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="menuitemradio"
                aria-checked={theme === t.value}
                className="menu-item"
                onClick={() => setTheme(t.value)}
              >
                <span>{t.label}</span>
                {theme === t.value && <span className="menu-check">Activo</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
