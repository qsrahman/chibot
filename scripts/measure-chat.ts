/// <reference lib="dom" />
// Measures how the web app copes with a long chat, on a server seeded by
// `pnpm seed:perf` and already running:
// `node scripts/measure-chat.ts --port 4177 --turns 500 [--throttle 6]`
// (--throttle: how many times slower the CPU is, 4 to 6 for a phone). Prints
// the time to open the chat, the size of the page, how smooth scrolling is
// and what a keystroke costs. Timings are for comparing runs on one machine.
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4177' },
    turns: { type: 'string', default: '500' },
    throttle: { type: 'string', default: '1' },
  },
})
const base = `http://127.0.0.1:${values.port}`
const turns = Number(values.turns)

const list = (await (await fetch(`${base}/api/conversations`)).json()) as {
  id: string
  title: string
}[]
const long = list.find((c) => c.title === 'Perf: long chat')
if (!long) throw new Error('No "Perf: long chat": run pnpm seed:perf first')
const started = performance.now()
const payload = (
  await (await fetch(`${base}/api/conversations/${long.id}`)).arrayBuffer()
).byteLength
console.log(
  `chats in the sidebar: ${list.length}; the chat's data: ${(payload / 1e6).toFixed(1)} MB, fetched in ${Math.round(performance.now() - started)} ms`,
)

const browser = await chromium.launch()
const page = await (
  await browser.newContext({ viewport: { width: 1100, height: 760 } })
).newPage()
const cdp = await page.context().newCDPSession(page)
await cdp.send('Performance.enable')
await cdp.send('Emulation.setCPUThrottlingRate', {
  rate: Number(values.throttle),
})
const metrics = async () =>
  Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map((m) => [
      m.name,
      m.value,
    ]),
  )

await page.goto(base)
await page.getByRole('textbox', { name: 'Message' }).waitFor()
const before = await metrics()
const opened = Date.now()
await page.locator('.conversation-row', { hasText: 'Perf: long chat' }).click()
await page.waitForFunction(
  (n) => document.querySelectorAll('.turn').length >= n,
  turns,
  { timeout: 120_000 },
)
await page.locator('.turn').last().scrollIntoViewIfNeeded()
console.log(`open it, last turn on screen: ${Date.now() - opened} ms`)
await page.waitForTimeout(1500)
const after = await metrics()
const seconds = (name: string) =>
  ((after[name] ?? 0) - (before[name] ?? 0)).toFixed(2)
console.log(
  `DOM nodes: ${after.Nodes}; JS heap: ${((after.JSHeapUsedSize ?? 0) / 1e6).toFixed(0)} MB; script ${seconds('ScriptDuration')} s, layout ${seconds('LayoutDuration')} s, style ${seconds('RecalcStyleDuration')} s`,
)

// Scrolling from the end to the start, one frame per step.
const frames = await page.evaluate(async () => {
  const list = document.querySelector('.messages')!
  const times: number[] = []
  let last = performance.now()
  for (let i = 0; i <= 40; i++) {
    list.scrollTop = (list.scrollHeight - list.clientHeight) * (1 - i / 40)
    await new Promise((r) => requestAnimationFrame(r))
    const now = performance.now()
    times.push(now - last)
    last = now
  }
  times.sort((a, b) => a - b)
  return { median: times[20]!, p95: times[38]!, worst: times[40]! }
})
console.log(
  `scrolling, ms per frame: median ${Math.round(frames.median)}, 95th ${Math.round(frames.p95)}, worst ${Math.round(frames.worst)}`,
)

// A keystroke in the message box, to the next painted frame (about 33 ms is
// two frames at 60 Hz: nothing slower than the display).
const typing = await page.evaluate(async () => {
  const box = document.querySelector('textarea')!
  const set = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )!.set!
  const times: number[] = []
  for (let i = 0; i < 30; i++) {
    const t = performance.now()
    set.call(box, `${box.value}x`)
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    )
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  return { median: times[15]!, worst: times[29]! }
})
console.log(
  `typing, ms per keystroke: median ${Math.round(typing.median)}, worst ${Math.round(typing.worst)}`,
)
await browser.close()
