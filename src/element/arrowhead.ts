export type ArrowheadKind = 'arrow' | 'triangle' | 'bar' | 'circle' | 'diamond'

export const ARROWHEADS: readonly ArrowheadKind[] = ['arrow', 'triangle', 'bar', 'circle', 'diamond']

/**
 * Maps a stored arrowhead value to what is drawn: "dot" is a circle, "_outline" variants
 * draw as their base shape and any unknown value draws as a plain arrow. The stored value is never rewritten.
 */
export function normalizeArrowhead(value: unknown): ArrowheadKind | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return 'arrow'
  if (value === 'dot') return 'circle'
  const base = value.endsWith('_outline') ? value.slice(0, -'_outline'.length) : value
  return (ARROWHEADS as readonly string[]).includes(base) ? (base as ArrowheadKind) : 'arrow'
}
