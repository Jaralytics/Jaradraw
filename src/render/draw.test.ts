import { describe, expect, it } from 'vitest'
import { roundedPathData } from './draw'

describe('roundedPathData', () => {
  it('rounds each corner with a quadratic through the corner point', () => {
    expect(roundedPathData([[0, 0], [100, 0], [100, 80]], 10)).toBe('M 0 0 L 90 0 Q 100 0 100 10 L 100 80')
  })

  it('shrinks the radius to half of the shorter adjacent segment', () => {
    expect(roundedPathData([[0, 0], [8, 0], [8, 80]], 10)).toBe('M 0 0 L 4 0 Q 8 0 8 4 L 8 80')
  })

  it('leaves a two-point path straight', () => {
    expect(roundedPathData([[0, 0], [50, 0]], 10)).toBe('M 0 0 L 50 0')
  })
})
