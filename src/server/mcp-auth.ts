import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type {
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from '@modelcontextprotocol/client'

/** What chibot keeps of one server's sign-in. */
interface SavedAuth {
  /** The redirect URL `client` was registered with. */
  redirectUrl?: string
  client?: StoredOAuthClientInformation
  tokens?: StoredOAuthTokens
  discovery?: OAuthDiscoveryState
}

/**
 * MCP servers' OAuth tokens and client registrations, in a JSON file only
 * the owner can read (`data/mcp-auth.json`): secrets, so never in SQLite,
 * exports or API responses.
 */
export class McpAuthStore {
  readonly #path: string
  readonly #saved: Record<string, SavedAuth>

  constructor(path: string) {
    this.#path = path
    this.#saved = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, SavedAuth>)
      : {}
  }

  get(server: string): SavedAuth {
    return this.#saved[server] ?? {}
  }

  update(server: string, patch: SavedAuth): void {
    this.#saved[server] = { ...this.get(server), ...patch }
    this.#write()
  }

  remove(server: string): void {
    delete this.#saved[server]
    this.#write()
  }

  #write() {
    writeFileSync(this.#path, JSON.stringify(this.#saved, null, 2), {
      mode: 0o600,
    })
  }
}

/**
 * One remote server's sign-in (dynamic client registration, PKCE). The SDK
 * calls it while connecting; an unsigned-in connect ends at
 * `redirectToAuthorization`, whose URL Settings' Sign in opens.
 */
export class McpSignIn implements OAuthClientProvider {
  readonly #server: string
  readonly #store: McpAuthStore
  readonly redirectUrl: string
  /** Where to send the browser to sign in, once a connect asked for it. */
  authorizationUrl: URL | null = null
  /** Where the browser goes back to after signing in. */
  returnTo = '/'
  #state: string | null = null
  #verifier = ''

  constructor(server: string, store: McpAuthStore, redirectUrl: string) {
    this.#server = server
    this.#store = store
    this.redirectUrl = redirectUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'chibot',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  get signedIn(): boolean {
    return this.#store.get(this.#server).tokens !== undefined
  }

  state(): string {
    this.#state = crypto.randomUUID()
    return this.#state
  }

  /** Whether `state` came back from this sign-in; each is used once. */
  takeState(state: string | null): boolean {
    if (!state || state !== this.#state) return false
    this.#state = null
    this.authorizationUrl = null
    return true
  }

  clientInformation() {
    const saved = this.#store.get(this.#server)
    // Registered for another port: register again.
    return saved.redirectUrl === this.redirectUrl ? saved.client : undefined
  }

  saveClientInformation(client: StoredOAuthClientInformation) {
    this.#store.update(this.#server, { client, redirectUrl: this.redirectUrl })
  }

  tokens() {
    return this.#store.get(this.#server).tokens
  }

  saveTokens(tokens: StoredOAuthTokens) {
    this.#store.update(this.#server, { tokens })
  }

  discoveryState() {
    return this.#store.get(this.#server).discovery
  }

  saveDiscoveryState(discovery: OAuthDiscoveryState) {
    this.#store.update(this.#server, { discovery })
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url
  }

  saveCodeVerifier(verifier: string) {
    this.#verifier = verifier
  }

  codeVerifier() {
    return this.#verifier
  }

  invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ) {
    if (scope === 'all') return this.signOut()
    if (scope === 'verifier') this.#verifier = ''
    else this.#store.update(this.#server, { [scope]: undefined })
  }

  /** Forgets the tokens and registration. */
  signOut() {
    this.#store.remove(this.#server)
    this.#state = null
    this.authorizationUrl = null
  }
}
