import { defineConfig, devices } from '@playwright/test'

const FAKE_OPENAI_PORT = 4010
const PORT = 4011

// End-to-end tests: a production build of chibot against a fake
// OpenAI-compatible server (tests/e2e/fake-openai.ts), with fresh data.
export default defineConfig({
  testDir: 'tests/e2e',
  // One server and database shared by all tests.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: [
    {
      command: 'node tests/e2e/fake-openai.ts',
      url: `http://127.0.0.1:${FAKE_OPENAI_PORT}/health`,
      env: { FAKE_OPENAI_PORT: String(FAKE_OPENAI_PORT) },
    },
    {
      command: 'rm -rf .e2e-data && pnpm build && node tests/e2e/server.ts',
      url: `http://127.0.0.1:${PORT}/api/health`,
      timeout: 120_000,
      // Real environment variables beat .env, so the developer's own
      // settings never leak into the tests.
      env: {
        OPENAI_BASE_URL: `http://127.0.0.1:${FAKE_OPENAI_PORT}/v1`,
        OPENAI_API_KEY: 'e2e',
        OPENAI_MODEL: 'e2e-model',
        OPENAI_IMAGE_MODEL: 'e2e-image',
        // Blank means unset: tests/e2e/server.ts adds a fake web search.
        BRAVE_API_KEY: '',
        HOST: '127.0.0.1',
        PORT: String(PORT),
        CHIBOT_DATA_DIR: '.e2e-data',
      },
    },
  ],
})
