import { spawn } from 'node:child_process'

/**
 * Whether starting chibot from the command line should open the browser: not
 * when asked not to, and not where nobody is looking at a screen (a service,
 * CI, an SSH session, output piped to a file).
 */
export function wantsBrowser({
  noOpen,
  tty,
  env,
}: {
  noOpen: boolean
  tty: boolean
  env: Record<string, string | undefined>
}): boolean {
  return !noOpen && tty && !env.CI && !env.SSH_CONNECTION
}

/** The system's command that opens a web address, for `platform`. */
export function openCommand(
  platform: NodeJS.Platform,
  url: string,
): [string, string[]] {
  if (platform === 'darwin') return ['open', [url]]
  // `start` takes a window title first; the empty one is it.
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', url]]
  return ['xdg-open', [url]]
}

/**
 * Opens `url` in the default browser. A machine without one (a server with no
 * `xdg-open`) is not an error: chibot's address is printed anyway.
 */
export function openBrowser(
  url: string,
  { platform = process.platform, run = spawn } = {},
): void {
  const [command, args] = openCommand(platform, url)
  const child = run(command, args, { stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
}
