import { z } from 'zod'
import { NEXT_STEP_TOOL } from '../../shared/tools.ts'
import { Tool } from '../tool.ts'

/**
 * Offers the user one concrete next step as a card under the answer. The
 * card is drawn from the call's arguments (kept in the history with the
 * answer), so the tool only checks them and says it was shown.
 */
export class SuggestNextStepTool extends Tool {
  readonly name = NEXT_STEP_TOOL
  readonly label = 'Suggest a next step'
  override readonly group = 'Answers'
  override readonly summary =
    'Shows a card under an answer that offers one follow-up, such as turning a list into a plan, and sends it when you click. Nothing leaves this machine except the chat itself. Off, answers show no card.'
  override readonly running = 'Suggesting a next step…'
  override readonly done = 'Suggested a next step'
  readonly description =
    'Shows the user a card under your answer that offers one concrete next step; clicking its button sends `prompt` as their next message.'
  readonly parameters = z.object({
    title: z
      .string()
      .describe(
        'What the step produces, in a few words (“Weekly learning plan”)',
      ),
    description: z.string().describe('One short line on what you would do'),
    button: z
      .string()
      .describe('One to three words for the button, starting with a verb'),
    prompt: z
      .string()
      .describe(
        'The message the user would send to accept, in their words and language',
      ),
  })
  // The answer is already written; another request would only add a closing
  // remark after the card.
  override readonly endsTurn = true

  override instructions() {
    return (
      'When your answer ends by offering to do one more concrete thing for the ' +
      `user, such as turning a list into a plan, call ${NEXT_STEP_TOOL} once ` +
      'after the whole answer is written, so they can accept with one click. ' +
      'Keep the offer in your answer too. Most answers have no such offer; ' +
      'leave the card out for plain questions and small talk, so it stays ' +
      'worth noticing.'
    )
  }

  async run(args: z.output<typeof this.parameters>) {
    for (const [field, value] of Object.entries(args)) {
      if (!value.trim()) throw new Error(`${field} is empty`)
    }
    return 'The card is shown under your answer.'
  }
}
