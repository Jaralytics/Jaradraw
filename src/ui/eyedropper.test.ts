import { afterEach, describe, expect, it, vi } from 'vitest'
import { eyedropperSupported, pickScreenColor } from './eyedropper'

function stubEyeDropper(open: () => Promise<{ sRGBHex: string }>): void {
  class Stub {
    open = open
  }
  vi.stubGlobal('window', { EyeDropper: Stub })
}

afterEach(() => vi.unstubAllGlobals())

describe('pickScreenColor', () => {
  it('returns the picked color as lowercase #rrggbb', async () => {
    stubEyeDropper(async () => ({ sRGBHex: '#1E90FF' }))
    expect(eyedropperSupported()).toBe(true)
    expect(await pickScreenColor()).toBe('#1e90ff')
  })

  it('returns null when the user aborts', async () => {
    stubEyeDropper(() => Promise.reject(new DOMException('canceled', 'AbortError')))
    expect(await pickScreenColor()).toBeNull()
  })

  it('returns null when the browser has no EyeDropper', async () => {
    vi.stubGlobal('window', {})
    expect(eyedropperSupported()).toBe(false)
    expect(await pickScreenColor()).toBeNull()
  })
})
