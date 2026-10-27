import { useState } from 'react'
import { effortLabel, REASONING_EFFORTS } from '../../shared/reasoning.ts'
import type { Settings } from '../../shared/settings.ts'
import type { SettingsApi } from '../useSettings.ts'
import { Row, Section } from './parts.tsx'

export function Model({
  settings,
  defaults,
  onChange,
}: {
  settings: Settings
  defaults: Settings
  onChange: SettingsApi['update']
}) {
  const threshold = settings.compactThreshold
  const [draft, setDraft] = useState(
    String(threshold ?? defaults.compactThreshold ?? 64_000),
  )

  function saveThreshold() {
    const value = Number(draft)
    if (Number.isInteger(value) && value >= 1000 && value !== threshold) {
      void onChange({ compactThreshold: value })
    } else {
      setDraft(String(threshold))
    }
  }

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
          label="Compact long chats"
          description="Summarizes earlier messages when a chat gets long, so it keeps working."
          htmlFor="setting-compact"
        >
          <input
            id="setting-compact"
            type="checkbox"
            role="switch"
            className="switch"
            checked={threshold !== null}
            onChange={(e) =>
              void onChange({
                compactThreshold: e.target.checked
                  ? Number(draft) || defaults.compactThreshold
                  : null,
              })
            }
          />
        </Row>
        {threshold !== null && (
          <Row
            label="Compact after"
            description="Tokens of context before compacting."
            htmlFor="setting-threshold"
          >
            <input
              id="setting-threshold"
              className="settings-number"
              type="number"
              min={1000}
              step={1000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveThreshold}
              onKeyDown={(e) => e.key === 'Enter' && saveThreshold()}
            />
          </Row>
        )}
      </Section>
    </>
  )
}
