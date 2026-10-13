const SANS = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'
const MONO = 'Consolas, "SFMono-Regular", Menlo, "Courier New", monospace'

export function fontStack(fontFamily: number): string {
  return fontFamily === 3 ? MONO : SANS
}

export function fontString(fontSize: number, fontFamily: number): string {
  return `${fontSize}px ${fontStack(fontFamily)}`
}

let measureCtx: CanvasRenderingContext2D | null | undefined

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    measureCtx =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  return measureCtx
}

export function measureText(
  text: string,
  fontSize: number,
  fontFamily: number,
  lineHeight: number,
): { width: number; height: number } {
  const lines = text.split('\n')
  const ctx = getMeasureCtx()
  let width = 0
  if (ctx) {
    ctx.font = fontString(fontSize, fontFamily)
    for (const line of lines) width = Math.max(width, ctx.measureText(line).width)
  } else {
    for (const line of lines) width = Math.max(width, line.length * fontSize * 0.6)
  }
  return { width, height: lines.length * fontSize * lineHeight }
}

export function textWidth(line: string, fontSize: number, fontFamily: number): number {
  const ctx = getMeasureCtx()
  if (!ctx) return line.length * fontSize * 0.6
  ctx.font = fontString(fontSize, fontFamily)
  return ctx.measureText(line).width
}

/**
 * Greedy word wrap to `maxWidth` that keeps leading and repeated spaces and whitespace-only lines
 * (like a pre-wrap textarea). Explicit newlines are kept, words wider than the limit are broken
 * character by character, and spaces at a soft wrap are dropped.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number, fontFamily: number): string {
  const w = (s: string) => textWidth(s, fontSize, fontFamily)
  const limit = Math.max(maxWidth, 1)
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (para.trim() === '') {
      out.push(para)
      continue
    }
    let line = ''
    for (const tok of para.split(/( +)/)) {
      if (tok === '') continue
      if (tok.startsWith(' ')) {
        line += tok
        continue
      }
      if (w(line + tok) <= limit) {
        line += tok
        continue
      }
      if (line.trim() !== '') {
        out.push(line.replace(/ +$/, ''))
        line = ''
      }
      let chunk = line
      for (const ch of Array.from(tok)) {
        if (chunk.trim() !== '' && w(chunk + ch) > limit) {
          out.push(chunk)
          chunk = ch
        } else {
          chunk += ch
        }
      }
      line = chunk
    }
    out.push(line)
  }
  return out.join('\n')
}
