import { isIP } from 'node:net'

/**
 * chibot's own address as a browser on this machine reaches it: loopback
 * stands in for "all interfaces".
 */
export function localOrigin({
  host,
  port,
}: {
  host: string
  port: number
}): string {
  const name = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host
  return `http://${isIP(name) === 6 ? `[${name}]` : name}:${port}`
}
