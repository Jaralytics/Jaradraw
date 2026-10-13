import type { SceneElement, TextElement } from './types'
import { isLinear, isText } from './types'
import { createText, updateElement } from './factory'
import { getBoxCenter, getElementBox, rotatePoint } from './geometry'
import { flattenElementPath, pathMidpoint } from './path'
import { measureText, wrapText } from './text'

export const LABEL_PADDING = 5
export const ARROW_LABEL_MAX_WIDTH = 160

const SQRT1_2 = Math.SQRT1_2

/** Width available to the label inside a container. */
export function innerWidth(c: SceneElement): number {
  if (isLinear(c)) return ARROW_LABEL_MAX_WIDTH
  const base = c.type === 'ellipse' ? c.width * SQRT1_2 : c.type === 'diamond' ? c.width / 2 : c.width
  return Math.max(base - 2 * LABEL_PADDING, 1)
}

/** Container height needed for a label block of height `textHeight`. */
export function requiredHeight(c: SceneElement, textHeight: number): number {
  const need = textHeight + 2 * LABEL_PADDING
  if (c.type === 'ellipse') return need / SQRT1_2
  if (c.type === 'diamond') return need * 2
  return need
}

/** Center where the label of a container is placed. */
export function labelCenter(c: SceneElement): { x: number; y: number } {
  if (isLinear(c)) {
    const mid = pathMidpoint(flattenElementPath(c))
    const base = { x: c.x + mid.x, y: c.y + mid.y }
    if (c.angle === 0) return base
    const ctr = getBoxCenter(getElementBox(c))
    return rotatePoint(base.x, base.y, ctr.x, ctr.y, c.angle)
  }
  return getBoxCenter(getElementBox(c))
}

export interface LabelLayout {
  text: string
  x: number
  y: number
  width: number
  height: number
  angle: number
  /** New container height, or null when the container already fits. */
  containerHeight: number | null
}

export function computeLabelLayout(
  c: SceneElement,
  src: Pick<TextElement, 'originalText' | 'fontSize' | 'fontFamily' | 'lineHeight'>,
): LabelLayout {
  const wrapped = wrapText(src.originalText, innerWidth(c), src.fontSize, src.fontFamily)
  const size = measureText(wrapped, src.fontSize, src.fontFamily, src.lineHeight)
  let containerHeight: number | null = null
  if (!isLinear(c)) {
    const need = requiredHeight(c, size.height)
    if (need > c.height + 1e-6) containerHeight = need
  }
  const center = labelCenter(c)
  return {
    text: wrapped,
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
    angle: isLinear(c) ? 0 : c.angle,
    containerHeight,
  }
}

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6

/**
 * Re-lays out a label inside its container, growing the container (around its center) when the
 * wrapped text does not fit. Unchanged objects are returned as-is so callers can detect no-ops.
 */
export function layoutLabel<C extends SceneElement>(
  container: C,
  label: TextElement,
): { container: C; label: TextElement } {
  let c = container
  let l = computeLabelLayout(c, label)
  if (l.containerHeight !== null) {
    const growth = l.containerHeight - container.height
    c = updateElement(container, { height: l.containerHeight, y: container.y - growth / 2 } as Partial<C>)
    l = computeLabelLayout(c, label)
  }
  const same =
    label.text === l.text &&
    close(label.x, l.x) &&
    close(label.y, l.y) &&
    close(label.width, l.width) &&
    close(label.height, l.height) &&
    close(label.angle, l.angle) &&
    label.groupIds.length === c.groupIds.length &&
    label.groupIds.every((g, i) => g === c.groupIds[i])
  if (same) return { container: c, label }
  return {
    container: c,
    label: updateElement(label, {
      text: l.text,
      x: l.x,
      y: l.y,
      width: l.width,
      height: l.height,
      angle: l.angle,
      groupIds: c.groupIds,
    }),
  }
}

/** Creates a laid-out label for a container (not yet registered in its boundElements). */
export function createLabel(
  container: SceneElement,
  text: string,
  style: { fontSize?: number; fontFamily?: number } = {},
): { container: SceneElement; label: TextElement } {
  const base = createText(0, 0, text, { width: 0, height: 0 }, {
    strokeColor: container.strokeColor,
    opacity: container.opacity,
    ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
    ...(style.fontFamily !== undefined ? { fontFamily: style.fontFamily } : {}),
  })
  const label: TextElement = {
    ...base,
    textAlign: 'center',
    verticalAlign: 'middle',
    containerId: container.id,
    autoResize: true,
    groupIds: container.groupIds,
  }
  return layoutLabel(container, label)
}

export function isLabelOf(el: SceneElement, containerId: string): el is TextElement {
  return isText(el) && el.containerId === containerId
}
