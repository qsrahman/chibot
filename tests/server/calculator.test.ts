import { describe, expect, it } from 'vitest'
import { CalculatorTool } from '../../src/server/tools/calculator.ts'

const calculate = (expression: string) =>
  new CalculatorTool().run({ expression })

describe('CalculatorTool', () => {
  it('computes exactly', async () => {
    expect(await calculate('123456789 * 987654321')).toBe('121932631112635269')
    expect(await calculate('0.1 + 0.2')).toBe('0.3')
    expect(await calculate('10!')).toBe('3628800')
    expect(await calculate('2^100')).toBe('1267650600228229401496703205376')
  })

  it('converts units', async () => {
    expect(await calculate('2 hours to minutes')).toBe('120 minutes')
  })

  it('throws on invalid expressions, so the model sees the error', async () => {
    await expect(calculate('2 +')).rejects.toThrow()
  })

  it("doesn't let expressions reach the parser itself", async () => {
    await expect(calculate('evaluate("1+1")')).rejects.toThrow(
      'evaluate is not available',
    )
    await expect(calculate('import({}, {})')).rejects.toThrow(
      'import is not available',
    )
  })
})
