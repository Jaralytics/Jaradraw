const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'number', 'email', 'url', 'password', 'tel'])
const ACTIVATOR_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'color', 'file'])
const ACTIVATOR_ROLES = new Set(['button', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'tab', 'switch', 'checkbox', 'radio', 'link'])
const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/** The few element properties used here, so the checks run without a DOM in tests. */
export interface KeyTarget {
  tagName: string
  type?: string
  isContentEditable?: boolean
  getAttribute(name: string): string | null
  hasAttribute?(name: string): boolean
}

function asTarget(t: unknown): KeyTarget | null {
  return typeof t === 'object' && t !== null && 'tagName' in t && typeof (t as KeyTarget).getAttribute === 'function'
    ? (t as KeyTarget)
    : null
}

/** Targets that need the whole keyboard: text fields, textareas, selects, contenteditable and menus. */
export function isTypingTarget(target: unknown): boolean {
  const t = asTarget(target)
  if (!t) return false
  if (t.tagName === 'INPUT') return TEXT_INPUT_TYPES.has(t.type ?? '')
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true
  return t.getAttribute('role') === 'menuitem'
}

function isSlider(t: KeyTarget): boolean {
  return (t.tagName === 'INPUT' && t.type === 'range') || t.getAttribute('role') === 'slider'
}

function isActivator(t: KeyTarget): boolean {
  if (t.tagName === 'INPUT') return ACTIVATOR_INPUT_TYPES.has(t.type ?? '')
  if (t.tagName === 'BUTTON' || t.tagName === 'SUMMARY' || t.tagName === 'SELECT') return true
  if (t.tagName === 'A' && t.hasAttribute?.('href')) return true
  const role = t.getAttribute('role')
  return role !== null && ACTIVATOR_ROLES.has(role)
}

/** True when the focused element handles this key natively, so no app shortcut may act on it. */
export function targetOwnsKey(target: unknown, e: { key: string; code?: string }): boolean {
  const t = asTarget(target)
  if (!t) return false
  if (isTypingTarget(t)) return true
  if (isSlider(t)) return SLIDER_KEYS.has(e.key)
  const activation = e.key === 'Enter' || e.key === ' ' || e.code === 'Space'
  return activation && isActivator(t)
}


/** True when keyboard focus is on the drawing area itself rather than on a control. */
export function isCanvasFocus(target: unknown): boolean {
  if (target === null || target === undefined) return true
  const t = asTarget(target)
  return !!t && (t.tagName === 'BODY' || t.tagName === 'HTML' || t.tagName === 'CANVAS')
}
