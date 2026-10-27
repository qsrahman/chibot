import { withMember } from '../mcp.ts'
import { TOOL_GROUPS, TOOL_TEXT } from '../tools.ts'
import { mcpToolName } from '../turns.ts'
import type { SettingsApi } from '../useSettings.ts'
import { Row, Section } from './parts.tsx'

export function Tools({
  tools,
  disabled,
  onChange,
}: {
  tools: SettingsApi['tools']
  disabled: string[]
  onChange: SettingsApi['update']
}) {
  // MCP servers' tools (`<server>__<tool>`) are listed with their server.
  tools = tools.filter((tool) => !mcpToolName(tool.name))
  const offered = new Set(tools.map((tool) => tool.name))
  // Known tools the server doesn't offer are listed too, saying what's
  // missing, so they can be found.
  const missing = Object.entries(TOOL_TEXT).flatMap(([name, text]) =>
    !offered.has(name) && text.setup ? [{ name, text }] : [],
  )
  const order = Object.keys(TOOL_TEXT)
  const rank = (name: string) =>
    order.includes(name) ? order.indexOf(name) : order.length
  const groups = [...TOOL_GROUPS, 'Other'].map((group) => ({
    group,
    rows: [
      ...tools.flatMap((tool) =>
        (TOOL_TEXT[tool.name]?.group ?? 'Other') === group ? [tool] : [],
      ),
      ...missing.flatMap(({ name, text }) =>
        text.group === group ? [{ name, label: text.label }] : [],
      ),
    ].sort((a, b) => rank(a.name) - rank(b.name)),
  }))
  return (
    <>
      {tools.length === 0 && missing.length === 0 && (
        <p className="settings-empty">This server offers no tools.</p>
      )}
      {groups.map(
        ({ group, rows }) =>
          rows.length > 0 && (
            <Section key={group} title={group}>
              {rows.map(({ name, label }) => {
                const available = offered.has(name)
                return (
                  <Row
                    key={name}
                    label={TOOL_TEXT[name]?.label ?? label}
                    description={
                      available
                        ? TOOL_TEXT[name]?.description
                        : TOOL_TEXT[name]?.setup
                    }
                    htmlFor={`setting-tool-${name}`}
                    unavailable={!available}
                  >
                    <input
                      id={`setting-tool-${name}`}
                      type="checkbox"
                      role="switch"
                      className="switch"
                      disabled={!available}
                      checked={available && !disabled.includes(name)}
                      onChange={(e) =>
                        void onChange({
                          disabledTools: withMember(
                            disabled,
                            name,
                            !e.target.checked,
                          ),
                        })
                      }
                    />
                  </Row>
                )
              })}
            </Section>
          ),
      )}
    </>
  )
}
