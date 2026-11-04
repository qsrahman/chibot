import { expect, test } from '@playwright/test'
import { appReady } from './helpers.ts'

// chibot can be installed as an app (a window of its own, an icon): a web
// manifest with icons, linked from the page. There is no service worker: the
// server is local, so an offline copy of the page would only go stale.

interface Manifest {
  name: string
  start_url: string
  display: string
  icons: { src: string; sizes: string; type: string; purpose?: string }[]
}

test('has a manifest with icons, linked from the page', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  const link = page.locator('link[rel="manifest"]')
  // With credentials, so it also loads where an access token cookie is needed.
  await expect(link).toHaveAttribute('crossorigin', 'use-credentials')
  const res = await page.request.get((await link.getAttribute('href'))!)
  expect(res.ok()).toBe(true)
  expect(res.headers()['content-type']).toMatch(/json/)
  const manifest = (await res.json()) as Manifest
  expect(manifest).toMatchObject({
    name: 'chibot',
    start_url: '/',
    display: 'standalone',
  })

  // Every icon exists, and the sizes browsers ask for (192, 512, maskable) are there.
  for (const icon of manifest.icons) {
    const file = await page.request.get(icon.src)
    expect(file.ok(), icon.src).toBe(true)
    expect(file.headers()['content-type'], icon.src).toContain(
      icon.type.replace('image/svg+xml', 'image/svg'),
    )
  }
  const has = (size: string, purpose?: string) =>
    manifest.icons.some((i) => i.sizes === size && i.purpose === purpose)
  expect(has('192x192')).toBe(true)
  expect(has('512x512')).toBe(true)
  expect(has('512x512', 'maskable')).toBe(true)
  const touch = await page.request.get(
    (await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'))!,
  )
  expect(touch.ok()).toBe(true)
})

test('Chromium reads the manifest without complaint', async ({ page }) => {
  await page.goto('/')
  await appReady(page)
  // (Headless Chromium does not judge installability, but it does parse.)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Page.enable')
  const { url, errors, manifest } = (await cdp.send('Page.getAppManifest')) as {
    url: string
    errors: { message: string }[]
    manifest: { name?: string; display?: string; startUrl?: string }
  }
  expect(url).toMatch(/\/manifest\.webmanifest$/)
  expect(errors.map((e) => e.message)).toEqual([])
  expect(manifest.startUrl).toMatch(/\/$/)
})
