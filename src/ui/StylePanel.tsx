import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '../scene/store'
import type { LinearElement, SceneElement, TextElement } from '../element/types'
import { isLinear, isRenderable, isShape, isText } from '../element/types'
import { curveOf } from '../element/style'
import type { Curve, Edges, StyleDefaults } from '../element/style'
import type { FillStyle, StrokeStyle } from '../element/types'
import { TextAlignIcon, CurveIcon, DashIcon, EdgeIcon, FillIcon, HeadIcon, RoughIcon, WidthIcon, ChevronIcon } from './icons'
import { normalizeArrowhead } from '../element/arrowhead'
import { Popover } from './Popover'

const STROKES = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#6741d9']
const BACKGROUNDS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#d0bfff']
const HEX = /^#[0-9a-f]{6}$/i
const SECTIONS_KEY = 'jaradraw:panel'

const HEAD_LABELS: Record<string, string> = {
  none: 'Sin punta',
  arrow: 'Flecha',
  triangle: 'Triángulo',
  bar: 'Barra',
  circle: 'Círculo',
  diamond: 'Rombo',
}

/** The shared value of a property: the value, or null when elements disagree. */
function common<T>(values: T[]): T | null {
  if (values.length === 0) return null
  return values.every((v) => v === values[0]) ? values[0] : null
}

function readSections(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => readSections()[id] !== false)
  const body = useId()
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ...readSections(), [id]: next }))
    } catch {
      // storage unavailable: the state just is not remembered
    }
  }
  return (
    <section className="style-section">
      <h3 className="section-title">
        <button type="button" className="section-head" aria-expanded={open} aria-controls={body} onClick={toggle}>
          <span className={`section-chevron${open ? ' open' : ''}`}>
            <ChevronIcon />
          </span>
          {title}
        </button>
      </h3>
      <div id={body} className="section-body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}

function Row({ label, labelId, mixed, children }: { label: string; labelId?: string; mixed?: boolean; children: ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-label" id={labelId}>
        {label}
        {mixed && <span className="mixed" title="Valores distintos"> *</span>}
      </span>
      <div className="prop-control">{children}</div>
    </div>
  )
}

interface ColorRowProps {
  label: string
  value: string | null
  presets: string[]
  onChange: (color: string) => void
}

function ColorRow({ label, value, presets, onChange }: ColorRowProps) {
  const id = useId()
  const isHex = value !== null && HEX.test(value)
  const customActive = isHex && !presets.includes(value.toLowerCase())
  return (
    <Row label={label} labelId={id} mixed={value === null}>
      <div className="swatches" role="group" aria-labelledby={id}>
        {presets.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${c === 'transparent' ? ' swatch-none' : ''}`}
            style={c === 'transparent' ? undefined : { backgroundColor: c }}
            aria-pressed={value !== null && value.toLowerCase() === c}
            aria-label={c === 'transparent' ? 'Transparente' : c}
            data-tip={c === 'transparent' ? 'Transparente' : c}
            onClick={() => onChange(c)}
          />
        ))}
        <label
          className={`swatch swatch-custom${customActive ? ' active' : ''}`}
          style={customActive ? { backgroundColor: value } : undefined}
          data-tip="Color personalizado"
        >
          <input
            type="color"
            value={isHex ? value : '#ffffff'}
            aria-label={`${label}: color personalizado`}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      </div>
    </Row>
  )
}

interface SegmentedProps<T extends string | number> {
  label: string
  value: T | null
  options: { value: T; label: string; icon: ReactNode }[]
  onChange: (v: T) => void
}

function Segmented<T extends string | number>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <Row label={label} mixed={value === null}>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
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
    </Row>
  )
}

function HeadPicker({ label, value, flip, onChange }: { label: string; value: string | null; flip: boolean; onChange: (v: string) => void }) {
  return (
    <Popover
      label={label}
      className="head-picker"
      triggerClass="head-btn"
      trigger={
        <>
          <span className="head-btn-label">{label}</span>
          <HeadIcon kind={value ?? 'none'} flip={flip} />
          <ChevronIcon />
        </>
      }
    >
      {(close) => (
        <div className="popover-grid">
          {Object.keys(HEAD_LABELS).map((k) => (
            <button
              key={k}
              type="button"
              className="icon-btn small"
              aria-pressed={value === k}
              aria-label={HEAD_LABELS[k]}
              data-tip={HEAD_LABELS[k]}
              onClick={() => {
                onChange(k)
                close()
              }}
            >
              <HeadIcon kind={k} flip={flip} />
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}

export function StylePanel() {
  const tool = useStore((s) => s.tool)
  const elements = useStore((s) => s.elements)
  const selectedIds = useStore((s) => s.selectedIds)
  const defaults = useStore((s) => s.defaults)
  const applyStyle = useStore((s) => s.applyStyle)

  const selected = useMemo(() => {
    const ids = new Set(selectedIds)
    return elements.filter((e) => ids.has(e.id) && !e.isDeleted && isRenderable(e))
  }, [elements, selectedIds])

  const textTargets = useMemo(() => {
    const ids = new Set(selected.map((e) => e.id))
    return elements.filter(
      (e): e is TextElement =>
        !e.isDeleted && isText(e) && (ids.has(e.id) || (e.containerId != null && ids.has(e.containerId))),
    )
  }, [elements, selected])

  const drawing = tool !== 'selection' && tool !== 'hand' && tool !== 'eraser'
  if (selected.length === 0 && !drawing) return null
  if (selected.length > 0 && selected.some((e) => e.locked)) return null

  const types = selected.length ? selected.map((e) => e.type) : [tool as string]
  const has = (...ts: string[]) => types.some((t) => ts.includes(t))
  const showStroke = has('rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'freedraw', 'text')
  const showFill = has('rectangle', 'ellipse', 'diamond')
  const showWidth = has('rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'freedraw')
  const showRough = has('rectangle', 'ellipse', 'diamond', 'line', 'arrow')
  const showEdges = has('rectangle', 'diamond')
  const showCurve = has('line', 'arrow')
  const showHeads = has('arrow')
  const showText = textTargets.length > 0 || (selected.length === 0 && tool === 'text')

  // Value for a property: shared among the relevant selected elements, else the defaults.
  function pick<T>(applies: (e: SceneElement) => boolean, get: (e: SceneElement) => T, fallback: T): T | null {
    if (selected.length === 0) return fallback
    return common(selected.filter(applies).map(get))
  }
  const all = () => true
  const stroke = pick(all, (e) => e.strokeColor, defaults.strokeColor)
  const background = pick(isShape, (e) => e.backgroundColor, defaults.backgroundColor)
  const width = pick((e) => !isText(e), (e) => e.strokeWidth, defaults.strokeWidth)
  const dash = pick((e) => !isText(e), (e) => e.strokeStyle, defaults.strokeStyle)
  const fill = pick(isShape, (e) => e.fillStyle, defaults.fillStyle)
  const rough = pick((e) => !isText(e), (e) => e.roughness, defaults.roughness)
  const edges = pick(
    (e) => e.type === 'rectangle' || e.type === 'diamond',
    (e) => (e.roundness ? 'round' : 'sharp') as Edges,
    defaults.edges,
  )
  const showElbow = has('arrow')
  const curveValue = pick(isLinear, (e) => curveOf(e as LinearElement), defaults.curve)
  const curve = curveValue === 'elbow' && !showElbow ? 'sharp' : curveValue
  const isArrow = (e: SceneElement) => e.type === 'arrow'
  const headOf = (key: 'startArrowhead' | 'endArrowhead') => (e: SceneElement) =>
    normalizeArrowhead((e as unknown as Record<string, unknown>)[key]) ?? 'none'
  const startHead = pick(isArrow, headOf('startArrowhead'), normalizeArrowhead(defaults.startArrowhead) ?? 'none')
  const endHead = pick(isArrow, headOf('endArrowhead'), normalizeArrowhead(defaults.endArrowhead) ?? 'none')
  const fontSize = textTargets.length ? common(textTargets.map((t) => t.fontSize)) : defaults.fontSize
  const textAlign = textTargets.length ? common(textTargets.map((t) => t.textAlign)) : defaults.textAlign
  const opacity = pick(all, (e) => e.opacity, defaults.opacity)

  const set = (patch: Partial<StyleDefaults>) => applyStyle(patch)
  const showTrazo = showWidth || showRough || showEdges || showCurve

  return (
    <aside className={`panel style-panel${selected.length > 0 ? ' with-bar' : ''}`} aria-label="Estilo">
      <Section id="color" title="Color">
        {showStroke && <ColorRow label="Trazo" value={stroke} presets={STROKES} onChange={(c) => set({ strokeColor: c })} />}
        {showFill && (
          <ColorRow label="Fondo" value={background} presets={BACKGROUNDS} onChange={(c) => set({ backgroundColor: c })} />
        )}
        {showFill && (
          <Segmented<FillStyle>
            label="Relleno"
            value={fill}
            onChange={(v) => set({ fillStyle: v })}
            options={[
              { value: 'solid', label: 'Sólido', icon: <FillIcon kind="solid" /> },
              { value: 'hachure', label: 'Rayado', icon: <FillIcon kind="hachure" /> },
              { value: 'cross-hatch', label: 'Cuadriculado', icon: <FillIcon kind="cross-hatch" /> },
            ]}
          />
        )}
        <Row label={`Opacidad`} mixed={opacity === null}>
          <div className="opacity-control">
            <input
              id="opacity-range"
              className="range"
              type="range"
              min={0}
              max={100}
              step={5}
              aria-label="Opacidad"
              value={opacity ?? 100}
              onChange={(e) => set({ opacity: Number(e.target.value) })}
            />
            <output className="opacity-value" htmlFor="opacity-range">
              {opacity === null ? '--' : `${opacity}%`}
            </output>
          </div>
        </Row>
      </Section>
      {showTrazo && (
        <Section id="trazo" title="Trazo">
          {showWidth && (
            <Segmented<number>
              label="Grosor"
              value={width}
              onChange={(v) => set({ strokeWidth: v })}
              options={[
                { value: 1, label: 'Fino', icon: <WidthIcon w={1} /> },
                { value: 2, label: 'Medio', icon: <WidthIcon w={2} /> },
                { value: 4, label: 'Grueso', icon: <WidthIcon w={4} /> },
              ]}
            />
          )}
          {showRough && (
            <Segmented<StrokeStyle>
              label="Estilo"
              value={dash}
              onChange={(v) => set({ strokeStyle: v })}
              options={[
                { value: 'solid', label: 'Continuo', icon: <DashIcon style="solid" /> },
                { value: 'dashed', label: 'Guiones', icon: <DashIcon style="dashed" /> },
                { value: 'dotted', label: 'Puntos', icon: <DashIcon style="dotted" /> },
              ]}
            />
          )}
          {showRough && (
            <Segmented<number>
              label="Mano alzada"
              value={rough}
              onChange={(v) => set({ roughness: v })}
              options={[
                { value: 0, label: 'Preciso', icon: <RoughIcon level={0} /> },
                { value: 1, label: 'Artista', icon: <RoughIcon level={1} /> },
                { value: 2, label: 'Caricaturista', icon: <RoughIcon level={2} /> },
              ]}
            />
          )}
          {showEdges && (
            <Segmented<Edges>
              label="Bordes"
              value={edges}
              onChange={(v) => set({ edges: v })}
              options={[
                { value: 'sharp', label: 'Rectos', icon: <EdgeIcon round={false} /> },
                { value: 'round', label: 'Redondeados', icon: <EdgeIcon round /> },
              ]}
            />
          )}
          {showCurve && (
            <Segmented<Curve>
              label="Trazado"
              value={curve}
              onChange={(v) => set({ curve: v })}
              options={[
                { value: 'sharp', label: 'Recto', icon: <CurveIcon curved={false} /> },
                { value: 'curved', label: 'Curvo', icon: <CurveIcon curved /> },
                ...(showElbow ? [{ value: 'elbow' as const, label: 'Codo', icon: <CurveIcon curved={false} elbow /> }] : []),
              ]}
            />
          )}
        </Section>
      )}
      {showText && (
        <Section id="texto" title="Texto">
          <Segmented<number>
            label="Tamaño"
            value={fontSize}
            onChange={(v) => set({ fontSize: v })}
            options={[
              { value: 16, label: 'Pequeño', icon: <span className="size-label">S</span> },
              { value: 20, label: 'Mediano', icon: <span className="size-label">M</span> },
              { value: 28, label: 'Grande', icon: <span className="size-label">L</span> },
              { value: 36, label: 'Muy grande', icon: <span className="size-label">XL</span> },
            ]}
          />
          <Segmented<TextElement['textAlign']>
            label="Alineación"
            value={textAlign}
            onChange={(v) => set({ textAlign: v })}
            options={[
              { value: 'left', label: 'Izquierda', icon: <TextAlignIcon kind="left" /> },
              { value: 'center', label: 'Centro', icon: <TextAlignIcon kind="center" /> },
              { value: 'right', label: 'Derecha', icon: <TextAlignIcon kind="right" /> },
            ]}
          />
        </Section>
      )}
      {showHeads && (
        <Section id="flecha" title="Flecha">
          <div className="prop-row heads">
            <HeadPicker label="Inicio" value={startHead} flip onChange={(v) => set({ startArrowhead: v === 'none' ? null : v })} />
            <HeadPicker label="Fin" value={endHead} flip={false} onChange={(v) => set({ endArrowhead: v === 'none' ? null : v })} />
          </div>
        </Section>
      )}
    </aside>
  )
}
