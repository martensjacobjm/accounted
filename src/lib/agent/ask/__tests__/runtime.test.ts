import { describe, expect, it } from 'vitest'
import { runsOnSingleCallConsole } from '../runtime'

describe('runsOnSingleCallConsole (fork: general.help gets the tool loop when it exists)', () => {
  it('runs general.help on the tool-loop chat when the deployment has it', () => {
    expect(runsOnSingleCallConsole('general.help', true)).toBe(false)
  })
  it('falls back to the single-call console only when the tool loop is unavailable', () => {
    expect(runsOnSingleCallConsole('general.help', false)).toBe(true)
  })
  it('never puts a specialised intent on the console', () => {
    expect(runsOnSingleCallConsole('transaction.categorization', true)).toBe(false)
    expect(runsOnSingleCallConsole('transaction.categorization', false)).toBe(false)
  })
})
