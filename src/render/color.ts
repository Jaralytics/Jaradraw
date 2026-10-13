const cache = new Map<string, string>()

const INVERT = 0.93

/** Turns any CSS color (named, hsl, ...) into something parse() understands, or null when invalid. */
export type ColorResolver = (color: string) => string | null

let ctx2d: CanvasRenderingContext2D | null | undefined

const canvasResolver: ColorResolver = (color) => {
  if (ctx2d === undefined) ctx2d = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (!ctx2d) return null
  ctx2d.fillStyle = '#000000'
  ctx2d.fillStyle = color
  const a = ctx2d.fillStyle
  ctx2d.fillStyle = '#ffffff'
  ctx2d.fillStyle = color
  const b = ctx2d.fillStyle
  return a === b && typeof a === 'string' ? a : null
}

let resolver: ColorResolver | null = canvasResolver

/** Injectable for tests; null disables resolution of non-hex/rgb colors. */
export function setColorResolver(fn: ColorResolver | null): void {
  resolver = fn
  cache.clear()
}

function parseDirect(color: string): [number, number, number, number] | null {
  const c = color.trim().toLowerCase()
  let m = /^#([0-9a-f]{3,8})$/.exec(c)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('')
    if (h.length !== 6 && h.length !== 8) return null
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(c)
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return [Number(m[1]), Number(m[2]), Number(m[3]), a]
  }
  return null
}

function parse(color: string): [number, number, number, number] | null {
  const direct = parseDirect(color)
  if (direct) return direct
  if (color.trim().toLowerCase() === 'transparent' || !resolver) return null
  const resolved = resolver(color)
  return resolved ? parseDirect(resolved) : null
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
const hex = (v: number) => clamp(v).toString(16).padStart(2, '0')

function compute(color: string): string {
  const p = parse(color)
  if (!p || p[3] === 0) return color
  // invert(93%): c * 0.07 + (255 - c) * 0.93
  const [r, g, b] = [p[0], p[1], p[2]].map((c) => c * (1 - INVERT) + (255 - c) * INVERT)
  // hue-rotate(180deg) matrix, with the result clamped like the CSS filter does
  const R = -0.574 * r + 1.43 * g + 0.144 * b
  const G = 0.426 * r + 0.43 * g + 0.144 * b
  const B = 0.426 * r + 1.43 * g - 0.856 * b
  if (p[3] < 1) return `rgba(${clamp(R)}, ${clamp(G)}, ${clamp(B)}, ${p[3]})`
  return `#${hex(R)}${hex(G)}${hex(B)}`
}

/** Dark-mode equivalent of a stored color (invert 93% + hue-rotate 180deg); invalid values and transparent pass through. */
export function transformColor(color: string): string {
  if (typeof color !== 'string') return '#ffffff'
  const hit = cache.get(color)
  if (hit !== undefined) return hit
  const out = compute(color)
  cache.set(color, out)
  return out
}
