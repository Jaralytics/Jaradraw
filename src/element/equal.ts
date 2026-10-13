import type { SceneElement } from './types'

const IGNORED = new Set(['version', 'versionNonce', 'updated'])

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/** True when two element lists hold the same content, ignoring version bookkeeping. */
export function sameContent(a: readonly SceneElement[], b: readonly SceneElement[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as unknown as Record<string, unknown>
    const y = b[i] as unknown as Record<string, unknown>
    if (x === y) continue
    const keys = new Set([...Object.keys(x), ...Object.keys(y)])
    for (const k of keys) {
      if (IGNORED.has(k)) continue
      if (!sameValue(x[k], y[k])) return false
    }
  }
  return true
}
