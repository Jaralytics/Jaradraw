import type { Box, SceneElement } from '../element/types'
import { isLinear } from '../element/types'
import { getElementCorners } from '../element/geometry'
import { getGroupHandlePositions, getHandlePositions, rotationHandlePosition } from '../element/handles'
import { getSelectionBounds, groupMembers, selectionUnits } from '../element/group'
import type { SnapGuide } from '../element/snap'
import { sceneToScreen } from '../scene/viewport'
import type { Viewport } from '../scene/viewport'
import { drawElements, pruneDrawableCache } from './draw'
import { transformColor } from './color'
import { pruneImages } from './imageCache'
import { collectFileIds } from '../element/image'
import type { PointEdit } from '../scene/store'
import { getBoxCenter, getElementBox } from '../element/geometry'

export const ACCENT = '#4c6ef5'
const MIN_GRID_CELL_PX = 5
const PREVIEW_ALPHA = 0.5

export interface GridParams {
  size: number
  step: number
}

export interface RenderParams {
  canvas: HTMLCanvasElement
  width: number
  height: number
  dpr: number
  elements: readonly SceneElement[]
  draft: SceneElement | null
  /** Pending elements drawn semi-transparent above the scene; never part of `elements`. */
  preview?: readonly SceneElement[]
  viewport: Viewport
  backgroundColor: string
  selected: readonly SceneElement[]
  marquee: Box | null
  hiddenId: string | null
  bindHighlight: string | null
  pointEdit: PointEdit | null
  grid?: GridParams | null
  guides?: readonly SnapGuide[]
  fadedIds?: readonly string[]
  editingGroupId?: string | null
  dark?: boolean
  files?: Record<string, unknown>
}

// Fill of selection handles, set per frame from the theme.
let handleFill = '#ffffff'

export function renderScene(p: RenderParams): void {
  const ctx = p.canvas.getContext('2d')
  if (!ctx) return
  const { dpr, viewport: vp } = p

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, p.width, p.height)
  handleFill = p.dark ? '#232329' : '#ffffff'
  try {
    const bg = typeof p.backgroundColor === 'string' ? p.backgroundColor : '#ffffff'
    ctx.fillStyle = p.dark ? transformColor(bg) : bg
    ctx.fillRect(0, 0, p.width, p.height)
  } catch {
    // an unusable background must never stop the frame
  }

  if (p.grid) drawGrid(ctx, p.grid, vp, p.width, p.height, p.dark === true)

  ctx.save()
  ctx.scale(vp.zoom, vp.zoom)
  ctx.translate(vp.scrollX, vp.scrollY)
  const live = new Set<string>()
  for (const el of p.elements) live.add(el.id)
  const faded = p.fadedIds && p.fadedIds.length ? new Set(p.fadedIds) : null
  const env = { dark: p.dark, files: p.files }
  drawElements(ctx, p.canvas, p.elements, p.backgroundColor, p.hiddenId, undefined, faded, env)
  if (p.draft) {
    live.add(p.draft.id)
    drawElements(ctx, p.canvas, [p.draft], p.backgroundColor, null, undefined, null, env)
  }
  if (p.preview && p.preview.length) {
    for (const el of p.preview) live.add(el.id)
    drawElements(ctx, p.canvas, p.preview, p.backgroundColor, null, undefined, null, { ...env, alpha: PREVIEW_ALPHA })
  }
  const target = p.bindHighlight ? p.elements.find((e) => e.id === p.bindHighlight && !e.isDeleted) : undefined
  if (target) drawBindHighlight(ctx, target, vp)
  ctx.restore()
  if (p.elements.length > 0) {
    pruneDrawableCache(live)
    pruneImages(collectFileIds(p.elements, true))
  }

  if (p.editingGroupId) drawEditingGroup(ctx, p.elements, p.editingGroupId, vp)

  const sel = p.selected.filter((e) => !e.isDeleted && e.id !== p.hiddenId)
  if (sel.length === 1) drawSelection(ctx, sel[0], vp, p.pointEdit?.id === sel[0].id ? p.pointEdit : null)
  else if (sel.length > 1) drawMultiSelection(ctx, sel, vp, p.editingGroupId ?? null)

  if (p.guides && p.guides.length) drawGuides(ctx, p.guides, vp)

  if (p.marquee) {
    const a = sceneToScreen(vp, p.marquee.x, p.marquee.y)
    const w = p.marquee.width * vp.zoom
    const h = p.marquee.height * vp.zoom
    ctx.save()
    ctx.fillStyle = 'rgba(76, 110, 245, 0.08)'
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 1
    ctx.fillRect(a.x, a.y, w, h)
    ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h)
    ctx.restore()
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  grid: GridParams,
  vp: Viewport,
  width: number,
  height: number,
  dark: boolean,
): void {
  const cell = grid.size * vp.zoom
  if (cell < MIN_GRID_CELL_PX) return
  const x0 = -vp.scrollX
  const y0 = -vp.scrollY
  const firstI = Math.floor(x0 / grid.size)
  const lastI = Math.ceil((x0 + width / vp.zoom) / grid.size)
  const firstJ = Math.floor(y0 / grid.size)
  const lastJ = Math.ceil((y0 + height / vp.zoom) / grid.size)
  ctx.save()
  ctx.lineWidth = 1
  for (const strong of [false, true]) {
    ctx.strokeStyle = dark
      ? strong
        ? 'rgba(255, 255, 255, 0.14)'
        : 'rgba(255, 255, 255, 0.06)'
      : strong
        ? 'rgba(30, 30, 36, 0.13)'
        : 'rgba(30, 30, 36, 0.06)'
    ctx.beginPath()
    for (let i = firstI; i <= lastI; i++) {
      if ((i % grid.step === 0) !== strong) continue
      const x = Math.round((i * grid.size + vp.scrollX) * vp.zoom) + 0.5
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
    }
    for (let j = firstJ; j <= lastJ; j++) {
      if ((j % grid.step === 0) !== strong) continue
      const y = Math.round((j * grid.size + vp.scrollY) * vp.zoom) + 0.5
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

export const GUIDE_COLOR = '#ff2e93'
const MARK = 3
const TICK = 4
const MIN_LABEL_PX = 28

function drawGuides(ctx: CanvasRenderingContext2D, guides: readonly SnapGuide[], vp: Viewport): void {
  ctx.save()
  ctx.strokeStyle = GUIDE_COLOR
  ctx.fillStyle = GUIDE_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  const px = (v: number) => Math.round(v) + 0.5
  const labels: { x: number; y: number; text: string }[] = []
  for (const g of guides) {
    const a = sceneToScreen(vp, g.x1, g.y1)
    const b = sceneToScreen(vp, g.x2, g.y2)
    ctx.moveTo(px(a.x), px(a.y))
    ctx.lineTo(px(b.x), px(b.y))
    if (g.kind === 'align') {
      for (const m of g.marks) {
        const s = sceneToScreen(vp, m.x, m.y)
        const x = px(s.x)
        const y = px(s.y)
        ctx.moveTo(x - MARK, y - MARK)
        ctx.lineTo(x + MARK + 1, y + MARK + 1)
        ctx.moveTo(x - MARK, y + MARK)
        ctx.lineTo(x + MARK + 1, y - MARK - 1)
      }
    } else {
      const horizontal = g.axis === 'x'
      for (const s of [a, b]) {
        const x = px(s.x)
        const y = px(s.y)
        ctx.moveTo(horizontal ? x : x - TICK, horizontal ? y - TICK : y)
        ctx.lineTo(horizontal ? x : x + TICK + 1, horizontal ? y + TICK + 1 : y)
      }
      const length = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y)
      if (g.label && length >= MIN_LABEL_PX) {
        labels.push({
          x: horizontal ? (a.x + b.x) / 2 : a.x + 16,
          y: horizontal ? a.y - 10 : (a.y + b.y) / 2,
          text: String(Math.round(g.size)),
        })
      }
    }
  }
  ctx.stroke()
  if (labels.length) {
    ctx.font = '10px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const l of labels) {
      const w = ctx.measureText(l.text).width + 8
      ctx.fillStyle = GUIDE_COLOR
      ctx.beginPath()
      ctx.roundRect(l.x - w / 2, l.y - 7, w, 14, 3)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillText(l.text, l.x, l.y + 0.5)
    }
  }
  ctx.restore()
}

function strokeCorners(ctx: CanvasRenderingContext2D, el: SceneElement, vp: Viewport): void {
  const corners = getElementCorners(el).map((c) => sceneToScreen(vp, c.x, c.y))
  ctx.beginPath()
  corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)))
  ctx.closePath()
  ctx.stroke()
}

function drawRotateHandle(
  ctx: CanvasRenderingContext2D,
  box: Box,
  angle: number,
  vp: Viewport,
): void {
  const c = getBoxCenter(box)
  const top = sceneToScreen(vp, c.x, box.y)
  const topRot = rotatedAbout(sceneToScreen(vp, c.x, c.y), top, angle)
  const h = sceneToScreen(vp, rotationHandlePosition(box, angle, vp.zoom).x, rotationHandlePosition(box, angle, vp.zoom).y)
  ctx.beginPath()
  ctx.moveTo(topRot.x, topRot.y)
  ctx.lineTo(h.x, h.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(h.x, h.y, 5, 0, Math.PI * 2)
  ctx.fillStyle = handleFill
  ctx.fill()
  ctx.stroke()
}

function rotatedAbout(center: { x: number; y: number }, p: { x: number; y: number }, angle: number) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

function drawEditingGroup(
  ctx: CanvasRenderingContext2D,
  elements: readonly SceneElement[],
  groupId: string,
  vp: Viewport,
): void {
  const box = getSelectionBounds(groupMembers(elements, groupId))
  if (!box) return
  const a = sceneToScreen(vp, box.x, box.y)
  ctx.save()
  ctx.strokeStyle = ACCENT
  ctx.globalAlpha = 0.5
  ctx.setLineDash([4, 4])
  ctx.strokeRect(a.x - 6, a.y - 6, box.width * vp.zoom + 12, box.height * vp.zoom + 12)
  ctx.restore()
}

function drawMultiSelection(
  ctx: CanvasRenderingContext2D,
  els: readonly SceneElement[],
  vp: Viewport,
  editingGroupId: string | null,
): void {
  const locked = els.some((e) => e.locked)
  ctx.save()
  ctx.strokeStyle = ACCENT
  ctx.fillStyle = handleFill
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.55
  const units = selectionUnits(els, els.map((e) => e.id), editingGroupId)
  const single = units.length === 1 && units[0].length > 1
  if (!single) {
    for (const unit of units) {
      if (unit.length === 1) strokeCorners(ctx, unit[0], vp)
      else {
        const b = getSelectionBounds(unit)
        if (!b) continue
        const a = sceneToScreen(vp, b.x, b.y)
        ctx.setLineDash([3, 3])
        ctx.strokeRect(a.x, a.y, b.width * vp.zoom, b.height * vp.zoom)
        ctx.setLineDash([])
      }
    }
  }
  ctx.globalAlpha = 1
  const box = getSelectionBounds(els)
  if (box) {
    const a = sceneToScreen(vp, box.x, box.y)
    ctx.setLineDash(locked ? [2, 4] : [5, 4])
    ctx.strokeRect(a.x, a.y, box.width * vp.zoom, box.height * vp.zoom)
    ctx.setLineDash([])
    if (!locked) {
      for (const h of getGroupHandlePositions(box)) {
        const s = sceneToScreen(vp, h.x, h.y)
        ctx.beginPath()
        ctx.rect(s.x - 4, s.y - 4, 8, 8)
        ctx.fill()
        ctx.stroke()
      }
      drawRotateHandle(ctx, box, 0, vp)
    }
  }
  ctx.restore()
}

function drawBindHighlight(ctx: CanvasRenderingContext2D, el: SceneElement, vp: Viewport): void {
  const c = getBoxCenter(getElementBox(el))
  const pad = 6
  const hw = el.width / 2 + pad
  const hh = el.height / 2 + pad
  ctx.save()
  ctx.translate(c.x, c.y)
  ctx.rotate(el.angle)
  ctx.strokeStyle = ACCENT
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 3 / vp.zoom
  ctx.beginPath()
  if (el.type === 'ellipse') ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2)
  else if (el.type === 'diamond') {
    ctx.moveTo(0, -hh)
    ctx.lineTo(hw, 0)
    ctx.lineTo(0, hh)
    ctx.lineTo(-hw, 0)
    ctx.closePath()
  } else ctx.rect(-hw, -hh, hw * 2, hh * 2)
  ctx.stroke()
  ctx.restore()
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  el: SceneElement,
  vp: Viewport,
  pointEdit: PointEdit | null,
): void {
  ctx.save()
  ctx.strokeStyle = ACCENT
  ctx.fillStyle = handleFill
  ctx.lineWidth = 1

  if (el.locked) {
    ctx.setLineDash([2, 4])
    const grow = 4
    const corners = getElementCorners(el).map((c) => sceneToScreen(vp, c.x, c.y))
    const mid = corners.reduce((a, c) => ({ x: a.x + c.x / 4, y: a.y + c.y / 4 }), { x: 0, y: 0 })
    ctx.beginPath()
    corners.forEach((c, i) => {
      const d = Math.hypot(c.x - mid.x, c.y - mid.y) || 1
      const x = c.x + ((c.x - mid.x) / d) * grow
      const y = c.y + ((c.y - mid.y) / d) * grow
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.stroke()
    ctx.restore()
    return
  }

  if (!isLinear(el)) strokeCorners(ctx, el, vp)

  for (const h of getHandlePositions(el, pointEdit !== null, vp.zoom)) {
    if (h.handle.kind === 'rotate') {
      drawRotateHandle(ctx, getElementBox(el), el.angle, vp)
      continue
    }
    const s = sceneToScreen(vp, h.x, h.y)
    ctx.beginPath()
    if (h.handle.kind === 'mid') {
      ctx.globalAlpha = 0.7
      ctx.arc(s.x, s.y, 3, 0, Math.PI * 2)
    } else if (h.handle.kind === 'point') ctx.arc(s.x, s.y, 5, 0, Math.PI * 2)
    else ctx.rect(s.x - 4, s.y - 4, 8, 8)
    const active = h.handle.kind === 'point' && pointEdit?.selected === h.handle.index
    ctx.fillStyle = active ? ACCENT : handleFill
    ctx.fill()
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  ctx.restore()
}
