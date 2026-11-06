import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BlockedAddressError,
  MediaProxy,
  publicOnly,
} from '../../src/server/media-proxy.ts'

/** A site on this machine, for the proxy to fetch from. */
async function site(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
) {
  const server = http.createServer(handler)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, server }
}

const read = async (stream: AsyncIterable<Buffer | string>) => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString()
}

describe('publicOnly', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fe80::1',
    'fd12::1',
    '::ffff:127.0.0.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
  ])('refuses %s', (address) => {
    expect(publicOnly(address)).toBe(false)
  })

  it.each(['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'])(
    'allows %s',
    (address) => {
      expect(publicOnly(address)).toBe(true)
    },
  )
})

describe('MediaProxy', () => {
  const open: http.Server[] = []
  afterEach(() => open.splice(0).forEach((server) => server.close()))
  const serve = async (handler: Parameters<typeof site>[0]) => {
    const found = await site(handler)
    open.push(found.server)
    return found.url
  }
  const allowAll = new MediaProxy({ allowed: () => true })

  it('refuses this machine and the local network, by address and by name', async () => {
    const proxy = new MediaProxy()
    await expect(
      proxy.get(new URL('http://127.0.0.1:9/x.png')),
    ).rejects.toThrow(BlockedAddressError)
    await expect(proxy.get(new URL('http://[::1]:9/x.png'))).rejects.toThrow(
      /private or local/,
    )
    await expect(
      proxy.get(new URL('http://192.168.1.1/x.png')),
    ).rejects.toThrow(/private or local/)
    // A name that resolves to this machine is checked after it resolves.
    await expect(
      proxy.get(new URL('http://localhost:9/x.png')),
    ).rejects.toThrow(BlockedAddressError)
  })

  it('refuses other schemes', async () => {
    await expect(allowAll.get(new URL('file:///etc/passwd'))).rejects.toThrow(
      /only http and https/,
    )
  })

  it('fetches, passing on a range and sending no cookies or referrer', async () => {
    let seen: http.IncomingHttpHeaders = {}
    const url = await serve((req, res) => {
      seen = req.headers
      res.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Content-Range': 'bytes 0-4/100',
      })
      res.end('hello')
    })
    const got = await allowAll.get(new URL(`${url}/clip.mp4`), {
      range: 'bytes=0-4',
    })
    expect(got.status).toBe(206)
    expect(got.headers['content-range']).toBe('bytes 0-4/100')
    expect(await read(got.body)).toBe('hello')
    expect(seen.range).toBe('bytes=0-4')
    expect(seen.cookie).toBeUndefined()
    expect(seen.referer).toBeUndefined()
  })

  it('follows a redirect, checking where it goes', async () => {
    const url = await serve((req, res) => {
      if (req.url === '/start') {
        res.writeHead(302, { Location: '/final.png' })
        return res.end()
      }
      if (req.url === '/to-the-router') {
        res.writeHead(302, { Location: 'http://192.168.1.1/admin.png' })
        return res.end()
      }
      if (req.url === '/loop') {
        res.writeHead(302, { Location: '/loop' })
        return res.end()
      }
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end('png')
    })
    // Only this machine's test site is allowed here, so 192.168.1.1 is refused.
    const proxy = new MediaProxy({
      allowed: (address) => address === '127.0.0.1',
    })
    expect(await read((await proxy.get(new URL(`${url}/start`))).body)).toBe(
      'png',
    )
    await expect(proxy.get(new URL(`${url}/to-the-router`))).rejects.toThrow(
      BlockedAddressError,
    )
    await expect(proxy.get(new URL(`${url}/loop`))).rejects.toThrow(
      /redirects too often/,
    )
  })
})
