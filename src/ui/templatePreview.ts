import { transformColor } from '../render/color'
import { buildSvg } from '../render/svg'
import { TEMPLATES } from '../scene/templates'
import type { SceneElement } from '../element/types'

// Elements are built once per template so roughjs seeds, and thus the strokes, stay stable.
const elementsCache = new Map<string, SceneElement[]>()
const previewCache = new Map<string, string>()

const LIGHT_BG = '#ffffff'

function darken(els: readonly SceneElement[]): SceneElement[] {
  return els.map((e) => ({ ...e, strokeColor: transformColor(e.strokeColor), backgroundColor: transformColor(e.backgroundColor) }))
}

/** Data URL of the template rendered as SVG (no background), or null when it cannot be built. Cached by id and theme. */
export function templatePreview(id: string, dark: boolean): string | null {
  const key = `${id}:${dark ? 'dark' : 'light'}`
  const hit = previewCache.get(key)
  if (hit !== undefined) return hit
  const template = TEMPLATES.find((t) => t.id === id)
  if (!template) return null
  let base = elementsCache.get(id)
  if (!base) {
    base = template.build()
    elementsCache.set(id, base)
  }
  const bg = dark ? transformColor(LIGHT_BG) : LIGHT_BG
  const built = buildSvg(dark ? darken(base) : base, { background: bg, files: {} })
  if (!built) return null
  const w = Math.round(built.width * 100) / 100
  const h = Math.round(built.height * 100) / 100
  const svg = built.svg
    .replace(`<rect x="0" y="0" width="${w}" height="${h}" fill="${bg}"/>`, '')
    .replace(/ width="[^"]*" height="[^"]*">/, ' width="100%" height="100%" preserveAspectRatio="xMidYMid meet">')
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  previewCache.set(key, url)
  return url
}
