import { describe, expect, it } from 'vitest'
import {
  accountFromNote,
  liabilityFromNote,
  suggestExpenseAccount,
} from '../suggest-expense-account'

const chart = new Set(['5460', '5480', '6110', '2018', '2893'])

describe('accountFromNote', () => {
  it('finds the cost account named in the comment', () => {
    expect(accountFromNote('Arbetskläder. Rätt kontering: 5480 mot 2018 egna insättningar', chart)).toBe('5480')
    expect(accountFromNote('konto 6110', chart)).toBe('6110')
  })
  it('ignores numbers that are not accounts in the chart', () => {
    expect(accountFromNote('ordernr 5555, byxor 228,25 kr', chart)).toBeNull()
    expect(accountFromNote('5555', null)).toBe('5555')
  })
  it('skips counter accounts and empty input', () => {
    expect(accountFromNote('mot 2018', chart)).toBeNull()
    expect(accountFromNote('', chart)).toBeNull()
    expect(accountFromNote(null, chart)).toBeNull()
  })
})

describe('liabilityFromNote', () => {
  it('reads the owner counter account', () => {
    expect(liabilityFromNote('5480 mot 2018')).toBe('2018')
    expect(liabilityFromNote('skuld till ägaren 2893')).toBe('2893')
    expect(liabilityFromNote('bara kläder')).toBeNull()
  })
})

describe('suggestExpenseAccount', () => {
  it('lets the comment beat the extraction', () => {
    expect(suggestExpenseAccount({ note: '5480 mot 2018', extractedAccount: '5460' }, chart)).toEqual({
      account: '5480',
      source: 'note',
    })
  })
  it('falls back to the extraction when the comment names nothing', () => {
    expect(suggestExpenseAccount({ note: 'kläder', extractedAccount: '5460' }, chart)).toEqual({
      account: '5460',
      source: 'extraction',
    })
  })
  it('rejects extraction accounts outside class 4-7 or outside the chart', () => {
    expect(suggestExpenseAccount({ extractedAccount: '1930' }, chart).account).toBeNull()
    expect(suggestExpenseAccount({ extractedAccount: '5800' }, chart).account).toBeNull()
    expect(suggestExpenseAccount({}, chart)).toEqual({ account: null, source: null })
  })
})
