import { join } from 'node:path'
import { build } from 'vite'
import { expect, it } from 'vitest'

// The page as it ships, built in memory (about a second). Two things that grow
// unnoticed: zod, which the web must take as types only (a value imported from a
// file that imports it puts all of zod in the page: about a fifth of the main
// chunk), and a chunk past the size Vite warns about on every build.
it('ships a page without zod, and with no chunk Vite warns about', async () => {
  // Vitest runs as "test", which would build React's development version.
  const mode = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  let built
  try {
    built = await build({
      configFile: join(import.meta.dirname, '../../vite.config.ts'),
      logLevel: 'silent',
      build: { write: false },
    })
  } finally {
    if (mode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = mode
  }
  const outputs = (Array.isArray(built) ? built : [built]).flatMap((b) =>
    'output' in b ? b.output : [],
  )
  const chunks = outputs.filter((o) => o.type === 'chunk')
  expect(chunks.length).toBeGreaterThan(1)
  for (const chunk of chunks) {
    // Zod names its classes in strings that survive minifying. (A boolean, so
    // a failure names the file, not the whole chunk.)
    expect(chunk.code.includes('$ZodType'), `${chunk.fileName} holds zod`).toBe(
      false,
    )
    expect(chunk.code.length / 1000, chunk.fileName).toBeLessThan(500)
  }
}, 60_000)
