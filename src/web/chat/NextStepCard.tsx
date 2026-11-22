// The follow-up an answer offers, as a card under it: what it would make and
// a button that sends it as the next message.
import { Sparkles } from 'lucide-react'
import type { NextStep } from './nextStep.ts'

export function NextStepCard({
  step,
  onChoose,
}: {
  step: NextStep
  onChoose: (prompt: string) => void
}) {
  return (
    <section className="next-step" aria-label="Next step">
      <span className="next-step-icon" aria-hidden>
        <Sparkles size={18} />
      </span>
      <div className="next-step-text">
        <div className="next-step-title" dir="auto">
          {step.title}
        </div>
        <div className="next-step-detail" dir="auto">
          Next step · {step.description}
        </div>
      </div>
      <button
        type="button"
        className="button primary"
        dir="auto"
        onClick={() => onChoose(step.prompt)}
      >
        {step.button}
      </button>
    </section>
  )
}
