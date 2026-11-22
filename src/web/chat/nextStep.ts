import { NEXT_STEP_TOOL } from '../../shared/tools.ts'
import { parseJson } from './toolJson.ts'
import type { Answer } from './turns.ts'

/** The follow-up an answer offers as a card (`suggest_next_step`). */
export interface NextStep {
  title: string
  description: string
  /** The button's words. */
  button: string
  /** What clicking sends as the next message. */
  prompt: string
}

/**
 * The card the answer's last `suggest_next_step` call asks for, or `null`
 * when it made none, the call failed, or a field is missing (the model
 * wrote it, so it's only used as text, cut to fit).
 */
export function nextStepOf(answer: Answer): NextStep | null {
  const call = answer.tools.findLast((tool) => tool.name === NEXT_STEP_TOOL)
  if (call) {
    if (!call.output || call.output.startsWith('Error:')) return null
    return stepFrom(parseJson<Record<string, unknown>>(call.arguments))
  }
  return nextStepInText(answer.text)?.step ?? null
}

/** `args` (a call's, or JSON a model wrote) as a card, cut to fit; `null` when a field is missing. */
function stepFrom(args: Record<string, unknown>): NextStep | null {
  const field = (key: string, max: number) => {
    const value = args[key]
    return typeof value === 'string' ? value.trim().slice(0, max) : ''
  }
  const step = {
    title: field('title', 80),
    description: field('description', 160),
    button: field('button', 24),
    prompt: field('prompt', 2000),
  }
  return Object.values(step).every(Boolean) ? step : null
}

// What some models write in the answer instead of making the call: the
// tool's label, then its arguments as a JSON block, at the very end.
const CALL_AS_TEXT_BLOCK = /\n*```(?:json)?[ \t]*\n([\s\S]*?)\n```[ \t]*$/
const CALL_AS_TEXT_LABEL =
  /(?:^|\n)[ \t]*[*_]*suggest(?:ed)? (?:a )?next step[*_]*[ \t]*:[ \t]*[*_]*[ \t]*$/i

/**
 * The card a model wrote out as text (`Suggest a next step:` and a JSON block
 * ending the answer) instead of calling the tool, with the answer as it reads
 * without it. Only that exact shape counts: an answer that merely ends with
 * some JSON is left alone. `null` when it has none.
 */
export function nextStepInText(
  text: string,
): { text: string; step: NextStep } | null {
  const trimmed = text.trimEnd()
  const block = CALL_AS_TEXT_BLOCK.exec(trimmed)
  if (!block) return null
  const before = trimmed.slice(0, block.index)
  const label = CALL_AS_TEXT_LABEL.exec(before)
  if (!label) return null
  const step = stepFrom(parseJson<Record<string, unknown>>(block[1]!))
  return step ? { text: before.slice(0, label.index).trimEnd(), step } : null
}

const NEXT_STEP_LABEL = 'suggest a next step:'
// The label as its own line, then nothing yet or the start of the code fence.
const PENDING_CARD =
  /(?:^|\n)[ \t]*[*_]*suggest(?:ed)? (?:a )?next step[*_]*[ \t]*:[ \t]*[*_]*[ \t]*(?:\n[ \t\n]*(?:`[^]*)?)?$/i

/**
 * An answer's text while it still streams, without what may turn out to be a
 * card written out as text: the label as it is typed, and the code fence after
 * it. Without this the raw JSON shows for as long as it takes to arrive, and
 * then turns into the card. Anything else after the label (an answer that
 * only mentions it) shows as usual; a finished answer is `shownText`.
 */
export function holdBackCard(text: string): string {
  const pending = PENDING_CARD.exec(text)
  if (pending) return text.slice(0, pending.index).trimEnd()
  // The label half typed: "…\n\n*Suggest a ne".
  const lastLine = text.slice(text.lastIndexOf('\n') + 1)
  const typed = lastLine.replace(/^[ \t*_]+/, '').toLowerCase()
  if (typed.length >= 7 && NEXT_STEP_LABEL.startsWith(typed)) {
    return text.slice(0, text.length - lastLine.length).trimEnd()
  }
  return text
}

/**
 * What to show of a finished answer's text: without a card the model wrote
 * out as text (a call that was made is not in the text at all).
 */
export function shownText(answer: Answer): string {
  if (answer.incomplete) return answer.text
  if (answer.tools.some((tool) => tool.name === NEXT_STEP_TOOL)) {
    return answer.text
  }
  return nextStepInText(answer.text)?.text ?? answer.text
}
