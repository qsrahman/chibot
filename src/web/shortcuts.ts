import { useEffect } from 'react'
import { tinykeys, type KeybindingsMap } from 'tinykeys'

/** ChatGPT's core shortcuts. `$mod` is ⌘ on macOS and Ctrl elsewhere. */
export const SHORTCUTS = {
  newChat: { keys: '$mod+Shift+O', label: 'New chat' },
  search: { keys: '$mod+K', label: 'Search chats' },
  toggleSidebar: { keys: '$mod+Shift+S', label: 'Toggle sidebar' },
  focusComposer: { keys: 'Shift+Escape', label: 'Focus the message box' },
  copyLastAnswer: { keys: '$mod+Shift+C', label: 'Copy the last answer' },
  stop: { keys: 'Escape', label: 'Stop the answer' },
  showShortcuts: { keys: '$mod+/', label: 'Show keyboard shortcuts' },
} as const

/**
 * Binds `bindings` on the window while the component is mounted. Unlike
 * tinykeys' default, shortcuts also work while typing (as on ChatGPT); only
 * key repeats and IME composition are ignored.
 */
export function useShortcuts(bindings: KeybindingsMap) {
  useEffect(
    () =>
      tinykeys(window, bindings, {
        ignore: (event) => event.repeat || event.isComposing,
      }),
    [bindings],
  )
}

// The same check tinykeys uses for `$mod`, so labels match the bindings.
const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const KEY_NAMES: Record<string, string> = isMac
  ? { $mod: '⌘', Shift: '⇧', Escape: 'Esc' }
  : { $mod: 'Ctrl', Escape: 'Esc' }

/** The keys of a binding as shown to the user, e.g. ['⌘', '⇧', 'O']. */
export function keyCaps(keys: string): string[] {
  return keys.split('+').map((key) => KEY_NAMES[key] ?? key)
}
