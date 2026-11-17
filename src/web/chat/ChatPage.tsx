import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowDown } from 'lucide-react'
import type { ConversationListItem, Health } from '../../shared/types.ts'
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx'
import { ChatTopBar } from './ChatTopBar.tsx'
import { FindBar } from './FindBar.tsx'
import { OutlineMenu } from './OutlineMenu.tsx'
import { Composer } from './Composer.tsx'
import { FollowUps } from './FollowUps.tsx'
import { shownSuggestions } from './followUps.ts'
import { useFollowUps } from './useFollowUps.ts'
import { Greeting, Recents } from './Greeting.tsx'
import { SetupCard } from './SetupCard.tsx'
import { emptyState, recentChats, recentProjects } from './recents.ts'
import { quoteText } from './quote.ts'
import { QuoteSelection } from './QuoteSelection.tsx'
import { branchConversation } from '../conversations/api.ts'
import { useToast } from '../ui/toast.tsx'
import { ConnectionBanner } from '../ui/ConnectionBanner.tsx'
import type { Connection } from '../ui/useReconnect.ts'
import { ProjectDetails } from '../projects/ProjectDetails.tsx'
import { ProjectHeading } from '../projects/ProjectHeading.tsx'
import { SHORTCUTS, useShortcuts } from '../ui/shortcuts.ts'
import { triggerAt } from '../../shared/context.ts'
import { knownUrls } from '../../shared/media.ts'
import { MediaContext } from './mediaContext.ts'
import { ToolInfoContext } from './toolInfo.ts'
import { interrupted, waitingCalls, type Turn } from './turns.ts'
import { ApprovalCard, TurnView } from './TurnView.tsx'
import { describeUsage } from './usage.ts'
import { useAttachments } from './useAttachments.ts'
import { toolOptions as toolOptionsOf } from './toolOptions.tsx'
import { useAnswerAlert } from './useAnswerAlert.ts'
import { useChat } from './useChat.ts'
import { DropOverlay } from './DropOverlay.tsx'
import { useFileDrop } from './useFileDrop.ts'
import { useScrollFollow } from './useScrollFollow.ts'
import { UNTITLED } from '../conversations/useConversations.ts'
import type { ProjectsApi } from '../projects/useProjects.ts'
import type { SettingsApi } from '../settings/useSettings.ts'
import { errorMessage } from '../../shared/errors.ts'
import { OFFLINE } from '../http.ts'

interface Props {
  health: Health | undefined
  /** Whether chibot's server can be reached, and how to look again. */
  connection: Connection
  /** Counts the times chibot came back after being unreachable. */
  recovered: number
  settings: SettingsApi
  projects: ProjectsApi
  onListChanged: () => void
  /** The sidebar's chats, whose titles follow renames. */
  conversations: ConversationListItem[]
  /** Whether the sidebar's list has loaded (an empty one is then really empty). */
  conversationsLoaded: boolean
  /** On phones while the sidebar is hidden: a header button opens it. */
  onOpenSidebar?: () => void
  /** Shut out while the phone drawer covers the page (nothing here can be reached). */
  inert?: boolean
  /** Opens the Memories dialog. */
  onShowMemories: () => void
}

/** What "Continue" sends after a stopped answer. */
const CONTINUE = 'Please continue from where you stopped.'

/** In place of a message that could not be drawn; the others are unaffected. */
const turnFailed = (retry: () => void) => (
  <p className="error" role="alert">
    This message could not be displayed.{' '}
    <button type="button" className="button" onClick={retry}>
      Try again
    </button>
  </p>
)

export function ChatPage({
  health,
  connection,
  recovered,
  settings,
  projects,
  onListChanged,
  conversations,
  conversationsLoaded,
  onOpenSidebar,
  inert,
  onShowMemories,
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
  // An answer that failed is told about in its own turn, with Retry; any
  // other error (or a failure that left no turn to retry) shows under the thread.
  const last = turns.at(-1)
  const failure =
    error !== null && error === chat.failure && last && interrupted(last)
      ? error
      : null
  const { toast } = useToast()

  /** A new chat with this one up to the end of `turn`, opened at once. */
  async function branch(chatId: string, turn: Turn) {
    const itemId = turn.answer?.itemId ?? turn.question.itemId
    if (itemId === null) return
    try {
      const created = await branchConversation(chatId, itemId)
      onListChanged()
      navigate(`/c/${created.id}`)
    } catch (err) {
      toast(errorMessage(err), { kind: 'error' })
    }
  }
  // Unsent text and files are kept per chat (a new chat per project).
  const draftKey = id ?? `new:${projectHome ?? ''}`
  const attachments = useAttachments(draftKey)
  const [prefill, setPrefill] = useState<{
    text: string
    n: number
    append?: boolean
  } | null>(null)
  const waiting = pending ? [] : waitingCalls(turns)
  const followUps = useFollowUps({
    chatId: id,
    turns,
    waiting: waiting.length,
    busy,
    queued: chat.queued !== null,
    enabled: !!settings.settings?.suggestFollowUps,
  })
  const suggestions = shownSuggestions(
    followUps.found,
    id,
    followUps.target,
    !busy && chat.queued === null && !!settings.settings?.suggestFollowUps,
  )
  const toolOptions = toolOptionsOf(settings.tools, settings.settings)
  const chatUsage = describeUsage(chat.usage)
  // Each answer shows the context it sent against the window.
  const contextSettings = settings.settings ?? settings.defaults
  const context = {
    window: contextSettings?.contextWindow ?? 32_000,
    trigger: contextSettings?.autoCompact ? triggerAt(contextSettings) : null,
  }
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // Read out by screen readers (a live region): an answer starting, then
  // ready or waiting for approval. Errors announce themselves (alert).
  const [announcement, setAnnouncement] = useState('')
  const wasBusy = useRef(false)
  useEffect(() => {
    if (busy && !wasBusy.current) setAnnouncement('Answering…')
    else if (!busy && wasBusy.current && !error) {
      setAnnouncement(
        waiting.length > 0
          ? 'A tool is waiting for your approval'
          : 'Answer ready',
      )
    }
    wasBusy.current = busy
  }, [busy, error, waiting.length])
  useEffect(() => setAnnouncement(''), [id])
  // The turn whose question is open for editing (one at a time).
  const [editingTurn, setEditingTurn] = useState<string | null>(null)
  useEffect(() => setEditingTurn(null), [id])
  const lastTurn = turns.at(-1)
  // ↑ in an empty composer: the last message, once it's saved.
  const editLast =
    lastTurn && lastTurn.question.itemId !== null && !busy
      ? () => setEditingTurn(lastTurn.key)
      : undefined
  // An empty chat centres the composer under a greeting, as ChatGPT does.
  // The composer stays the third child either way, so it keeps its focus
  // and text when the first message moves it to the bottom.
  const empty = turns.length === 0 && !pending && !error && !chat.loading
  const {
    endRef,
    threadRef,
    away,
    follow,
    following,
    inputProps,
    onScroll,
    jumpToLatest,
    leaveEnd,
  } = useScrollFollow(id, [turns, pending], empty)
  // Find in chat: its bar, which closes with the chat.
  const [finding, setFinding] = useState(false)
  const findButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => setFinding(false), [id])
  // A new chat starts as a normal one again.
  useEffect(() => {
    if (!id) setTemporaryMode(false)
  }, [id])

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

  const { dragging, handlers: dragHandlers } = useFileDrop(
    attachments.add,
    composerRef,
  )

  // The addresses in answers that may load by themselves: those the user wrote
  // and tools returned (the server checks the same, and which it knows).
  const media = useMemo(() => {
    if (!id) return null
    const shown = pending ? [...turns, pending.turn] : turns
    const texts = shown.flatMap(({ question, answer }) => [
      question.text,
      ...(answer?.tools.map((tool) => tool.output ?? '') ?? []),
    ])
    return { conversationId: id, known: knownUrls(texts) }
  }, [id, turns, pending])

  const temporary = id ? isTemporary : temporaryMode
  const recentChatList = useMemo(
    () => recentChats(conversations),
    [conversations],
  )
  const recentProjectList = useMemo(
    () => recentProjects(projects.projects),
    [projects.projects],
  )
  // A health check that hasn't answered yet counts as set up (no flash).
  const configured = health?.configured !== false
  // On a new chat only: the setup, else somewhere to carry on, else starters.
  const state = emptyState({
    configured,
    hasRecents: recentChatList.length + recentProjectList.length > 0,
    loaded: conversationsLoaded,
  })
  const recents =
    empty && !id && !projectHome && !temporary && state === 'recents'
  /** The server is down: say so, and keep what was typed. */
  const explainOffline = () => {
    toast(
      'Can’t reach chibot. Your message is kept; send it once it is back.',
      {
        kind: 'error',
      },
    )
    void connection.retry()
    return Promise.resolve(false)
  }
  // The chat that was opening when chibot went away opens again.
  const refreshChat = chat.refresh
  useEffect(() => {
    if (recovered > 0) refreshChat()
  }, [recovered])
  /** Nothing can be answered yet: say so, and keep what was typed. */
  const explainSetup = () => {
    toast('Set up a model first: see the steps above the message box.', {
      kind: 'error',
    })
    return Promise.resolve(false)
  }
  const projectId = id ? chat.projectId : (projectHome ?? null)
  const project = projects.projects.find((p) => p.id === projectId)
  // The sidebar's copy follows renames; project chats aren't listed there.
  const title = id
    ? (conversations.find((c) => c.id === id)?.title ?? chat.title)
    : null
  const pageTitle = id
    ? temporary
      ? 'Temporary chat'
      : (title ?? UNTITLED)
    : projectHome
      ? project?.name
      : null

  // Tabs, history and bookmarks name the chat (or project) on screen.
  const alerted = useAnswerAlert(
    id,
    { busy, waiting: waiting.length > 0, failed: error !== null },
    pageTitle ?? 'chibot',
  )
  useEffect(() => {
    const name = pageTitle ? `${pageTitle} – chibot` : 'chibot'
    document.title = alerted ? `• ${name}` : name
  }, [pageTitle, alerted])

  return (
    <ToolInfoContext value={settings.tools}>
      <MediaContext value={media}>
        <main
          className={[
            'chat',
            empty && 'empty',
            empty && projectHome && 'project-home',
            dragging && 'dragging',
          ]
            .filter(Boolean)
            .join(' ')}
          inert={inert}
          {...dragHandlers}
        >
          {dragging && <DropOverlay />}
          {connection.unreachable && <ConnectionBanner {...connection} />}
          <ChatTopBar
            id={id}
            projectHome={projectHome}
            project={project}
            pageTitle={pageTitle}
            health={health}
            settings={settings}
            usage={chatUsage}
            temporary={temporary}
            temporaryMode={temporaryMode}
            onToggleTemporary={() => setTemporaryMode((on) => !on)}
            onOpenSidebar={onOpenSidebar}
            find={
              turns.length > 0
                ? {
                    open: finding,
                    onToggle: () => setFinding((on) => !on),
                    buttonRef: findButtonRef,
                  }
                : undefined
            }
            outline={
              <OutlineMenu turns={turns} thread={threadRef} onJump={leaveEnd} />
            }
          />
          {finding && !empty && (
            <FindBar
              root={threadRef}
              content={[turns, pending]}
              onJump={leaveEnd}
              onClose={() => {
                setFinding(false)
                findButtonRef.current?.focus()
              }}
            />
          )}
          {empty && projectHome ? (
            project ? (
              <ProjectHeading
                project={project}
                onEdit={(patch) => void projects.update(project.id, patch)}
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
            <Greeting
              temporary={temporary}
              state={state}
              onStart={(text) =>
                setPrefill((was) => ({ text, n: (was?.n ?? 0) + 1 }))
              }
            />
          ) : (
            <div className="messages" onScroll={onScroll} {...inputProps}>
              <div className="thread" ref={threadRef}>
                {turns.map((turn, i) => (
                  <ErrorBoundary key={turn.key} fallback={turnFailed}>
                    <TurnView
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
                      editing={editingTurn === turn.key}
                      onEditingChange={(on) =>
                        setEditingTurn(on ? turn.key : null)
                      }
                      onEdit={following((text: string) => chat.edit(i, text))}
                      onRegenerate={following(() => chat.regenerate(i))}
                      failure={failure}
                      onRetry={following(() => {
                        void chat.regenerate(i)
                        composerRef.current?.focus()
                      })}
                      onBranch={
                        id && !temporary && turn.question.itemId !== null
                          ? () => void branch(id, turn)
                          : undefined
                      }
                      onContinue={following(() => chat.send(CONTINUE))}
                      onNextStep={
                        busy || chat.queued !== null
                          ? undefined
                          : following(chat.send)
                      }
                      onSwitch={(itemId) => void chat.switchVersion(itemId)}
                      onImageLoad={follow}
                      context={context}
                      onCompact={
                        chat.canCompact ? following(chat.compact) : undefined
                      }
                      onUndoCompaction={(c) => void chat.undo(c)}
                      onShowMemories={onShowMemories}
                    />
                  </ErrorBoundary>
                ))}
                {pending && (
                  <ErrorBoundary fallback={turnFailed}>
                    <TurnView
                      turn={pending.turn}
                      pending
                      onImageLoad={follow}
                      context={context}
                    />
                  </ErrorBoundary>
                )}
                {chat.summarizing && (
                  <p className="status-note" role="status">
                    Summarizing earlier messages…
                  </p>
                )}
                {chat.notice && (
                  <p className="status-note" role="status">
                    {chat.notice}
                  </p>
                )}
                {/* While the banner says chibot cannot be reached, this would say it again. */}
                {error &&
                  !failure &&
                  !(error === OFFLINE && connection.unreachable) && (
                    <p className="error" role="alert">
                      {error}
                    </p>
                  )}
                {chat.problem && <SetupCard problem={chat.problem} />}
                <div ref={endRef} />
              </div>
              {away && (
                <button
                  type="button"
                  className="jump-latest"
                  aria-label="Jump to latest"
                  title="Jump to latest"
                  onClick={jumpToLatest}
                >
                  <ArrowDown size={18} strokeWidth={2} />
                </button>
              )}
            </div>
          )}
          <QuoteSelection
            within={threadRef}
            onQuote={(text) =>
              setPrefill((was) => ({
                text: quoteText(text),
                n: (was?.n ?? 0) + 1,
                append: true,
              }))
            }
          />
          <FollowUps suggestions={suggestions} onPick={following(chat.send)} />
          <Composer
            busy={busy}
            onSend={
              !configured
                ? explainSetup
                : connection.unreachable
                  ? explainOffline
                  : following(chat.send)
            }
            onStop={chat.stop}
            queued={chat.queued}
            onQueue={chat.enqueue}
            onCancelQueued={chat.cancelQueued}
            onTakeQueued={chat.takeQueued}
            onEditLast={editLast}
            inputRef={composerRef}
            tools={toolOptions}
            attachments={attachments}
            draftKey={draftKey}
            transcription={
              (health?.features.transcription ?? false) &&
              !!settings.settings?.transcribeModel
            }
            effort={settings.settings?.reasoningEffort ?? null}
            prefill={prefill}
            onEffort={(reasoningEffort) =>
              void settings.update({ reasoningEffort })
            }
          />
          {empty && projectHome && (
            <ProjectDetails
              projectId={projectHome}
              onChatsChanged={onListChanged}
            />
          )}
          {recents && (
            <Recents chats={recentChatList} projects={recentProjectList} />
          )}
          <p className="visually-hidden" role="status">
            {announcement}
          </p>
          <p className="disclaimer">
            chibot can make mistakes. Check important info.
          </p>
        </main>
      </MediaContext>
    </ToolInfoContext>
  )
}
