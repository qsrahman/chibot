import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Globe, ImagePlus, MessageCircleDashed, PanelLeft } from 'lucide-react'
import type { Health } from '../shared/types.ts'
import { Composer, type ToolOption } from './Composer.tsx'
import { ModelPicker } from './ModelPicker.tsx'
import { ProjectDetails, ProjectHeading } from './ProjectHome.tsx'
import { SHORTCUTS, useShortcuts } from './shortcuts.ts'
import { waitingCalls } from './turns.ts'
import { ApprovalCard, TurnView } from './TurnView.tsx'
import { describeUsage } from './usage.ts'
import { useAttachments } from './useAttachments.ts'
import { useChat } from './useChat.ts'
import type { ProjectsApi } from './useProjects.ts'
import type { SettingsApi } from './useSettings.ts'

/** Tools the composer's "+" menu offers, when the server has them. */
const COMPOSER_TOOLS: ToolOption[] = [
  {
    name: 'web_search',
    label: 'Search the web',
    chip: 'Search',
    icon: <Globe size={18} strokeWidth={1.5} aria-hidden />,
  },
  {
    name: 'generate_image',
    label: 'Create an image',
    chip: 'Image',
    icon: <ImagePlus size={18} strokeWidth={1.5} aria-hidden />,
  },
]

interface Props {
  health: Health | undefined
  settings: SettingsApi
  projects: ProjectsApi
  onListChanged: () => void
  /** On phones while the sidebar is hidden: a header button opens it. */
  onOpenSidebar?: () => void
}

export function ChatPage({
  health,
  settings,
  projects,
  onListChanged,
  onOpenSidebar,
}: Props) {
  // `projectId`: a project's page, where a new chat starts in the project.
  const { id, projectId: projectHome } = useParams()
  const navigate = useNavigate()
  // Chosen on a new chat before the first message; applies to that chat.
  const [temporaryMode, setTemporaryMode] = useState(false)
  const chat = useChat(id, {
    onCreated: (newId) => navigate(`/c/${newId}`),
    onListChanged,
    temporary: temporaryMode,
    projectId: projectHome,
  })
  const { turns, pending, error, isTemporary, busy } = chat
  const attachments = useAttachments()
  const [dragging, setDragging] = useState(false)
  const waiting = pending ? [] : waitingCalls(turns)
  const toolOptions = COMPOSER_TOOLS.filter(
    ({ name }) =>
      settings.tools.some((tool) => tool.name === name) &&
      !settings.settings?.disabledTools.includes(name),
  )
  const chatUsage = describeUsage(chat.usage)
  const endRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // Follow the answer only while the user is at the bottom, so scrolling up
  // to read isn't undone by every new token.
  const followRef = useRef(true)

  useEffect(() => {
    followRef.current = true
    // A new chat starts as a normal one again.
    if (!id) setTemporaryMode(false)
  }, [id])

  const follow = () => {
    if (followRef.current) endRef.current?.scrollIntoView({ block: 'end' })
  }
  useEffect(follow, [turns, pending])

  useShortcuts({
    [SHORTCUTS.focusComposer.keys]: (e) => {
      e.preventDefault()
      composerRef.current?.focus()
    },
    [SHORTCUTS.copyLastAnswer.keys]: (e) => {
      const text = turns.at(-1)?.answer?.text
      if (!text) return
      e.preventDefault()
      void navigator.clipboard.writeText(text).catch(() => {})
    },
    [SHORTCUTS.stop.keys]: () => {
      // Esc in a dialog closes the dialog; it shouldn't also stop the answer.
      if (busy && !document.querySelector('dialog[open]')) chat.stop()
    },
  })

  /** Wraps an action that starts a turn: the view follows its answer. */
  function following<A extends unknown[]>(action: (...args: A) => unknown) {
    return (...args: A) => {
      followRef.current = true
      void action(...args)
    }
  }

  const dropping = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const dragHandlers = {
    onDragOver: (e: DragEvent) => {
      if (!dropping(e) || e.defaultPrevented) return
      e.preventDefault()
      setDragging(true)
    },
    onDragLeave: (e: DragEvent) => {
      // Leaving for a child element isn't leaving the page.
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        setDragging(false)
      }
    },
    onDrop: (e: DragEvent) => {
      setDragging(false)
      // A project's file list handles its own drops.
      if (e.defaultPrevented) return
      e.preventDefault()
      attachments.add([...e.dataTransfer.files])
      composerRef.current?.focus()
    },
  }

  // An empty chat centres the composer under a greeting, as ChatGPT does.
  // The composer stays the third child either way, so it keeps its focus
  // and text when the first message moves it to the bottom.
  const empty = turns.length === 0 && !pending && !error
  const temporary = id ? isTemporary : temporaryMode
  const projectId = id ? chat.projectId : (projectHome ?? null)
  const project = projects.projects.find((p) => p.id === projectId)

  return (
    <main
      className={[
        'chat',
        empty && 'empty',
        empty && projectHome && 'project-home',
        dragging && 'dragging',
      ]
        .filter(Boolean)
        .join(' ')}
      {...dragHandlers}
    >
      <header className="topbar">
        <span className="topbar-start">
          {onOpenSidebar && (
            <button
              type="button"
              className="icon-button"
              aria-label="Open sidebar"
              onClick={onOpenSidebar}
            >
              <PanelLeft size={20} strokeWidth={1.5} />
            </button>
          )}
          {id && project && (
            <Link className="breadcrumb" to={`/projects/${project.id}`}>
              {project.name} /
            </Link>
          )}
          {!health ? (
            <span className="model">Server unreachable</span>
          ) : settings.settings && settings.defaults ? (
            <span title={health.baseURL ?? 'OpenAI'}>
              <ModelPicker
                model={settings.settings.model}
                defaultModel={settings.defaults.model}
                onSelect={(model) => void settings.update({ model })}
                effort={settings.settings.reasoningEffort}
                onEffort={(reasoningEffort) =>
                  void settings.update({ reasoningEffort })
                }
              />
            </span>
          ) : null}
        </span>
        {projectHome ? null : id ? (
          <span className="topbar-info">
            {chatUsage && (
              <span
                className="usage"
                title={`This chat, all versions: ${chatUsage.detail}`}
              >
                {chatUsage.short}
              </span>
            )}
            {temporary && <span className="badge">Temporary chat</span>}
          </span>
        ) : (
          <button
            type="button"
            className={temporaryMode ? 'icon-button active' : 'icon-button'}
            aria-label="Temporary chat"
            aria-pressed={temporaryMode}
            title="Temporary chat"
            onClick={() => setTemporaryMode((on) => !on)}
          >
            <MessageCircleDashed size={20} strokeWidth={1.5} />
          </button>
        )}
      </header>
      {empty && projectHome ? (
        project ? (
          <ProjectHeading
            project={project}
            onRename={(name) => void projects.rename(project.id, name)}
            onDelete={() =>
              void projects.remove(project.id).then((gone) => {
                if (gone) navigate('/')
              })
            }
          />
        ) : (
          <div className="greeting">
            <h1>{projects.error ?? ''}</h1>
          </div>
        )
      ) : empty ? (
        <div className="greeting">
          <h1>{temporary ? 'Temporary chat' : 'What’s on your mind?'}</h1>
          {temporary && (
            <p>
              This chat won’t appear in your history or search, and it’s deleted
              when you leave it.
            </p>
          )}
        </div>
      ) : (
        <div
          className="messages"
          onScroll={(e) => {
            const el = e.currentTarget
            followRef.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
          <div className="thread">
            {turns.map((turn, i) => (
              <TurnView
                key={turn.key}
                turn={turn}
                latest={!pending && i === turns.length - 1}
                busy={busy}
                approval={
                  i === turns.length - 1 && waiting.length > 0 ? (
                    <ApprovalCard
                      calls={waiting}
                      busy={busy}
                      onAnswer={following(chat.approve)}
                    />
                  ) : undefined
                }
                onEdit={following((text: string) => chat.edit(i, text))}
                onRegenerate={following(() => chat.regenerate(i))}
                onSwitch={(itemId) => void chat.switchVersion(itemId)}
                onImageLoad={follow}
              />
            ))}
            {pending && (
              <TurnView turn={pending.turn} pending onImageLoad={follow} />
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div ref={endRef} />
          </div>
        </div>
      )}
      <Composer
        busy={busy}
        onSend={following(chat.send)}
        onStop={chat.stop}
        inputRef={composerRef}
        tools={toolOptions}
        attachments={attachments}
        transcription={health?.features.transcription ?? false}
      />
      {empty && projectHome && (
        <ProjectDetails
          projectId={projectHome}
          onChatsChanged={onListChanged}
        />
      )}
      <p className="disclaimer">
        chibot can make mistakes. Check important info.
      </p>
    </main>
  )
}
