import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ServiceModel } from '../../shared/service-models.ts'
import type { Settings } from '../../shared/settings.ts'
import type { SettingsApi } from './useSettings.ts'
import { IconButton } from '../ui/IconButton.tsx'
import { Row, Section } from './parts.tsx'

// The chat model is picked above the chat; these are the models behind
// features, on the servers named in chibot's config (their addresses and keys stay there).
const SERVICES: {
  setting: ServiceModel
  section: string
  label: string
  description: string
  /** What to set (with `chibot config set`) for it to have a server. */
  configure: string
  example: string
}[] = [
  {
    setting: 'imageModel',
    section: 'Images',
    label: 'Image model',
    description: 'Creates and edits images. Empty turns image tools off.',
    configure: 'image.baseURL or image.apiKey',
    example: 'gpt-image-2',
  },
  {
    setting: 'embeddingModel',
    section: 'Project search',
    label: 'Embedding model',
    description:
      'Finds project files by meaning. Empty searches by keywords only; changing it indexes the files again.',
    configure: 'embedding.baseURL or embedding.apiKey',
    example: 'text-embedding-3-small',
  },
  {
    setting: 'transcribeModel',
    section: 'Voice input',
    label: 'Transcription model',
    description: 'Turns a recording into text. Empty turns the microphone off.',
    configure: 'transcription.baseURL or transcription.apiKey',
    example: 'gpt-transcribe',
  },
]

/** The models of the features beyond chat. */
export function OtherModels({
  settings,
  defaults,
  endpoints,
  onChange,
}: {
  settings: Settings
  defaults: Settings
  endpoints: Record<ServiceModel, boolean>
  onChange: SettingsApi['update']
}) {
  return (
    <>
      {SERVICES.map((service) => (
        <Section key={service.setting} title={service.section}>
          <ModelRow
            {...service}
            value={settings[service.setting]}
            fallback={defaults[service.setting]}
            connected={endpoints[service.setting]}
            onSave={(value) => onChange({ [service.setting]: value })}
          />
        </Section>
      ))}
    </>
  )
}

function ModelRow({
  setting,
  label,
  description,
  configure,
  example,
  value,
  fallback,
  connected,
  onSave,
}: (typeof SERVICES)[number] & {
  value: string
  /** What the config gives (or the built-in default); `''` for none. */
  fallback: string
  connected: boolean
  onSave: (value: string) => Promise<boolean>
}) {
  const id = `setting-${setting}`
  const [draft, setDraft] = useState(value)
  // Follows the saved value (a reset, or another tab's change).
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }

  async function save() {
    const next = draft.trim()
    if (next === value) return setDraft(value)
    if (!(await onSave(next))) setDraft(value)
  }

  return (
    <Row
      label={label}
      description={
        connected
          ? description
          : `Needs ${configure}: run chibot config set, then restart chibot.`
      }
      htmlFor={id}
      unavailable={!connected}
    >
      <div className="settings-controls">
        {connected && value !== fallback && (
          <IconButton
            label="Reset to the default"
            onClick={() => void onSave(fallback)}
          >
            <RotateCcw size={18} strokeWidth={1.5} />
          </IconButton>
        )}
        <input
          id={id}
          className="settings-text"
          value={draft}
          disabled={!connected}
          placeholder={fallback || example}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
      </div>
    </Row>
  )
}
