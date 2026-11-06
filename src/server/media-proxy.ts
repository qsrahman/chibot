import { lookup, type LookupAddress } from 'node:dns'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'

const PRIVATE = new BlockList()
for (const [network, prefix, type] of [
  ['0.0.0.0', 8, 'ipv4'], // "this network"
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'], // carrier-grade NAT
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'], // link-local, cloud metadata
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['64:ff9b::', 96, 'ipv6'], // NAT64: an IPv4 address behind the prefix
  ['2002::', 16, 'ipv6'], // 6to4: an IPv4 address in the middle
  ['fc00::', 7, 'ipv6'], // unique local
  ['fe80::', 10, 'ipv6'], // link-local
] as const) {
  PRIVATE.addSubnet(network, prefix, type)
}

/** Whether chibot may connect to an IP address. */
export type AddressGuard = (address: string) => boolean

/**
 * Only public addresses: never this machine or the local network (also as
 * IPv4-mapped IPv6, or an IPv4 address behind NAT64 or 6to4), so an answer
 * can't make chibot read the router, `localhost` services or cloud metadata.
 */
export const publicOnly: AddressGuard = (address) =>
  !PRIVATE.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')

/** The address is one chibot doesn't connect to (a 403, not a failed fetch). */
export class BlockedAddressError extends Error {
  constructor(host: string, address: string) {
    super(
      `${host} (${address}) is a private or local address, which chibot doesn't fetch`,
    )
  }
}

const MAX_REDIRECTS = 3
const IDLE_MS = 30_000
const REDIRECTS = [301, 302, 303, 307, 308]

/** What the site answered, before any of its body is read. */
export interface Upstream {
  status: number
  headers: IncomingMessage['headers']
  body: IncomingMessage
}

/**
 * Fetches an image, sound or video on the user's behalf, for `/api/media`. It
 * only connects to public addresses: each connection is checked, redirects
 * included, at connect time (literal IPs directly, names after resolving
 * them), which also defeats DNS rebinding. No cookies or referrer go along.
 */
export class MediaProxy {
  readonly #allowed: AddressGuard

  /** @param allowed which addresses may be connected to (tests allow their own) */
  constructor({ allowed = publicOnly }: { allowed?: AddressGuard } = {}) {
    this.#allowed = allowed
  }

  /** GET `url`; `range` is a `Range` header to pass on. */
  get(
    url: URL,
    {
      range,
      signal,
    }: { range?: string | undefined; signal?: AbortSignal } = {},
  ): Promise<Upstream> {
    return this.#request(url, range, signal, 0)
  }

  #request(
    url: URL,
    range: string | undefined,
    signal: AbortSignal | undefined,
    redirects: number,
  ): Promise<Upstream> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return Promise.reject(new Error('only http and https addresses'))
    }
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) && !this.#allowed(host)) {
      return Promise.reject(new BlockedAddressError(host, host))
    }
    return new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? https : http).request(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'image/*,audio/*,video/*',
            'User-Agent': 'Mozilla/5.0 (compatible; chibot)',
            ...(range && { Range: range }),
          },
          // Names are resolved here so every address is checked.
          lookup: (hostname, options, callback) =>
            lookup(hostname, { ...options, all: true }, (err, addresses) => {
              if (err) return callback(err, '', 4)
              const list = addresses as LookupAddress[]
              const blocked = list.find(
                ({ address }) => !this.#allowed(address),
              )
              if (blocked) {
                return callback(
                  new BlockedAddressError(hostname, blocked.address),
                  '',
                  4,
                )
              }
              if (options.all) return callback(null, list as never)
              callback(null, list[0]!.address, list[0]!.family)
            }),
          ...(signal && { signal }),
        },
        (res) => {
          const status = res.statusCode ?? 0
          const location = res.headers.location
          if (REDIRECTS.includes(status) && location) {
            res.resume()
            if (redirects >= MAX_REDIRECTS) {
              return reject(new Error('the site redirects too often'))
            }
            let next: URL
            try {
              next = new URL(location, url)
            } catch {
              return reject(new Error('the site redirects to a bad address'))
            }
            this.#request(next, range, signal, redirects + 1).then(
              resolve,
              reject,
            )
            return
          }
          resolve({ status, headers: res.headers, body: res })
        },
      )
      request.setTimeout(IDLE_MS, () =>
        request.destroy(new Error('the site took too long to answer')),
      )
      request.on('error', reject)
      request.end()
    })
  }
}
