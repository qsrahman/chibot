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
      proxy: { '/api': `http://localhost:${env.PORT || 3000}` },
    },
  }
})
