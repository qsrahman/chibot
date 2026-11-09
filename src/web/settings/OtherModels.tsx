import { Fragment, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { suggestedPrefixes } from '../../shared/embedding-prefixes.ts'
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
    setting: 'rerankModel',
    section: 'Project search',
    label: 'Reranking model',
    description:
      'Reorders the best passages of a search by how well each answers the question, on a server with a /rerank route (llama.cpp, vLLM, Jina, Cohere). Empty keeps the order keywords and meaning give.',
    configure: 'rerank.baseURL',
    example: 'bge-reranker-v2-m3',
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
      {[...new Set(SERVICES.map((s) => s.section))].map((section) => (
        <Section key={section} title={section}>
          {SERVICES.filter((s) => s.section === section).map((service) => (
            <Fragment key={service.setting}>
              <ModelRow
                {...service}
                value={settings[service.setting]}
                fallback={defaults[service.setting]}
                connected={endpoints[service.setting]}
                onSave={(value) => onChange({ [service.setting]: value })}
              />
              {service.setting === 'embeddingModel' &&
                endpoints.embeddingModel &&
                settings.embeddingModel && (
                  <Prefixes settings={settings} onChange={onChange} />
                )}
            </Fragment>
          ))}
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

/**
 * The text some embedding models expect before a question and before each file
 * chunk (nomic-embed-text, embeddinggemma, e5…). Saved on leaving the box;
 * the chunk one indexes the files again, the question one changes nothing stored.
 */
function Prefixes({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: SettingsApi['update']
}) {
  const known = suggestedPrefixes(settings.embeddingModel)
  const differs =
    known !== null &&
    (known.query !== settings.embeddingQueryPrefix ||
      known.document !== settings.embeddingDocumentPrefix)
  return (
    <>
      <PrefixRow
        id="setting-embedding-query-prefix"
        label="Text before a question"
        description="Some embedding models expect a short instruction before the question (nomic-embed-text: “search_query: ”). Empty for models that take plain text, such as OpenAI's."
        value={settings.embeddingQueryPrefix}
        onSave={(value) => onChange({ embeddingQueryPrefix: value })}
        suggestion={known?.query}
      />
      <PrefixRow
        id="setting-embedding-document-prefix"
        label="Text before each file part"
        description="The matching instruction for the files (“search_document: ”). Changing it indexes the files again."
        value={settings.embeddingDocumentPrefix}
        onSave={(value) => onChange({ embeddingDocumentPrefix: value })}
        suggestion={known?.document}
      />
      {differs && (
        <Row
          label={`Use what ${settings.embeddingModel} expects`}
          description="Fills both boxes with the text its maker asks for."
        >
          <button
            type="button"
            className="button"
            onClick={() =>
              void onChange({
                embeddingQueryPrefix: known.query,
                embeddingDocumentPrefix: known.document,
              })
            }
          >
            <Check size={16} strokeWidth={1.5} aria-hidden /> Use
          </button>
        </Row>
      )}
    </>
  )
}

function PrefixRow({
  id,
  label,
  description,
  value,
  onSave,
  suggestion,
}: {
  id: string
  label: string
  description: string
  value: string
  onSave: (value: string) => Promise<boolean>
  /** What the model's maker asks for, shown while the box is empty. */
  suggestion: string | undefined
}) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }
  async function save() {
    // Not trimmed: the space after the colon is part of it.
    if (draft === value) return
    if (!(await onSave(draft))) setDraft(value)
  }
  return (
    <Row label={label} description={description} htmlFor={id}>
      <input
        id={id}
        className="settings-text"
        value={draft}
        placeholder={suggestion || 'none'}
        spellCheck={false}
        autoCapitalize="none"
        autoComplete="off"
        maxLength={200}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
      />
    </Row>
  )
}
