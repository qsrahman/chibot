import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Empty prefix loads all .env vars, so the proxy follows the server's PORT.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    root: 'src/web',
    plugins: [react()],
    build: { outDir: '../../dist/web', emptyOutDir: true },
    server: {
      host: env.HOST || '127.0.0.1',
      // Trailing slash, or the module /api.ts would be proxied too.
      proxy: { '/api/': `http://127.0.0.1:${env.PORT || 3000}` },
    },
  }
})
