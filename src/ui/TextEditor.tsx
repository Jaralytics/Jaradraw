import { useEffect, useRef } from 'react'
import { useStore } from '../scene/store'
import { sceneToScreen } from '../scene/viewport'
import { fontStack, measureText, wrapText } from '../element/text'
import { transformColor } from '../render/color'

export function TextEditor() {
  const ed = useStore((s) => s.textEditor)
  const viewport = useStore((s) => s.viewport)
  const background = useStore((s) => s.appState.viewBackgroundColor)
  const dark = useStore((s) => s.dark)
  const setEditorText = useStore((s) => s.setEditorText)
  const commit = useStore((s) => s.commitTextEditor)
  const ref = useRef<HTMLTextAreaElement>(null)
  const editingId = ed?.id

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editingId])

  if (!ed) return null
  const col = dark ? transformColor : (c: string) => c

  const pos = sceneToScreen(viewport, ed.x, ed.y)
  const z = viewport.zoom
  const bound = ed.containerId !== null
  const shown = bound ? wrapText(ed.text || ' ', ed.wrapWidth, ed.fontSize, ed.fontFamily) : ed.text || ' '
  const size = measureText(shown, ed.fontSize, ed.fontFamily, ed.lineHeight)
  const lines = ed.text.split('\n').length
  const font = `${ed.fontSize * z}px/${ed.lineHeight} ${fontStack(ed.fontFamily)}`

  const style = bound
    ? {
        left: pos.x - (ed.wrapWidth * z) / 2,
        top: pos.y - (size.height * z) / 2,
        width: ed.wrapWidth * z,
        height: size.height * z,
        textAlign: 'center' as const,
        transform: ed.angle ? `rotate(${ed.angle}rad)` : undefined,
        background: ed.opaque ? col(background) : 'transparent',
        font,
        color: col(ed.strokeColor),
      }
    : {
        left: pos.x,
        top: pos.y,
        width: (size.width + ed.fontSize) * z,
        height: size.height * z,
        textAlign: ed.textAlign,
        transform: ed.angle ? `rotate(${ed.angle}rad)` : undefined,
        transformOrigin: `${(size.width * z) / 2}px ${(size.height * z) / 2}px`,
        font,
        color: col(ed.strokeColor),
      }

  return (
    <textarea
      ref={ref}
      className={bound ? 'text-editor bound' : 'text-editor'}
      aria-label={bound ? 'Editar etiqueta' : 'Editar texto'}
      value={ed.text}
      spellCheck={false}
      wrap={bound ? 'soft' : 'off'}
      rows={bound ? undefined : lines}
      onChange={(e) => setEditorText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault()
          e.stopPropagation()
          commit()
        }
      }}
      style={style}
    />
  )
}
