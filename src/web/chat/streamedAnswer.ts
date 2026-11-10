import type { TurnEvent } from './api.ts'
import type { Answer, Question, ToolActivity, Turn } from './turns.ts'

/** An answer as it has streamed in so far. */
export interface StreamedAnswer {
  text: string
  /** The model's reasoning summary. */
  thinking: string
  tools: ToolActivity[]
  /** The summary part being written (parts start new paragraphs). */
  summaryIndex: number
  /** A reasoning item started since the last summary text. */
  newThoughts: boolean
}

/** What the page has to do beyond showing the answer. */
export type StreamEffect =
  /** Saved, and no tool calls follow: the chat is free again. */
  | { type: 'answered' }
  /** The turn ended to wait for the user's Approve / Deny. */
  | { type: 'approval' }
  | { type: 'error'; message: string }

/** The answer a turn starts from: empty, or (after approval) what it had. */
export const startAnswer = (before?: Answer | null): StreamedAnswer => ({
  text: before?.text ?? '',
  thinking: before?.thinking ?? '',
  tools: before?.tools ?? [],
  summaryIndex: 0,
  newThoughts: false,
})

/**
 * What one streamed event does: the answer so far, whether to show it again
 * (`changed`), and an `effect` for the events that end or fail a response.
 */
export function applyEvent(
  streamed: StreamedAnswer,
  event: TurnEvent,
): { streamed: StreamedAnswer; changed: boolean; effect?: StreamEffect } {
  const shown = (next: StreamedAnswer) => ({ streamed: next, changed: true })
  const quiet = (next: StreamedAnswer) => ({ streamed: next, changed: false })
  const updateTool = (callId: string, change: Partial<ToolActivity>) =>
    shown({
      ...streamed,
      tools: streamed.tools.map((t) =>
        t.callId === callId ? { ...t, ...change } : t,
      ),
    })

  switch (event.type) {
    case 'response.output_text.delta':
      return shown({ ...streamed, text: streamed.text + event.delta })

    case 'response.reasoning_summary_text.delta': {
      // Summaries can come in parts, and a turn with tool calls can think
      // more than once; each new part starts a new paragraph.
      const newParagraph =
        streamed.thinking &&
        (streamed.newThoughts || event.summary_index !== streamed.summaryIndex)
      return shown({
        ...streamed,
        thinking:
          (newParagraph ? `${streamed.thinking}\n\n` : streamed.thinking) +
          event.delta,
        summaryIndex: event.summary_index,
        newThoughts: false,
      })
    }

    case 'response.output_item.added': {
      const { item } = event
      if (item.type === 'reasoning')
        return quiet({ ...streamed, newThoughts: true })
      // Messages after tool calls are paragraphs of the same answer.
      if (item.type === 'message' && streamed.text) {
        return quiet({ ...streamed, text: `${streamed.text}\n\n` })
      }
      if (item.type === 'function_call') {
        return shown({
          ...streamed,
          tools: [
            ...streamed.tools,
            {
              callId: item.call_id,
              name: item.name,
              arguments: item.arguments,
              output: null,
            },
          ],
        })
      }
      return quiet(streamed)
    }

    case 'response.output_item.done':
      return event.item.type === 'function_call'
        ? updateTool(event.item.call_id, { arguments: event.item.arguments })
        : quiet(streamed)

    case 'chibot.tool_output':
      return updateTool(event.call_id, { output: event.output })

    case 'response.completed':
    case 'response.incomplete':
      // Saved by now. Tool calls mean another response follows; otherwise
      // the stream may stay open a little longer for the title, but the
      // chat is free again.
      return {
        ...quiet(streamed),
        effect: event.response.output.some((i) => i.type === 'function_call')
          ? undefined
          : { type: 'answered' },
      }

    case 'chibot.approval':
      return { ...quiet(streamed), effect: { type: 'approval' } }

    case 'chibot.error':
      return {
        ...quiet(streamed),
        effect: {
          type: 'error',
          message: [
            event.message,
            event.requestId && `(request ${event.requestId})`,
          ]
            .filter(Boolean)
            .join(' '),
        },
      }

    case 'response.failed':
      return {
        ...quiet(streamed),
        effect: {
          type: 'error',
          message: event.response.error?.message ?? 'The response failed.',
        },
      }

    case 'error':
      return {
        ...quiet(streamed),
        effect: { type: 'error', message: event.message },
      }

    default:
      return quiet(streamed)
  }
}

/** The turn as streamed so far, to show before it is saved. */
export const turnSoFar = (
  question: Question,
  { text, thinking, tools }: StreamedAnswer,
  key: string,
  /** The user stopped it. */
  incomplete = false,
): Turn => ({
  key,
  question,
  compaction: null,
  answer:
    text || thinking || tools.length > 0
      ? {
          itemId: null,
          text,
          thinking,
          tools,
          usage: null,
          lastUsage: null,
          model: null,
          versions: null,
          incomplete,
        }
      : null,
})
