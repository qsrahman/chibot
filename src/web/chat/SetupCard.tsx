import type { SetupProblem } from './recents.ts'
import { CopyButton } from './MessageActions.tsx'

const WORDS: Record<SetupProblem, { title: string; body: string }> = {
  missing: {
    title: 'chibot needs a model before it can answer',
    body: 'No model server or API key is set up yet. Use either of these in a terminal, then restart chibot.',
  },
  rejected: {
    title: 'The model server refused the API key',
    body: 'The key is wrong, expired or not allowed to use this model. Set it again with either of these, then restart chibot.',
  },
  unreachable: {
    title: 'chibot could not reach the model server',
    body: 'Check that the server is running and its address is right. Set the address again with either of these, then restart chibot.',
  },
}

/** The same style as an answer's code blocks: a label, the command and Copy. */
function Command({ label, text }: { label: string; text: string }) {
  return (
    <div className="markdown">
      <div className="code-block">
        <div className="code-header">
          <span className="code-label">{label}</span>
          <span className="code-actions">
            <CopyButton text={text} label={`Copy ${text}`} />
          </span>
        </div>
        <div className="code-body">
          <pre>
            <code>{text}</code>
          </pre>
        </div>
      </div>
    </div>
  )
}

/** What to do when chibot has nothing to answer with (never shows a key). */
export function SetupCard({ problem }: { problem: SetupProblem }) {
  const { title, body } = WORDS[problem]
  return (
    <section className="setup-card" aria-label="Set up a model">
      <h2>{title}</h2>
      <p>{body}</p>
      <Command label="Guided" text="chibot init" />
      <Command
        label="Directly"
        text={
          problem === 'unreachable'
            ? 'chibot config set chat.baseURL <address>'
            : 'chibot config set chat.apiKey <key>'
        }
      />
    </section>
  )
}
