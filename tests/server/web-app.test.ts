import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serveWebApp } from '../../src/server/main.ts'

describe('serving the web app', () => {
  let root: string
  let app: Hono
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'chibot-web-'))
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'index.html'), '<script src="/assets/a1.js">')
    writeFileSync(join(root, 'assets', 'a1.js'), 'console.log(1)')
    app = new Hono()
    serveWebApp(app, root)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('has browsers revalidate the page, so an upgrade loads the new build', async () => {
    for (const path of ['/', '/index.html', '/c/some-chat']) {
      const res = await app.request(path)
      expect(res.status, path).toBe(200)
      expect(await res.text(), path).toContain('/assets/a1.js')
      expect(res.headers.get('cache-control'), path).toBe('no-cache')
    }
    // Assets have content-hashed names, so they're left to normal caching.
    const asset = await app.request('/assets/a1.js')
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toBeNull()
  })
})
