interface EyeDropperResult {
  sRGBHex: string
}

interface EyeDropperApi {
  open(options?: { signal?: AbortSignal }): Promise<EyeDropperResult>
}

declare global {
  interface Window {
    /** Chromium only. */
    EyeDropper?: new () => EyeDropperApi
  }
}

const HEX = /^#[0-9a-f]{6}$/

/** True when the browser offers the native eyedropper (Chrome, Edge). */
export function eyedropperSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.EyeDropper === 'function'
}

/** Lets the user pick a screen pixel. Resolves to a lowercase #rrggbb, or null when cancelled or unsupported. Needs a user gesture. */
export async function pickScreenColor(): Promise<string | null> {
  if (!eyedropperSupported()) return null
  try {
    const { sRGBHex } = await new window.EyeDropper!().open()
    const hex = sRGBHex.trim().toLowerCase()
    return HEX.test(hex) ? hex : null
  } catch {
    // Escape rejects with an AbortError; any other failure also leaves the color alone
    return null
  }
}
