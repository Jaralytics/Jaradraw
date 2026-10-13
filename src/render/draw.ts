import rough from 'roughjs'
import type { RoughCanvas } from 'roughjs/bin/canvas'
import type { Drawable, Options } from 'roughjs/bin/core'
import type { FreedrawElement, LinearElement, SceneElement, ShapeElement, TextElement } from '../element/types'
import type { FrameElement, ImageElement } from '../element/types'
import { containerIdOf, isBoundText, isFrame, isFreedraw, isImage, isLinear, isRenderable, isText } from '../element/types'
import { FRAME_NAME_SIZE, FRAME_RADIUS, frameLabel } from '../element/frame'
import { transformColor } from './color'
import { getDecodedImage } from './imageCache'
import { freedrawOutline, outlineToPath } from '../element/freedraw'
import type { Point } from '../element/types'
import { getCurveSegments, isCurved, tangentSource } from '../element/path'
import type { Vec2 } from '../element/path'
import { normalizeArrowhead } from '../element/arrowhead'
import type { ArrowheadKind } from '../element/arrowhead'
import { getBoxCenter, getElementBox } from '../element/geometry'
import { fontStack, fontString } from '../element/text'
import { cornerRadius } from '../element/style'

export const generator = rough.generator()
const identity = (c: string) => c
const roughCanvases = new WeakMap<HTMLCanvasElement, RoughCanvas>()
const drawableCache = new Map<string, { key: string; drawables: Drawable[] }>()

function getRough(canvas: HTMLCanvasElement): RoughCanvas {
  let rc = roughCanvases.get(canvas)
  if (!rc) {
    rc = rough.canvas(canvas)
    roughCanvases.set(canvas, rc)
  }
  return rc
}

function roughOptions(el: SceneElement, col: (c: string) => string = identity): Options {
  const sw = el.strokeWidth
  const dashed = el.strokeStyle === 'dashed'
  const dotted = el.strokeStyle === 'dotted'
  return {
    seed: el.seed || 1,
    roughness: el.roughness,
    stroke: col(el.strokeColor),
    strokeWidth: sw,
    fill: el.backgroundColor !== 'transparent' ? col(el.backgroundColor) : undefined,
    fillStyle: el.fillStyle,
    fillWeight: sw / 2,
    hachureGap: sw * 4,
    strokeLineDash: dashed ? [8, 8 + sw] : dotted ? [1.5, 6 + sw] : undefined,
    disableMultiStroke: dashed || dotted,
    preserveVertices: true,
  }
}

function shapeDrawables(el: ShapeElement, col: (c: string) => string): Drawable[] {
  const o = roughOptions(el, col)
  const { width: w, height: h } = el
  const r = cornerRadius(el)
  if (el.type === 'rectangle') {
    if (r <= 0) return [generator.rectangle(0, 0, w, h, o)]
    return [
      generator.path(
        `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h} ` +
          `L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`,
        o,
      ),
    ]
  }
  if (el.type === 'ellipse') return [generator.ellipse(w / 2, h / 2, w, h, o)]
  const verts: [number, number][] = [
    [w / 2, 0],
    [w, h / 2],
    [w / 2, h],
    [0, h / 2],
  ]
  if (r <= 0) return [generator.polygon(verts, o)]
  return [generator.path(roundedPolygonPath(verts, r), o)]
}

function roundedPolygonPath(verts: readonly [number, number][], radius: number): string {
  const n = verts.length
  const corner = (i: number) => {
    const v = verts[i]
    const prev = verts[(i + n - 1) % n]
    const next = verts[(i + 1) % n]
    const toward = (t: readonly [number, number]) => {
      const len = Math.hypot(t[0] - v[0], t[1] - v[1])
      const d = Math.min(radius, len / 2)
      return [v[0] + ((t[0] - v[0]) / len) * d, v[1] + ((t[1] - v[1]) / len) * d]
    }
    return { v, a: toward(prev), b: toward(next) }
  }
  const cs = verts.map((_, i) => corner(i))
  let d = `M ${cs[0].b[0]} ${cs[0].b[1]}`
  for (let i = 1; i < n; i++) {
    d += ` L ${cs[i].a[0]} ${cs[i].a[1]} Q ${cs[i].v[0]} ${cs[i].v[1]} ${cs[i].b[0]} ${cs[i].b[1]}`
  }
  d += ` L ${cs[0].a[0]} ${cs[0].a[1]} Q ${cs[0].v[0]} ${cs[0].v[1]} ${cs[0].b[0]} ${cs[0].b[1]} Z`
  return d
}

function headDrawables(
  kind: ArrowheadKind,
  tip: Vec2,
  from: Vec2,
  avail: number,
  el: LinearElement,
  o: Options,
  bg: string,
): Drawable[] {
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return []
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const size = Math.min(Math.max(12, el.strokeWidth * 5), avail * 0.6 + 4)
  const at = (back: number, side: number): [number, number] => [
    tip.x - ux * back + px * side,
    tip.y - uy * back + py * side,
  ]
  const headOpts: Options = { ...o, strokeLineDash: undefined, fill: undefined }
  const solid = (fill: string): Options => ({ ...headOpts, fill, fillStyle: 'solid' })
  switch (kind) {
    case 'arrow': {
      const spread = (25 * Math.PI) / 180
      const ang = Math.atan2(dy, dx)
      return [spread, -spread].map((s) =>
        generator.line(tip.x, tip.y, tip.x - size * Math.cos(ang - s), tip.y - size * Math.sin(ang - s), headOpts),
      )
    }
    case 'triangle':
      return [generator.polygon([at(0, 0), at(size, size * 0.4), at(size, -size * 0.4)], solid(o.stroke ?? el.strokeColor))]
    case 'bar': {
      const [x1, y1] = at(0, size * 0.45)
      const [x2, y2] = at(0, -size * 0.45)
      return [generator.line(x1, y1, x2, y2, headOpts)]
    }
    case 'circle': {
      const r = size * 0.35
      const [cx, cy] = at(r, 0)
      return [generator.circle(cx, cy, r * 2, solid(bg))]
    }
    case 'diamond': {
      const d = size * 0.9
      return [generator.polygon([at(0, 0), at(d / 2, size * 0.3), at(d, 0), at(d / 2, -size * 0.3)], solid(bg))]
    }
  }
}

function curvePathData(points: readonly Point[]): string {
  const segs = getCurveSegments(points)
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (const [, c1, c2, p] of segs) d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p.x} ${p.y}`
  return d
}

function linearDrawables(el: LinearElement, bg: string, col: (c: string) => string): Drawable[] {
  const pts = el.points
  const o = { ...roughOptions(el, col), fill: undefined }
  if (pts.length < 2) return []
  const path = pts.map((p) => [p[0], p[1]] as [number, number])
  const out: Drawable[] = [isCurved(el) ? generator.path(curvePathData(pts), o) : generator.linearPath(path, o)]
  const n = pts.length
  const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const end = normalizeArrowhead(el.endArrowhead)
  const start = normalizeArrowhead(el.startArrowhead)
  const tip = (p: Point): Vec2 => ({ x: p[0], y: p[1] })
  if (end) out.push(...headDrawables(end, tip(pts[n - 1]), tangentSource(el, true), dist(pts[n - 1], pts[n - 2]), el, o, col(bg)))
  if (start) out.push(...headDrawables(start, tip(pts[0]), tangentSource(el, false), dist(pts[0], pts[1]), el, o, col(bg)))
  return out
}

export function getDrawables(el: ShapeElement | LinearElement, bg: string, dark = false): Drawable[] {
  const key = `${el.version}:${el.versionNonce}:${isLinear(el) ? bg : ''}:${dark ? 'd' : 'l'}`
  const ck = `${el.id}|${dark ? 'd' : 'l'}`
  const cached = drawableCache.get(ck)
  if (cached && cached.key === key) return cached.drawables
  const col = dark ? transformColor : identity
  const drawables = isLinear(el) ? linearDrawables(el, bg, col) : shapeDrawables(el, col)
  drawableCache.set(ck, { key, drawables })
  return drawables
}

function drawText(ctx: CanvasRenderingContext2D, el: TextElement, col: (c: string) => string): void {
  ctx.font = fontString(el.fontSize, el.fontFamily)
  ctx.fillStyle = col(el.strokeColor)
  ctx.textBaseline = 'middle'
  ctx.textAlign = el.textAlign
  const x = el.textAlign === 'center' ? el.width / 2 : el.textAlign === 'right' ? el.width : 0
  const lh = el.fontSize * el.lineHeight
  el.text.split('\n').forEach((line, i) => ctx.fillText(line, x, (i + 0.5) * lh))
}

const freedrawCache = new Map<string, { key: string; path: Path2D }>()

function drawFreedraw(ctx: CanvasRenderingContext2D, el: FreedrawElement, col: (c: string) => string): void {
  const key = `${el.version}:${el.versionNonce}`
  let entry = freedrawCache.get(el.id)
  if (!entry || entry.key !== key) {
    entry = { key, path: new Path2D(outlineToPath(freedrawOutline(el))) }
    freedrawCache.set(el.id, entry)
  }
  ctx.fillStyle = col(el.strokeColor)
  ctx.fill(entry.path)
}

export interface DrawOptions {
  /** Alpha multiplier (0 to 1), used to show elements about to be erased. */
  fade?: number
  /** Canvas background color, used behind arrow labels and inside hollow arrowheads. */
  background?: string
  /** Paint the background behind a label so its arrow does not cross the text. */
  labelBackground?: boolean
  /** Draw with dark-mode colors (images are never transformed). */
  dark?: boolean
  /** File map used to resolve image elements. */
  files?: Record<string, unknown>
}

export interface DrawEnv {
  dark?: boolean
  files?: Record<string, unknown>
  /** Extra opacity factor for everything drawn (previews). */
  alpha?: number
}

function drawImage(ctx: CanvasRenderingContext2D, el: ImageElement, opts: DrawOptions): void {
  const w = el.width
  const h = el.height
  const file = el.fileId ? (opts.files?.[el.fileId] as { dataURL?: string } | undefined) : undefined
  const img = el.fileId ? getDecodedImage(el.fileId, file?.dataURL) : null
  if (!img) {
    ctx.fillStyle = opts.dark ? '#2a2a30' : '#f1f1f4'
    ctx.strokeStyle = opts.dark ? '#4a4a52' : '#c9c9d1'
    ctx.lineWidth = 1
    ctx.fillRect(0, 0, w, h)
    ctx.strokeRect(0, 0, w, h)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(w, h)
    ctx.moveTo(w, 0)
    ctx.lineTo(0, h)
    ctx.stroke()
    return
  }
  const [sx, sy] = el.scale
  if (sx < 0 || sy < 0) {
    ctx.translate(w / 2, h / 2)
    ctx.scale(sx < 0 ? -1 : 1, sy < 0 ? -1 : 1)
    ctx.translate(-w / 2, -h / 2)
  }
  ctx.drawImage(img, 0, 0, w, h)
}

function drawFrame(ctx: CanvasRenderingContext2D, el: FrameElement, col: (c: string) => string): void {
  const k = Math.max(0, Math.min(FRAME_RADIUS, el.width / 2, el.height / 2))
  ctx.strokeStyle = col(el.strokeColor)
  ctx.lineWidth = el.strokeWidth
  ctx.beginPath()
  ctx.moveTo(k, 0)
  ctx.arcTo(el.width, 0, el.width, el.height, k)
  ctx.arcTo(el.width, el.height, 0, el.height, k)
  ctx.arcTo(0, el.height, 0, 0, k)
  ctx.arcTo(0, 0, el.width, 0, k)
  ctx.closePath()
  ctx.stroke()
  ctx.font = `${FRAME_NAME_SIZE}px ${fontStack(2)}`
  ctx.fillStyle = col('#868e96')
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillText(frameLabel(el), 0, -6)
}

/** Draws one element in scene space; the caller sets up the viewport transform. */
export function drawElement(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  el: SceneElement,
  opts: DrawOptions = {},
): void {
  if (el.isDeleted) return
  if (!isRenderable(el)) return
  const col = opts.dark ? transformColor : identity
  const bg = opts.background ?? '#ffffff'

  const c = getBoxCenter(getElementBox(el))
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, el.opacity / 100)) * (opts.fade ?? 1)
  if (el.angle !== 0) {
    ctx.translate(c.x, c.y)
    ctx.rotate(el.angle)
    ctx.translate(-c.x, -c.y)
  }
  ctx.translate(el.x, el.y)

  if (isText(el)) {
    if (opts.labelBackground) {
      const alpha = ctx.globalAlpha
      ctx.globalAlpha = 1
      ctx.fillStyle = col(bg)
      ctx.fillRect(-4, -2, el.width + 8, el.height + 4)
      ctx.globalAlpha = alpha
    }
    drawText(ctx, el, col)
  } else if (isFreedraw(el)) {
    drawFreedraw(ctx, el, col)
  } else if (isImage(el)) {
    drawImage(ctx, el, opts)
  } else if (isFrame(el)) {
    drawFrame(ctx, el, col)
  } else {
    const rc = getRough(canvas)
    for (const d of getDrawables(el as ShapeElement | LinearElement, bg, opts.dark)) rc.draw(d)
  }
  ctx.restore()
}

/**
 * Draws all elements in order; labels of arrows get a background-colored backing. Children of a
 * frame are clipped to it, and frame outlines are drawn last so children never cover them.
 */
export function drawElements(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  elements: readonly SceneElement[],
  background: string,
  hiddenId: string | null = null,
  onError?: () => void,
  faded: ReadonlySet<string> | null = null,
  env: DrawEnv = {},
): void {
  const arrows = new Set<string>()
  const frames = new Map<string, SceneElement>()
  for (const e of elements) {
    if (e.isDeleted) continue
    if (e.type === 'arrow') arrows.add(e.id)
    if (isFrame(e)) frames.set(e.id, e)
  }
  const one = (el: SceneElement) => {
    if (el.id === hiddenId) return
    ctx.save()
    try {
      const frame = el.frameId && !isFrame(el) ? frames.get(el.frameId) : undefined
      if (frame) clipToFrame(ctx, frame)
      drawElement(ctx, canvas, el, {
        background,
        labelBackground: isBoundText(el) && arrows.has(containerIdOf(el) as string),
        fade: (faded && (faded.has(el.id) || (isBoundText(el) && faded.has(containerIdOf(el) as string))) ? 0.3 : 1) * (env.alpha ?? 1),
        dark: env.dark,
        files: env.files,
      })
    } catch {
      onError?.()
    } finally {
      ctx.restore()
    }
  }
  for (const el of elements) if (!isFrame(el)) one(el)
  for (const el of elements) if (isFrame(el)) one(el)
}

/** Clips to the (possibly rotated) frame box; the transform is restored to the scene space. */
function clipToFrame(ctx: CanvasRenderingContext2D, frame: SceneElement): void {
  const c = getBoxCenter(getElementBox(frame))
  ctx.translate(c.x, c.y)
  ctx.rotate(frame.angle)
  ctx.translate(-c.x, -c.y)
  ctx.beginPath()
  ctx.rect(frame.x, frame.y, frame.width, frame.height)
  ctx.clip()
  ctx.translate(c.x, c.y)
  ctx.rotate(-frame.angle)
  ctx.translate(-c.x, -c.y)
}

export function pruneDrawableCache(liveIds: ReadonlySet<string>): void {
  for (const k of drawableCache.keys()) if (!liveIds.has(k.slice(0, -2))) drawableCache.delete(k)
  for (const id of freedrawCache.keys()) if (!liveIds.has(id)) freedrawCache.delete(id)
}
