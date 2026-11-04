import { useEffect, useRef } from 'react'
import { tinykeys, type KeybindingsMap } from 'tinykeys'

/** ChatGPT's core shortcuts. `$mod` is ⌘ on macOS and Ctrl elsewhere. */
export const SHORTCUTS = {
  newChat: { keys: '$mod+Shift+O', label: 'New chat' },
  search: { keys: '$mod+K', label: 'Search chats' },
  toggleSidebar: { keys: '$mod+Shift+S', label: 'Toggle sidebar' },
  focusComposer: { keys: 'Shift+Escape', label: 'Focus the message box' },
  copyLastAnswer: { keys: '$mod+Shift+C', label: 'Copy the last answer' },
  stop: { keys: 'Escape', label: 'Stop the answer' },
  // Handled by the composer itself (only when it's empty), not bound here.
  editLast: { keys: 'ArrowUp', label: 'Edit your last message (empty box)' },
  settings: { keys: '$mod+,', label: 'Open settings' },
  showShortcuts: { keys: '$mod+/', label: 'Show keyboard shortcuts' },
} as const

/**
 * Binds `bindings` on the window while the component is mounted. Unlike
 * tinykeys' default, shortcuts also work while typing (as on ChatGPT); only
 * key repeats and IME composition are ignored.
 */
export function useShortcuts(bindings: KeybindingsMap) {
  // Handlers change every render (e.g. while an answer streams); only the
  // set of keys should cause a new binding.
  const latest = useRef(bindings)
  latest.current = bindings
  const keys = Object.keys(bindings).sort().join('\0')
  useEffect(() => {
    const handlers: KeybindingsMap = {}
    for (const key of keys ? keys.split('\0') : []) {
      handlers[key] = (event) => latest.current[key]?.(event)
    }
    return tinykeys(window, handlers, {
      ignore: (event) => event.repeat || event.isComposing,
    })
  }, [keys])
}

// The same check tinykeys uses for `$mod`, so labels match the bindings.
const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const KEY_NAMES: Record<string, string> = isMac
  ? { $mod: '⌘', Shift: '⇧', Escape: 'Esc', ArrowUp: '↑' }
  : { $mod: 'Ctrl', Escape: 'Esc', ArrowUp: '↑' }

/** The keys of a binding as shown to the user, e.g. ['⌘', '⇧', 'O']. */
export function keyCaps(keys: string): string[] {
  return keys.split('+').map((key) => KEY_NAMES[key] ?? key)
}
