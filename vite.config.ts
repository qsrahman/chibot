import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// `pnpm dev` runs the API on this port (`dev:server` in package.json) and Vite
// on its own: a PORT in the environment (a tool that starts the dev server
// for Vite's port sets one) would otherwise put both on the same port.
const API_PORT = 3000

export default defineConfig(({ mode, command }) => {
  // Empty prefix loads all .env vars; HOST is read from them.
  const env = loadEnv(mode, process.cwd(), '')
  // Which build a page came from. The server reports the build it serves
  // (build-id.txt), so a page left open across a rebuild can say it is out of
  // date.
  const buildId = command === 'build' ? Date.now().toString(36) : 'dev'
  return {
    root: 'src/web',
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    plugins: [
      react(),
      {
        name: 'build-id',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'build-id.txt',
            source: buildId,
          })
        },
      },
    ],
    build: { outDir: '../../dist/web', emptyOutDir: true },
    server: {
      host: env.HOST || '127.0.0.1',
      // Trailing slash, or the module /api.ts would be proxied too.
      proxy: { '/api/': `http://127.0.0.1:${API_PORT}` },
    },
  }
})
