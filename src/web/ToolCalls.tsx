// An answer's tool calls: a collapsed row each (or one group), opening to
// what was asked and what came back.
import { useContext } from 'react'
import type { ToolInfo } from '../shared/tools.ts'
import { SourceLink } from './Sources.tsx'
import { Summary } from './Summary.tsx'
import { ToolInfoContext } from './toolInfo.ts'
import { mcpToolName, summarizeTool, type ToolActivity } from './turns.ts'

/**
 * What a tool call shows while it runs, and once it's done: the words the
 * tool gave itself. An MCP server's tool is named from its name (the list may
 * predate a reload), and a tool the server no longer has by its raw name.
 */
function labelsOf(
  name: string,
  infos: ToolInfo[],
): [running: string, done: string] {
  const mcp = mcpToolName(name)
  if (mcp) {
    const label = `${mcp.tool} · ${mcp.server}`
    return [`Running ${label}…`, `Used ${label}`]
  }
  const info = infos.find((tool) => tool.name === name)
  return info ? [info.running, info.done] : [`Running ${name}…`, `Used ${name}`]
}

/**
 * An answer's tool calls. Several sit in one collapsed group, labelled with
 * what they did ("Searched the web, Memory updated": a memory change stays
 * visible) or, while one runs, with what it's doing; each opens on its own.
 */
export function ToolCalls({ tools }: { tools: ToolActivity[] }) {
  const infos = useContext(ToolInfoContext)
  if (tools.length === 0) return null
  if (tools.length === 1) return <ToolCall tool={tools[0]!} />
  const running = tools.find((tool) => tool.output === null)
  const label = running
    ? labelsOf(running.name, infos)[0]
    : [...new Set(tools.map((tool) => labelsOf(tool.name, infos)[1]))].join(
        ', ',
      )
  return (
    <details className="thoughts tool-calls">
      <Summary live={running !== undefined}>{label}</Summary>
      <div className="thoughts-body tool-call-list">
        {tools.map((tool) => (
          <ToolCall key={tool.callId} tool={tool} />
        ))}
      </div>
    </details>
  )
}

function ToolCall({ tool }: { tool: ToolActivity }) {
  const infos = useContext(ToolInfoContext)
  const running = tool.output === null
  const [busyLabel, doneLabel] = labelsOf(tool.name, infos)
  return (
    <details className="thoughts tool-call">
      <Summary live={running}>{running ? busyLabel : doneLabel}</Summary>
      <div className="thoughts-body">
        <ToolDetails tool={tool} />
      </div>
    </details>
  )
}

/** What a tool did, in plain terms, with its raw call one click away. */
export function ToolDetails({ tool }: { tool: ToolActivity }) {
  const summary = summarizeTool(tool)
  if (!summary) return <RawToolCall tool={tool} />
  const { input, result, links } = summary
  return (
    <div className="tool-summary">
      {input && <p className="tool-input">{input}</p>}
      {result && <p className="tool-result">{result}</p>}
      {links.length > 0 && (
        <ul className="source-list">
          {links.map((source) => (
            <li key={source.url}>
              <SourceLink source={source} />
            </li>
          ))}
        </ul>
      )}
      <details className="tool-raw">
        <Summary>Raw</Summary>
        <RawToolCall tool={tool} />
      </details>
    </div>
  )
}

/** A tool call's arguments and output as they were sent. */
function RawToolCall({ tool }: { tool: ToolActivity }) {
  return (
    <dl className="tool-details">
      <dt>Arguments</dt>
      <dd>
        <pre>{prettyJson(tool.arguments)}</pre>
      </dd>
      {tool.output !== null && (
        <>
          <dt>Result</dt>
          <dd>
            <pre>{tool.output}</pre>
          </dd>
        </>
      )}
    </dl>
  )
}

/** Indented JSON when `text` is JSON, else `text` as is. */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
