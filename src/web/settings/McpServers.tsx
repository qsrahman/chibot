import { useEffect } from 'react'
import type { Settings } from '../../shared/settings.ts'
import {
  listMcpServers,
  reconnectMcpServer,
  reloadMcpServers,
  signInToMcpServer,
  signOutOfMcpServer,
} from '../api.ts'
import { describeMcpServer, isConnecting, withMember } from '../mcp.ts'
import { useLoad } from '../useLoad.ts'
import type { SettingsApi } from '../useSettings.ts'
import { Row, Section } from './parts.tsx'

/** The servers in `mcp.json`: a switch, status and actions each, and tools. */
export function McpServers({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: SettingsApi['update']
}) {
  const { data, error, reload, act } = useLoad(listMcpServers)
  const servers = data?.servers
  // Connecting settles within the server's 10 s timeout: check back.
  const connecting = isConnecting(servers)
  useEffect(() => {
    if (!connecting) return
    const timer = setInterval(() => void reload(), 1000)
    return () => clearInterval(timer)
  }, [connecting, reload])

  const {
    disabledMcpServers: off,
    askMcpServers: asking,
    disabledTools,
  } = settings
  const switchServer = (name: string, on: boolean) =>
    act(() =>
      onChange({
        disabledMcpServers: withMember(off, name, !on),
      }),
    )
  const signIn = (name: string) =>
    act(async () => {
      const { url } = await signInToMcpServer(name)
      if (url) location.assign(url)
    })

  if (!servers) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null
  }
  return (
    <>
      <Section title="MCP servers">
        <Row
          label="mcp.json"
          description={
            servers.length === 0
              ? 'No servers yet. Add them to mcp.json in chibot’s folder (mcp.example.json shows how), then reload.'
              : 'Servers are set up in this file, not here. After editing it, reload to apply the changes.'
          }
        >
          <button
            type="button"
            className="button"
            onClick={() => void act(reloadMcpServers)}
          >
            Reload
          </button>
        </Row>
      </Section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {servers.map((server) => {
        const { kind, status } = describeMcpServer(server)
        return (
          <Section key={server.name} title={`MCP · ${server.name}`}>
            <Row
              label={kind}
              description={status}
              htmlFor={`setting-mcp-${server.name}`}
            >
              <div className="settings-controls">
                {server.state === 'needs-sign-in' && (
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => void signIn(server.name)}
                  >
                    Sign in
                  </button>
                )}
                {server.signedIn && (
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      void act(() => signOutOfMcpServer(server.name))
                    }
                  >
                    Sign out
                  </button>
                )}
                {(server.state === 'failed' ||
                  server.state === 'connected') && (
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      void act(() => reconnectMcpServer(server.name))
                    }
                  >
                    Reconnect
                  </button>
                )}
                <input
                  id={`setting-mcp-${server.name}`}
                  type="checkbox"
                  role="switch"
                  className="switch"
                  aria-label={`Use ${server.name}`}
                  checked={server.state !== 'disabled'}
                  onChange={(e) =>
                    void switchServer(server.name, e.target.checked)
                  }
                />
              </div>
            </Row>
            {server.state !== 'disabled' && (
              <Row
                label="Ask before using its tools"
                description="Each call waits for your Approve or Deny."
                htmlFor={`setting-mcp-ask-${server.name}`}
              >
                <input
                  id={`setting-mcp-ask-${server.name}`}
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={asking.includes(server.name)}
                  onChange={(e) =>
                    void onChange({
                      askMcpServers: withMember(
                        asking,
                        server.name,
                        e.target.checked,
                      ),
                    })
                  }
                />
              </Row>
            )}
            {server.tools.map((tool) => (
              <Row
                key={tool.name}
                label={tool.title}
                description={tool.description}
                htmlFor={`setting-tool-${tool.name}`}
              >
                <input
                  id={`setting-tool-${tool.name}`}
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={!disabledTools.includes(tool.name)}
                  onChange={(e) =>
                    void onChange({
                      disabledTools: withMember(
                        disabledTools,
                        tool.name,
                        !e.target.checked,
                      ),
                    })
                  }
                />
              </Row>
            ))}
          </Section>
        )
      })}
    </>
  )
}
