import type { Drawable } from 'roughjs/bin/core'
import type { Box, FreedrawElement, ImageElement, LinearElement, SceneElement, ShapeElement, TextElement } from '../element/types'
import { containerIdOf, isBoundText, isFrame, isFreedraw, isImage, isLinear, isShape, isText } from '../element/types'
import { getBoxCenter, getElementBox } from '../element/geometry'
import { freedrawOutline, outlineToPath } from '../element/freedraw'
import { fontStack } from '../element/text'
import { FRAME_NAME_SIZE, FRAME_RADIUS, frameLabel } from '../element/frame'
import { parseCrop } from '../element/crop'
import { exportBounds } from './bounds'
import { generator, getDrawables } from './draw'

export interface SvgOptions {
  /** Background color, or null for a transparent export. */
  background: string | null
  files: Record<string, unknown>
  /** Crops the export to this box (a frame); no padding is added. */
  crop?: Box | null
}

export interface SvgResult {
  svg: string
  width: number
  height: number
}

/** Escapes text for XML and drops control characters that XML 1.0 forbids. */
export function escapeXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
const esc = escapeXml
const num = (v: number) => String(Math.round(v * 100) / 100)

function pathsOf(drawables: readonly Drawable[]): string {
  let out = ''
  for (const d of drawables) {
    const dash = d.options.strokeLineDash
    for (const p of generator.toPaths(d)) {
      const outline = !p.fill && p.stroke === d.options.stroke && p.strokeWidth === d.options.strokeWidth
      const dashAttr = dash && outline ? ` stroke-dasharray="${dash.join(' ')}"` : ''
      out += `<path d="${esc(p.d)}" stroke="${esc(p.stroke)}" stroke-width="${num(p.strokeWidth)}" fill="${esc(p.fill || 'none')}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}/>`
    }
  }
  return out
}

function textSvg(el: TextElement, labelBg: string | null): string {
  const x = el.textAlign === 'center' ? el.width / 2 : el.textAlign === 'right' ? el.width : 0
  const anchor = el.textAlign === 'center' ? 'middle' : el.textAlign === 'right' ? 'end' : 'start'
  const lh = el.fontSize * el.lineHeight
  const family = esc(fontStack(el.fontFamily).replace(/"/g, "'"))
  let out = labelBg
    ? `<rect x="-4" y="-2" width="${num(el.width + 8)}" height="${num(el.height + 4)}" fill="${esc(labelBg)}"/>`
    : ''
  el.text.split('\n').forEach((line, i) => {
    out += `<text x="${num(x)}" y="${num((i + 0.5) * lh)}" font-family="${family}" font-size="${num(el.fontSize)}" fill="${esc(el.strokeColor)}" text-anchor="${anchor}" dominant-baseline="central" xml:space="preserve">${esc(line)}</text>`
  })
  return out
}

function imageSvg(el: ImageElement, files: Record<string, unknown>): string {
  const file = el.fileId ? (files[el.fileId] as { dataURL?: string } | undefined) : undefined
  if (!file || typeof file.dataURL !== 'string') {
    return `<rect width="${num(el.width)}" height="${num(el.height)}" fill="#f1f1f4" stroke="#c9c9d1"/>`
  }
  const [sx, sy] = el.scale
  const flip =
    sx < 0 || sy < 0
      ? ` transform="translate(${num(el.width / 2)} ${num(el.height / 2)}) scale(${sx < 0 ? -1 : 1} ${sy < 0 ? -1 : 1}) translate(${num(-el.width / 2)} ${num(-el.height / 2)})"`
      : ''
  const crop = parseCrop(el.crop)
  if (crop) {
    // a nested svg clips to its own box and maps the cropped region onto it; the full binary is drawn in crop coordinates
    return (
      `<g${flip}><svg width="${num(el.width)}" height="${num(el.height)}" viewBox="${num(crop.x)} ${num(crop.y)} ${num(crop.width)} ${num(crop.height)}" preserveAspectRatio="none" overflow="hidden">` +
      `<image href="${esc(file.dataURL)}" x="0" y="0" width="${num(crop.naturalWidth)}" height="${num(crop.naturalHeight)}" preserveAspectRatio="none"/></svg></g>`
    )
  }
  return `<image href="${esc(file.dataURL)}" width="${num(el.width)}" height="${num(el.height)}" preserveAspectRatio="none"${flip}/>`
}

function elementSvg(el: SceneElement, opts: SvgOptions, arrows: ReadonlySet<string>): string {
  let body = ''
  if (isText(el)) {
    const onArrow = isBoundText(el) && arrows.has(containerIdOf(el) as string)
    body = textSvg(el, onArrow ? (opts.background ?? '#ffffff') : null)
  } else if (isFreedraw(el)) {
    body = `<path d="${esc(outlineToPath(freedrawOutline(el as FreedrawElement)))}" fill="${esc(el.strokeColor)}" stroke="none"/>`
  } else if (isImage(el)) {
    body = imageSvg(el, opts.files)
  } else if (isFrame(el)) {
    body =
      `<rect width="${num(el.width)}" height="${num(el.height)}" rx="${FRAME_RADIUS}" fill="none" stroke="${esc(el.strokeColor)}" stroke-width="${num(el.strokeWidth)}"/>` +
      `<text x="0" y="-6" font-family="${esc(fontStack(2).replace(/"/g, "'"))}" font-size="${FRAME_NAME_SIZE}" fill="#868e96">${esc(frameLabel(el))}</text>`
  } else if (isShape(el) || isLinear(el)) {
    body = pathsOf(getDrawables(el as ShapeElement | LinearElement, opts.background ?? '#ffffff', false))
  } else return ''
  if (!body) return ''
  const c = getBoxCenter(getElementBox(el))
  const rot = el.angle !== 0 ? `translate(${num(c.x)} ${num(c.y)}) rotate(${num((el.angle * 180) / Math.PI)}) translate(${num(-c.x)} ${num(-c.y)}) ` : ''
  const opacity = el.opacity < 100 ? ` opacity="${num(el.opacity / 100)}"` : ''
  return `<g transform="${rot}translate(${num(el.x)} ${num(el.y)})"${opacity}>${body}</g>`
}

/** Builds a standalone SVG (always light colors). Returns null when there is nothing to draw. */
export function buildSvg(elements: readonly SceneElement[], opts: SvgOptions): SvgResult | null {
  const live = elements.filter((e) => !e.isDeleted)
  const b = exportBounds(live, opts.crop ?? null)
  if (!b) return null
  const arrows = new Set(live.filter((e) => e.type === 'arrow').map((e) => e.id))
  const frames = new Map(live.filter(isFrame).map((f) => [f.id, f]))
  const clips: string[] = []
  const wrap = (el: SceneElement): string => {
    const inner = elementSvg(el, opts, arrows)
    const frame = el.frameId && !isFrame(el) ? frames.get(el.frameId) : undefined
    if (!inner || !frame) return inner
    const id = `clip-${clips.length}`
    const c = getBoxCenter(getElementBox(frame))
    const rot = frame.angle !== 0 ? ` transform="rotate(${num((frame.angle * 180) / Math.PI)} ${num(c.x)} ${num(c.y)})"` : ''
    clips.push(`<clipPath id="${id}"><rect x="${num(frame.x)}" y="${num(frame.y)}" width="${num(frame.width)}" height="${num(frame.height)}"${rot}/></clipPath>`)
    return `<g clip-path="url(#${id})">${inner}</g>`
  }
  let content = ''
  for (const el of live) if (!isFrame(el)) content += wrap(el)
  for (const el of live) if (isFrame(el)) content += wrap(el)
  const w = num(b.width)
  const h = num(b.height)
  const bg = opts.background ? `<rect x="0" y="0" width="${w}" height="${h}" fill="${esc(opts.background)}"/>` : ''
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<defs>${clips.join('')}</defs>${bg}<g transform="translate(${num(-b.minX)} ${num(-b.minY)})">${content}</g></svg>`
  return { svg, width: b.width, height: b.height }
}
