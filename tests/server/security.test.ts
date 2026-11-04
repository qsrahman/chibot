import { describe, expect, it } from 'vitest'
import { Config } from '../../src/server/config.ts'
import { testApp } from './fakes.ts'

describe('who may reach chibot', () => {
  const app = (env: Record<string, string> = {}) =>
    testApp({ config: new Config({ OPENAI_API_KEY: 'k', ...env }) })

  it('answers only to this machine’s names and IP addresses', async () => {
    const chibot = app()
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'app.localhost']) {
      const res = await chibot.request(`http://${host}:3000/api/health`)
      expect(res.status, host).toBe(200)
    }
    // DNS rebinding: another site's name, resolved to this machine.
    const rebound = await chibot.request('http://evil.example:3000/api/health')
    expect(rebound.status).toBe(403)
    // A name set as HOST is fine.
    const named = app({ HOST: 'mybox.lan' })
    expect((await named.request('http://mybox.lan/api/health')).status).toBe(
      200,
    )
  })

  it('refuses uploads posted from other sites', async () => {
    const upload = (headers: Record<string, string>) => {
      const form = new FormData()
      form.append('file', new File(['x'], 'a.txt'))
      return app().request('http://127.0.0.1:3000/api/files', {
        method: 'POST',
        body: form,
        headers,
      })
    }
    expect(
      (
        await upload({
          Origin: 'https://evil.example',
          'Sec-Fetch-Site': 'cross-site',
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await upload({
          Origin: 'http://127.0.0.1:5173', // the Vite dev server
          'Sec-Fetch-Site': 'same-site',
        })
      ).status,
    ).toBe(201)
  })

  describe('with CHIBOT_TOKEN', () => {
    const TOKEN = 'a-long-enough-token'
    const chibot = () => app({ CHIBOT_TOKEN: TOKEN })

    it('lets in only browsers that opened it with the token', async () => {
      const app = chibot()
      expect((await app.request('/api/health')).status).toBe(401)
      expect((await app.request('/c/abc')).status).toBe(401)
      expect((await app.request('/?token=wrong')).status).toBe(401)

      const opened = await app.request('/c/abc?token=' + TOKEN + '&x=1')
      expect(opened.status).toBe(302)
      expect(opened.headers.get('location')).toBe('/c/abc?x=1')
      const cookie = opened.headers.get('set-cookie')!
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Strict')

      const health = await app.request('/api/health', {
        headers: { Cookie: cookie.split(';')[0]! },
      })
      expect(health.status).toBe(200)
      const forged = await app.request('/api/health', {
        headers: { Cookie: 'chibot_token=nope' },
      })
      expect(forged.status).toBe(401)
    })

    it('refuses a short token', () => {
      expect(
        () => new Config({ OPENAI_API_KEY: 'k', CHIBOT_TOKEN: 'short' }),
      ).toThrow(/CHIBOT_TOKEN/)
    })
  })

  it('has the app’s pages load images only from chibot, so a planted page cannot send data out in one', async () => {
    const chibot = app()
    const policy = "img-src 'self' data: blob:"
    // A page (the web app is mounted by main.ts; any non-API path will do)…
    const page = await chibot.request('http://127.0.0.1:3000/c/some-chat')
    expect(page.headers.get('content-security-policy')).toBe(policy)
    // …even one that is refused…
    const refused = await chibot.request('http://evil.example:3000/')
    expect(refused.status).toBe(403)
    expect(refused.headers.get('content-security-policy')).toBe(policy)
    // …but not the API, whose uploads set their own.
    const api = await chibot.request('http://127.0.0.1:3000/api/health')
    expect(api.headers.get('content-security-policy')).toBeNull()
  })
})
