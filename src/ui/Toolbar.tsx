import type { ReactNode } from 'react'
import { useStore } from '../scene/store'
import type { Tool } from '../scene/store'
import {
  ArrowIcon,
  DiamondIcon,
  EllipseIcon,
  EraserIcon,
  PencilIcon,
  HandIcon,
  LineIcon,
  RectangleIcon,
  SelectionIcon,
  TextIcon,
} from './icons'
import { getShortcut } from './shortcuts'
import { KeyHint, tip, tipName } from './Tooltip'
import { pickImages } from '../scene/actions'
import { FrameIcon, ImageIcon, LibraryIcon, SlidesIcon } from './iconsExtra'

const TOOLS: { tool: Tool; icon: ReactNode }[] = [
  { tool: 'selection', icon: <SelectionIcon /> },
  { tool: 'hand', icon: <HandIcon /> },
  { tool: 'rectangle', icon: <RectangleIcon /> },
  { tool: 'ellipse', icon: <EllipseIcon /> },
  { tool: 'diamond', icon: <DiamondIcon /> },
  { tool: 'arrow', icon: <ArrowIcon /> },
  { tool: 'line', icon: <LineIcon /> },
  { tool: 'text', icon: <TextIcon /> },
  { tool: 'freedraw', icon: <PencilIcon /> },
  { tool: 'eraser', icon: <EraserIcon /> },
  { tool: 'frame', icon: <FrameIcon /> },
  { tool: 'image', icon: <ImageIcon /> },
]

export function Toolbar() {
  const current = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const libraryOpen = useStore((s) => s.libraryOpen)
  const toggleLibrary = useStore((s) => s.toggleLibrary)
  const slidesOpen = useStore((s) => s.slidesOpen)
  const toggleSlides = useStore((s) => s.toggleSlides)

  return (
    <div className="panel toolbar" role="toolbar" aria-label="Herramientas">
      {TOOLS.map(({ tool, icon }) => {
        const id = `tool.${tool}`
        return (
          <button
            key={tool}
            type="button"
            className="icon-btn"
            aria-pressed={current === tool}
            aria-label={getShortcut(id).label}
            {...tip(id)}
            onClick={() => (tool === 'image' ? pickImages() : setTool(tool))}
          >
            {icon}
            <KeyHint id={id} />
          </button>
        )
      })}
      <span className="toolbar-sep" aria-hidden="true" />
      <button
        type="button"
        className="icon-btn"
        aria-pressed={libraryOpen}
        aria-label="Biblioteca"
        {...tipName('Biblioteca')}
        onClick={toggleLibrary}
      >
        <LibraryIcon />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-pressed={slidesOpen}
        aria-label="Diapositivas"
        {...tip('view.slides')}
        onClick={toggleSlides}
      >
        <SlidesIcon />
      </button>
    </div>
  )
}
