import { useEffect, useState } from 'react'
import {
  LogIn,
  LogOut,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import type { McpServerConfig } from '../../shared/mcp.ts'
import {
  listMcpDefinitions,
  listMcpServers,
  removeMcpServer,
  saveMcpServer,
  setMcpSwitch,
  reconnectMcpServer,
  reloadMcpServers,
  signInToMcpServer,
  signOutOfMcpServer,
} from './api.ts'
import { describeMcpServer, isConnecting } from './mcp.ts'
import { ConfirmDialog } from '../ui/Dialog.tsx'
import { IconButton } from '../ui/IconButton.tsx'
import { useLoad } from '../ui/useLoad.ts'
import { McpServerDialog } from './McpServerDialog.tsx'
import { Row, Section } from './parts.tsx'
import { errorMessage } from '../../shared/errors.ts'

/** The MCP servers from the config: a switch, status and actions each, and tools. */
export function McpServers({
  onToolsChanged,
}: {
  /** The servers' tools, or what they say about themselves, changed. */
  onToolsChanged: () => void
}) {
  const { data, error, reload, act: run } = useLoad(listMcpServers)
  /** Runs an action, then reloads; what the tools say follows a change that worked. */
  const act = async (action: () => Promise<unknown>) => {
    const worked = await run(action)
    if (worked) onToolsChanged()
    return worked
  }
  const servers = data?.servers
  const definitions = useLoad(listMcpDefinitions)
  const editable = definitions.data?.editable ?? false
  // The dialog is open for a new server (`existing: null`) or one being changed.
  const [editing, setEditing] = useState<{
    existing: { name: string; server: McpServerConfig } | null
  } | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  // Connecting settles within the server's 10 s timeout: check back.
  const connecting = isConnecting(servers)
  useEffect(() => {
    if (!connecting) return
    const timer = setInterval(() => void reload(), 1000)
    // Its tools exist once it has connected.
    return () => {
      clearInterval(timer)
      onToolsChanged()
    }
  }, [connecting, reload])

  // These switches are kept in each server's entry in the config file.
  const switchServer = (name: string, on: boolean) =>
    act(() => setMcpSwitch(name, { disabled: !on }))
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
          label="Servers"
          description={
            editable
              ? `Add a server here, or edit ${definitions.data?.source ?? 'the config file'} yourself and reload.`
              : `${definitions.data?.reason ?? 'Servers are set up in chibot’s config file.'} Edit "mcpServers" in the config file (\`chibot config path\` shows where; mcp.example.json shows how), then reload.`
          }
        >
          {editable && (
            <IconButton
              label="Add server"
              variant="primary"
              onClick={() => setEditing({ existing: null })}
            >
              <Plus size={18} strokeWidth={1.5} />
            </IconButton>
          )}
          <IconButton
            label="Reload servers from the config file"
            onClick={() => void act(reloadMcpServers)}
          >
            <RefreshCw size={18} strokeWidth={1.5} />
          </IconButton>
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
                  <IconButton
                    label="Sign in"
                    variant="primary"
                    onClick={() => void signIn(server.name)}
                  >
                    <LogIn size={18} strokeWidth={1.5} />
                  </IconButton>
                )}
                {server.signedIn && (
                  <IconButton
                    label="Sign out"
                    onClick={() =>
                      void act(() => signOutOfMcpServer(server.name))
                    }
                  >
                    <LogOut size={18} strokeWidth={1.5} />
                  </IconButton>
                )}
                {(server.state === 'failed' ||
                  server.state === 'connected') && (
                  <IconButton
                    label="Reconnect"
                    onClick={() =>
                      void act(() => reconnectMcpServer(server.name))
                    }
                  >
                    <Plug size={18} strokeWidth={1.5} />
                  </IconButton>
                )}
                {editable && definitions.data?.servers[server.name] && (
                  <>
                    <IconButton
                      label="Edit"
                      onClick={() =>
                        setEditing({
                          existing: {
                            name: server.name,
                            server: definitions.data!.servers[server.name]!,
                          },
                        })
                      }
                    >
                      <Pencil size={18} strokeWidth={1.5} />
                    </IconButton>
                    <IconButton
                      label="Remove"
                      variant="danger"
                      onClick={() => setRemoving(server.name)}
                    >
                      <Trash2 size={18} strokeWidth={1.5} />
                    </IconButton>
                  </>
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
                  checked={server.ask}
                  onChange={(e) =>
                    void act(() =>
                      setMcpSwitch(server.name, { ask: e.target.checked }),
                    )
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
                  checked={tool.enabled}
                  onChange={(e) =>
                    void act(() =>
                      setMcpSwitch(server.name, {
                        // The server's own name for it, not `<server>__<tool>`.
                        tool: {
                          name: tool.name.slice(server.name.length + 2),
                          enabled: e.target.checked,
                        },
                      }),
                    )
                  }
                />
              </Row>
            ))}
          </Section>
        )
      })}
      {editing && (
        <McpServerDialog
          open
          existing={editing.existing}
          onClose={() => setEditing(null)}
          onSave={async (name, server) => {
            try {
              await saveMcpServer(name, server)
            } catch (err) {
              return errorMessage(err)
            }
            await Promise.all([reload(), definitions.reload()])
            onToolsChanged()
            setEditing(null)
            return null
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing}?`}
        message="chibot stops using this server and deletes it from the config file, including its saved keys."
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          void act(() => removeMcpServer(removing!)).then(() =>
            definitions.reload(),
          )
        }
      />
    </>
  )
}
