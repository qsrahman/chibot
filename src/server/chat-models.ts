// Which of an endpoint's models can chat. Model lists mix chat, embedding,
// image, speech and other models, and the OpenAI-style list says nothing
// about which is which.

/**
 * Families that can't chat through the Responses API, by name: embeddings,
 * speech, transcription, images and video, moderation, realtime/live audio,
 * search models that only work through Chat Completions, and legacy
 * completion models.
 */
const NOT_CHAT =
  /embed|tts|whisper|transcri|image|dall-e|sora|moderation|realtime|audio|search-(preview|api)|(^|\/)gpt-live|babbage|davinci|instruct/i

/**
 * The chat models among `ids`. Ollama says what each model can do
 * (`/api/show` capabilities: chat models have `completion`), which also
 * catches image models with plain names; other servers are filtered by name.
 */
export async function chatModels(
  ids: string[],
  baseURL: string | undefined,
  fetch = globalThis.fetch,
): Promise<string[]> {
  const capabilities = await ollamaCapabilities(ids, baseURL, fetch)
  return ids.filter((id) =>
    capabilities
      ? capabilities.get(id)?.includes('completion')
      : !NOT_CHAT.test(id),
  )
}

/** Each model's capabilities, or `null` when the server isn't Ollama. */
async function ollamaCapabilities(
  ids: string[],
  baseURL: string | undefined,
  fetch: typeof globalThis.fetch,
): Promise<Map<string, string[]> | null> {
  // No base URL is OpenAI itself; Ollama's native API sits beside /v1.
  const origin = baseURL && URL.parse(baseURL)?.origin
  if (!origin || origin === 'https://api.openai.com' || ids.length === 0) {
    return null
  }
  const show = async (model: string) => {
    const res = await fetch(`${origin}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const { capabilities } = (await res.json()) as { capabilities?: unknown }
    return Array.isArray(capabilities) ? (capabilities as string[]) : null
  }
  try {
    // One model answers whether this is Ollama at all.
    const first = await show(ids[0]!)
    if (!first) return null
    const rest = await Promise.all(ids.slice(1).map(show))
    return new Map(
      ids.map((id, i) => [id, (i === 0 ? first : rest[i - 1]) ?? []]),
    )
  } catch {
    return null
  }
}
