import { all, create } from 'mathjs'
import { z } from 'zod'
import { Tool } from '../tool.ts'

// BigNumbers keep large integers and decimals exact (0.1 + 0.2 is 0.3).
const math = create(all, { number: 'BigNumber', precision: 64 })
const evaluate = math.evaluate
// The expression comes from the model, so it can't redefine the parser or
// reach these functions (mathjs's own security advice).
const disabled = (name: string) => () => {
  throw new Error(`${name} is not available`)
}
math.import(
  Object.fromEntries(
    ['import', 'createUnit', 'evaluate', 'parse', 'simplify', 'derivative'].map(
      (name) => [name, disabled(name)],
    ),
  ),
  { override: true },
)

/** Exact arithmetic, functions and unit conversions with mathjs. */
export class CalculatorTool extends Tool {
  readonly name = 'calculator'
  readonly description =
    'Evaluates a math expression exactly: arithmetic, powers, roots, ' +
    'functions such as sqrt, log, sin and factorial, matrices, and unit ' +
    'conversions. Use it for any calculation beyond simple mental arithmetic.'
  readonly parameters = z.object({
    expression: z
      .string()
      .describe(
        'A mathjs expression, e.g. "123456789 * 987654321", "sqrt(2) / 3" or "5 km to mi"',
      ),
  })

  async run({ expression }: { expression: string }) {
    return math.format(evaluate(expression), { notation: 'fixed' })
  }
}
