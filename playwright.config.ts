import { defineConfig, devices } from '@playwright/test'

const FAKE_OPENAI_PORT = 4010
const PORT = 4011
const FAKE_V1 = `http://127.0.0.1:${FAKE_OPENAI_PORT}/v1`

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
    permissions: ['clipboard-read', 'clipboard-write', 'microphone'],
    // A fake microphone (a tone) for voice input.
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
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
      // Real environment variables beat .env, so every variable chibot reads
      // is set here (blank means unset): the developer's own settings must
      // never leak into the tests.
      env: {
        OPENAI_BASE_URL: FAKE_V1,
        OPENAI_API_KEY: 'e2e',
        OPENAI_MODEL: 'e2e-model',
        OPENAI_IMAGE_BASE_URL: FAKE_V1,
        OPENAI_IMAGE_API_KEY: '',
        OPENAI_IMAGE_MODEL: 'e2e-image',
        OPENAI_EMBEDDING_BASE_URL: FAKE_V1,
        OPENAI_EMBEDDING_API_KEY: '',
        OPENAI_EMBEDDING_MODEL: 'e2e-embed',
        OPENAI_TRANSCRIBE_BASE_URL: FAKE_V1,
        OPENAI_TRANSCRIBE_API_KEY: '',
        OPENAI_TRANSCRIBE_MODEL: 'e2e-transcribe',
        // tests/e2e/server.ts adds a fake web search.
        BRAVE_API_KEY: '',
        HOST: '127.0.0.1',
        PORT: String(PORT),
        CHIBOT_DATA_DIR: '.e2e-data',
        CHIBOT_TOKEN: '',
      },
    },
  ],
})
