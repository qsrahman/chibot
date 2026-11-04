import type { StoredFile } from '../shared/types.ts'

export const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** A request with `body` as JSON. */
export const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: JSON_HEADERS,
  body: JSON.stringify(body),
})

/** What a request that never reached the server says (a bare "Failed to fetch" tells nothing). */
export const OFFLINE =
  'Can’t reach chibot. Check that it is running, then try again.'

/** `err` as a message for the user: a failed connection is `OFFLINE`; anything else (an abort too) is as it was. */
export function asNetworkError(err: unknown): Error {
  return err instanceof TypeError
    ? new Error(OFFLINE, { cause: err })
    : (err as Error)
}

/** `fetch`, with a failed connection reported as `OFFLINE`. */
export const apiFetch: typeof fetch = (input, init) =>
  fetch(input, init).catch((err: unknown) => {
    throw asNetworkError(err)
  })

/** The JSON response, or nothing for an empty one (204). */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init)
  if (!res.ok) throw new Error(await errorMessage(res))
  return (res.status === 204 ? undefined : await res.json()) as T
}

/** Deletes `url`. Already gone (404) is fine: the result is the same. */
export async function remove(url: string, init?: RequestInit): Promise<void> {
  const res = await apiFetch(url, { ...init, method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(await errorMessage(res))
}

export async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? `HTTP ${res.status}`
}

/** Stores a file (a document or an image) for a project or a message. */
export function uploadFile(file: File, signal?: AbortSignal) {
  const form = new FormData()
  form.append('file', file)
  return request<StoredFile>('/api/files', {
    method: 'POST',
    body: form,
    signal,
  })
}
