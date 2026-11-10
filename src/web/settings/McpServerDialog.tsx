import { useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { IconButton } from '../ui/IconButton.tsx'
import type { McpServerConfig } from '../../shared/mcp.ts'
import { MCP_PRESETS, type McpPreset } from '../../shared/mcp-presets.ts'
import { Dialog } from '../ui/Dialog.tsx'

type Pair = { key: string; value: string }

interface Form {
  name: string
  type: 'local' | 'remote'
  command: string
  /** One per line. */
  args: string
  cwd: string
  url: string
  /** `env` for a local server, `headers` for a remote one. */
  pairs: Pair[]
}

const blank: Form = {
  name: '',
  type: 'local',
  command: '',
  args: '',
  cwd: '',
  url: '',
  pairs: [],
}

const toPairs = (values: Record<string, string> | undefined): Pair[] =>
  Object.entries(values ?? {}).map(([key, value]) => ({ key, value }))

function toForm(name: string, server: McpServerConfig): Form {
  return server.type === 'local'
    ? {
        ...blank,
        name,
        command: server.command,
        args: (server.args ?? []).join('\n'),
        cwd: server.cwd ?? '',
        pairs: toPairs(server.env),
      }
    : {
        ...blank,
        name,
        type: 'remote',
        url: server.url,
        pairs: toPairs(server.headers),
      }
}

function toServer(form: Form): McpServerConfig {
  const pairs = Object.fromEntries(
    form.pairs
      .filter(({ key }) => key.trim() !== '')
      .map(({ key, value }) => [key.trim(), value]),
  )
  const some = Object.keys(pairs).length > 0
  return form.type === 'local'
    ? {
        type: 'local',
        command: form.command.trim(),
        ...(form.args.trim() && {
          args: form.args.split('\n').filter((line) => line.trim() !== ''),
        }),
        ...(form.cwd.trim() && { cwd: form.cwd.trim() }),
        ...(some && { env: pairs }),
      }
    : {
        type: 'remote',
        url: form.url.trim(),
        ...(some && { headers: pairs }),
      }
}

/**
 * Adds an MCP server, or changes one (`existing`: its name and definition,
 * with secret values blank). A blank secret value keeps the saved one.
 */
export function McpServerDialog({
  open,
  existing,
  onSave,
  onClose,
}: {
  open: boolean
  existing: { name: string; server: McpServerConfig } | null
  /** Resolves to an error message, or `null` once saved. */
  onSave: (name: string, server: McpServerConfig) => Promise<string | null>
  onClose: () => void
}) {
  const editing = existing !== null
  const [form, setForm] = useState<Form>(
    existing ? toForm(existing.name, existing.server) : blank,
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const set = (change: Partial<Form>) => setForm({ ...form, ...change })
  const remote = form.type === 'remote'
  const secrets = remote ? 'Headers' : 'Environment variables'

  function applyPreset(preset: McpPreset | undefined) {
    setNote(preset?.note ?? null)
    setForm(preset ? toForm(preset.name, preset.server) : blank)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(await onSave(form.name.trim(), toServer(form)))
    setSaving(false)
  }

  const setPair = (index: number, change: Partial<Pair>) =>
    set({
      pairs: form.pairs.map((pair, i) =>
        i === index ? { ...pair, ...change } : pair,
      ),
    })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${existing.name}` : 'Add an MCP server'}
      className="mcp-dialog"
    >
      <form className="mcp-form" onSubmit={(e) => void submit(e)}>
        <div className="mcp-fields">
          {!editing && (
            <label>
              Start from
              <select
                className="dialog-input"
                defaultValue=""
                onChange={(e) =>
                  applyPreset(MCP_PRESETS.find((p) => p.id === e.target.value))
                }
              >
                <option value="">Custom</option>
                {MCP_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="mcp-row2">
            <label>
              Name
              <input
                className="dialog-input"
                value={form.name}
                disabled={editing}
                required
                maxLength={32}
                pattern="[A-Za-z0-9_\-]+"
                title="Letters, digits, - and _"
                onChange={(e) => set({ name: e.target.value })}
              />
            </label>
            {!editing && (
              <label>
                Kind
                <select
                  className="dialog-input"
                  value={form.type}
                  onChange={(e) =>
                    set({ type: e.target.value as Form['type'], pairs: [] })
                  }
                >
                  <option value="local">Local: a command chibot runs</option>
                  <option value="remote">Remote: a URL</option>
                </select>
              </label>
            )}
          </div>
          {remote ? (
            <label>
              URL
              <input
                className="dialog-input"
                type="url"
                required
                value={form.url}
                placeholder="https://example.com/mcp"
                onChange={(e) => set({ url: e.target.value })}
              />
            </label>
          ) : (
            <>
              <div className="mcp-row2">
                <label>
                  Command
                  <input
                    className="dialog-input"
                    required
                    value={form.command}
                    placeholder="npx"
                    onChange={(e) => set({ command: e.target.value })}
                  />
                </label>
                <label>
                  Working folder (optional)
                  <input
                    className="dialog-input"
                    value={form.cwd}
                    onChange={(e) => set({ cwd: e.target.value })}
                  />
                </label>
              </div>
              <label>
                Arguments, one per line
                <textarea
                  className="dialog-input"
                  rows={3}
                  value={form.args}
                  onChange={(e) => set({ args: e.target.value })}
                />
              </label>
            </>
          )}
          <fieldset className="mcp-pairs">
            <legend>{secrets}</legend>
            {form.pairs.map((pair, index) => (
              <div className="mcp-pair" key={index}>
                <input
                  className="dialog-input"
                  aria-label={`${secrets} name ${index + 1}`}
                  value={pair.key}
                  placeholder={remote ? 'Authorization' : 'API_KEY'}
                  onChange={(e) => setPair(index, { key: e.target.value })}
                />
                <input
                  className="dialog-input"
                  type="password"
                  autoComplete="off"
                  aria-label={`${secrets} value ${index + 1}`}
                  value={pair.value}
                  placeholder={
                    editing && pair.value === '' ? 'Saved (hidden)' : 'Value'
                  }
                  onChange={(e) => setPair(index, { value: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${pair.key || 'row'}`}
                  title="Remove"
                  onClick={() =>
                    set({ pairs: form.pairs.filter((_, i) => i !== index) })
                  }
                >
                  <X size={18} strokeWidth={1.5} />
                </button>
              </div>
            ))}
            <IconButton
              label="Add"
              hint="Add a variable"
              onClick={() =>
                set({ pairs: [...form.pairs, { key: '', value: '' }] })
              }
            >
              <Plus size={18} strokeWidth={1.5} />
            </IconButton>
            <p className="mcp-hint">
              Keys go here, not in the arguments or URL: values are kept in
              config.json and never shown again. Leave a saved value blank to
              keep it.
            </p>
          </fieldset>
          {!remote && (
            <p className="mcp-hint">
              A local server is a program that runs on this machine with your
              rights. Add only ones you trust.
            </p>
          )}
          {note && <p className="mcp-hint">{note}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {editing ? 'Save' : 'Add server'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
