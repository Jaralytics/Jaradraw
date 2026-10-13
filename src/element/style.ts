import type { LinearElement, Roundness, SceneElement, TextElement } from './types'
import { measureText } from './text'
import { isRenderable, isShape, isLinear, isText } from './types'
import { DEFAULT_STYLE, updateElement } from './factory'
import type { StyleProps } from './factory'

export type Edges = 'sharp' | 'round'

export type Curve = 'sharp' | 'curved' | 'elbow'

export interface StyleDefaults extends StyleProps {
  edges: Edges
  curve: Curve
  startArrowhead: string | null
  endArrowhead: string | null
  fontSize: number
  textAlign: 'left' | 'center' | 'right'
}

export const FONT_SIZES = { S: 16, M: 20, L: 28, XL: 36 } as const

export type StylePatch = Partial<StyleDefaults>

export const DEFAULT_STYLE_DEFAULTS: StyleDefaults = {
  ...DEFAULT_STYLE,
  edges: 'sharp',
  curve: 'sharp',
  startArrowhead: null,
  endArrowhead: 'arrow',
  fontSize: 20,
  textAlign: 'left',
}

/** Roundness value for an element type, or undefined when edges do not apply to it. */
export function roundnessFor(type: string, edges: Edges): Roundness | undefined {
  switch (type) {
    case 'rectangle':
      return edges === 'round' ? { type: 3 } : null
    case 'diamond':
    case 'line':
    case 'arrow':
      return edges === 'round' ? { type: 2 } : null
    default:
      return undefined
  }
}

/** Style props to pass to the element factory for a new element of `type`. */
export function styleForNew(
  d: StyleDefaults,
  type: string,
): Partial<StyleProps> & {
  roundness?: Roundness
  startArrowhead?: string | null
  endArrowhead?: string | null
  elbowed?: boolean
} {
  const { edges, curve, startArrowhead, endArrowhead, fontSize: _fs, textAlign: _ta, ...style } = d
  const linear = type === 'line' || type === 'arrow'
  const roundness = roundnessFor(type, linear ? (curve === 'curved' ? 'round' : 'sharp') : edges)
  const out: ReturnType<typeof styleForNew> = roundness === undefined ? style : { ...style, roundness }
  if (type === 'arrow') return { ...out, startArrowhead, endArrowhead, ...(curve === 'elbow' ? { elbowed: true } : {}) }
  return out
}

/** Curve option an element currently shows: elbow arrows read as 'elbow'. */
export function curveOf(el: LinearElement): Curve {
  if (el.elbowed === true) return 'elbow'
  return el.roundness ? 'curved' : 'sharp'
}

/** Patch that applies a curve option to a linear element; lines never elbow. */
function curvePatch(el: LinearElement, curve: Curve): Record<string, unknown> {
  if (curve === 'elbow' && el.type === 'arrow') return el.elbowed === true ? {} : { elbowed: true, roundness: null }
  const patch: Record<string, unknown> = { roundness: roundnessFor(el.type, curve === 'curved' ? 'round' : 'sharp') }
  if (el.elbowed === true) {
    patch.elbowed = false
    patch.fixedSegments = null
    patch.startIsSpecial = null
    patch.endIsSpecial = null
    // a curve keeps the corners as its control points; a straight arrow collapses to its two ends
    if (curve !== 'curved') {
      const last = el.points[el.points.length - 1]
      patch.points = [el.points[0], last]
      patch.width = Math.abs(last[0] - el.points[0][0])
      patch.height = Math.abs(last[1] - el.points[0][1])
    }
  }
  return patch
}

/** Corner radius in scene units for rectangles and diamonds (0 when sharp). */
export function cornerRadius(el: { roundness: Roundness; width: number; height: number }): number {
  const rd = el.roundness
  if (!rd) return 0
  const m = Math.min(el.width, el.height)
  if (rd.type === 3) {
    if (rd.value !== undefined) return Math.min(rd.value, m / 2)
    return m <= 128 ? m * 0.25 : 32
  }
  return m * (rd.value ?? 0.25)
}

const COMMON_KEYS = ['strokeColor', 'opacity'] as const
const LINE_KEYS = ['strokeWidth', 'strokeStyle', 'roughness'] as const
const FILL_KEYS = ['backgroundColor', 'fillStyle'] as const

/**
 * Re-measures a free text after a text, font size or alignment change. The anchor follows the
 * alignment (left edge, center or right edge stays); rotated texts keep their box center.
 */
export function reflowText(
  el: TextElement,
  change: Partial<Pick<TextElement, 'text' | 'originalText' | 'fontSize' | 'textAlign'>>,
): TextElement {
  const next = { ...el, ...change }
  const size = measureText(next.text, next.fontSize, next.fontFamily, next.lineHeight)
  const dw = size.width - el.width
  const dh = size.height - el.height
  let x = el.x
  let y = el.y
  if (el.angle !== 0) {
    x = el.x - dw / 2
    y = el.y - dh / 2
  } else if (next.textAlign === 'center') x = el.x - dw / 2
  else if (next.textAlign === 'right') x = el.x - dw
  return updateElement(el, { ...change, x, y, width: size.width, height: size.height })
}

/** Applies the parts of a style patch that make sense for the element; returns the same object if none do. */
export function applyStyleToElement(el: SceneElement, patch: StylePatch): SceneElement {
  if (!isRenderable(el)) return el
  const next: Record<string, unknown> = {}
  const copy = (keys: readonly (keyof StyleProps)[]) => {
    for (const k of keys) if (patch[k] !== undefined) next[k] = patch[k]
  }
  copy(COMMON_KEYS)
  if (!isText(el)) copy(LINE_KEYS)
  if (isShape(el)) copy(FILL_KEYS)
  if (patch.edges !== undefined && isShape(el)) {
    const r = roundnessFor(el.type, patch.edges)
    if (r !== undefined) next.roundness = r
  }
  if (patch.curve !== undefined && isLinear(el)) {
    Object.assign(next, curvePatch(el, patch.curve))
  }
  if (isText(el)) {
    const change: { fontSize?: number; textAlign?: TextElement['textAlign'] } = {}
    if (patch.fontSize !== undefined) change.fontSize = patch.fontSize
    if (patch.textAlign !== undefined) change.textAlign = patch.textAlign
    if (Object.keys(change).length) {
      const base = Object.keys(next).length ? (updateElement(el, next) as TextElement) : (el as TextElement)
      // labels are re-laid out by reconcile; free text is re-measured here
      return base.containerId != null ? updateElement(base, change) : reflowText(base, change)
    }
  }
  if (el.type === 'arrow') {
    if (patch.startArrowhead !== undefined) next.startArrowhead = patch.startArrowhead
    if (patch.endArrowhead !== undefined) next.endArrowhead = patch.endArrowhead
  }
  return Object.keys(next).length === 0 ? el : updateElement(el, next)
}
