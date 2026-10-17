import { DEFAULT_SLIDE_SECONDS, parseSeconds } from './slides'
import type { SlideTransition } from './slides'

const SECONDS_KEY = 'jaradraw:slideSeconds'
const LOOP_KEY = 'jaradraw:slideLoop'
const TRANSITION_KEY = 'jaradraw:slideTransition'

export function loadSlideTransition(): SlideTransition {
  try {
    return localStorage.getItem(TRANSITION_KEY) === 'zoom' ? 'zoom' : 'pan'
  } catch {
    return 'pan'
  }
}

export function saveSlideTransition(kind: SlideTransition): void {
  try {
    localStorage.setItem(TRANSITION_KEY, kind)
  } catch {
    // storage unavailable: the value just is not remembered
  }
}

/** Default seconds per slide, persisted in localStorage (storage failures fall back to the default). */
export function loadSlideSeconds(): number {
  try {
    return parseSeconds(localStorage.getItem(SECONDS_KEY) ?? '') ?? DEFAULT_SLIDE_SECONDS
  } catch {
    return DEFAULT_SLIDE_SECONDS
  }
}

export function saveSlideSeconds(seconds: number): void {
  try {
    localStorage.setItem(SECONDS_KEY, String(seconds))
  } catch {
    // storage unavailable: the value just is not remembered
  }
}

export function loadSlideLoop(): boolean {
  try {
    return localStorage.getItem(LOOP_KEY) === '1'
  } catch {
    return false
  }
}

export function saveSlideLoop(loop: boolean): void {
  try {
    localStorage.setItem(LOOP_KEY, loop ? '1' : '0')
  } catch {
    // storage unavailable: the value just is not remembered
  }
}
