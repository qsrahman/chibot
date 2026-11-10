import type { ToolInfo } from '../../shared/tools.ts'
import { withMember } from './mcp.ts'
import { mcpToolName } from './mcp.ts'
import type { SettingsApi } from './useSettings.ts'
import { Row, Section } from './parts.tsx'

/** A tool's row: its description and a switch that adds it to `disabledTools`. */
export function ToolSwitch({
  tool: { name, label, summary, unavailable },
  disabled,
  onChange,
}: {
  tool: ToolInfo
  disabled: string[]
  onChange: SettingsApi['update']
}) {
  return (
    <Row
      label={label}
      description={unavailable ?? summary}
      htmlFor={`setting-tool-${name}`}
      unavailable={unavailable !== null}
    >
      <input
        id={`setting-tool-${name}`}
        type="checkbox"
        role="switch"
        className="switch"
        disabled={unavailable !== null}
        checked={unavailable === null && !disabled.includes(name)}
        onChange={(e) =>
          void onChange({
            disabledTools: withMember(disabled, name, !e.target.checked),
          })
        }
      />
    </Row>
  )
}

/** chibot's own tools, by the section each says it belongs to. */
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
  const own = tools.filter(
    (tool) => !mcpToolName(tool.name) && tool.group !== 'Skills',
  )
  // The server sends them sorted: a section's tools are together.
  const groups = [...new Set(own.map((tool) => tool.group))]
  return (
    <>
      {own.length === 0 && (
        <p className="settings-empty">This server offers no tools.</p>
      )}
      {groups.map((group) => (
        <Section key={group} title={group}>
          {own
            .filter((tool) => tool.group === group)
            .map((tool) => (
              <ToolSwitch
                key={tool.name}
                tool={tool}
                disabled={disabled}
                onChange={onChange}
              />
            ))}
        </Section>
      ))}
    </>
  )
}
