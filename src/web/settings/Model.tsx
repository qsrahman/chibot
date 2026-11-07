import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { effortLabel, REASONING_EFFORTS } from '../../shared/reasoning.ts'
import type { Settings } from '../../shared/settings.ts'
import type { SettingsApi } from './useSettings.ts'
import { modelWindow } from './api.ts'
import { Row, Section } from './parts.tsx'

type NumberSetting =
  'contextWindow' | 'compactAt' | 'compactReserve' | 'keepRecent'

export function Model({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: SettingsApi['update']
}) {
  // What the server says about the chat model's window, when it says.
  const [reported, setReported] = useState<number | null>(null)
  useEffect(() => {
    let current = true
    setReported(null)
    modelWindow(settings.model).then(
      ({ window }) => current && setReported(window),
      () => {},
    )
    return () => {
      current = false
    }
  }, [settings.model])

  return (
    <>
      <Section title="Reasoning">
        <Row
          label="Reasoning effort"
          description="How hard reasoning models think. Models without reasoning ignore it."
          htmlFor="setting-effort"
        >
          <select
            id="setting-effort"
            value={settings.reasoningEffort ?? 'default'}
            onChange={(e) =>
              void onChange({
                reasoningEffort:
                  e.target.value === 'default'
                    ? null
                    : (e.target.value as Settings['reasoningEffort']),
              })
            }
          >
            <option value="default">{effortLabel(null)}</option>
            {REASONING_EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {effortLabel(effort)}
              </option>
            ))}
          </select>
        </Row>
      </Section>
      <Section title="Long chats">
        <Row
          label="Summarize long chats"
          description="When a chat nears the context window, the chat model writes a summary of the earlier messages, so it keeps working. The messages stay; Undo brings them back."
          htmlFor="setting-compact"
        >
          <input
            id="setting-compact"
            type="checkbox"
            role="switch"
            className="switch"
            checked={settings.autoCompact}
            onChange={(e) => void onChange({ autoCompact: e.target.checked })}
          />
        </Row>
        <NumberRow
          id="setting-window"
          label="Context window"
          description="Tokens the model reads at most. Servers don't say, so set it to the model's: for Ollama, no more than its num_ctx, or it silently cuts the start of the chat."
          setting="contextWindow"
          settings={settings}
          min={2000}
          step={1000}
          onChange={onChange}
          suggestion={
            reported !== null && reported !== settings.contextWindow
              ? { value: reported, from: settings.model }
              : null
          }
        />
        {settings.autoCompact && (
          <>
            <SummaryModelRow settings={settings} onChange={onChange} />
            <NumberRow
              id="setting-compact-at"
              label="Summarize at (%)"
              description="Share of the window at which earlier messages are summarized."
              setting="compactAt"
              settings={settings}
              min={10}
              max={95}
              step={5}
              onChange={onChange}
            />
            <NumberRow
              id="setting-reserve"
              label="Reserve"
              description="Tokens kept free for the answer. Summarizing starts when less than this is left."
              setting="compactReserve"
              settings={settings}
              min={0}
              step={1000}
              onChange={onChange}
            />
            <NumberRow
              id="setting-keep"
              label="Keep recent"
              description="Tokens of the newest messages that stay word for word, at most half of where summarizing starts."
              setting="keepRecent"
              settings={settings}
              min={500}
              step={1000}
              onChange={onChange}
            />
          </>
        )}
      </Section>
    </>
  )
}

/** A whole-number setting, saved when the box loses focus or on Enter. */
function NumberRow({
  id,
  label,
  description,
  setting,
  settings,
  min,
  max,
  step,
  onChange,
  suggestion = null,
}: {
  id: string
  label: string
  description: string
  setting: NumberSetting
  settings: Settings
  min: number
  max?: number
  step: number
  onChange: SettingsApi['update']
  /** A value the server reports, offered with one click. */
  suggestion?: { value: number; from: string } | null
}) {
  const current = settings[setting]
  const [draft, setDraft] = useState(String(current))

  function save() {
    const value = Number(draft)
    if (
      Number.isInteger(value) &&
      value >= min &&
      (max === undefined || value <= max)
    ) {
      if (value !== current) void onChange({ [setting]: value })
    } else {
      setDraft(String(current))
    }
  }

  return (
    <Row label={label} description={description} htmlFor={id}>
      <input
        id={id}
        className="settings-number"
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      {suggestion && (
        <button
          type="button"
          className="button"
          title={`What the server reports for ${suggestion.from}`}
          onClick={() => {
            setDraft(String(suggestion.value))
            void onChange({ [setting]: suggestion.value })
          }}
        >
          <Check size={16} strokeWidth={1.5} aria-hidden /> Use{' '}
          {suggestion.value.toLocaleString()}
        </button>
      )}
    </Row>
  )
}

/** The model that writes summaries; empty uses the chat's own. */
function SummaryModelRow({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: SettingsApi['update']
}) {
  const [draft, setDraft] = useState(settings.summaryModel)

  function save() {
    const next = draft.trim()
    if (next !== settings.summaryModel) void onChange({ summaryModel: next })
  }

  return (
    <Row
      label="Summary model"
      description="A model on the same server to write summaries, for example a smaller, faster one. Empty uses the chat's model."
      htmlFor="setting-summary-model"
    >
      <input
        id="setting-summary-model"
        type="text"
        value={draft}
        placeholder={settings.model}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
    </Row>
  )
}
