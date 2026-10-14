import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  neutralizeInternalNames,
  parseInternalNames,
  internalNamesFromEnv,
  neutralizeAndFlagInternal,
  INTERNAL_NAMES_ENV,
  INTERNAL_ROLE_ENV,
  DEFAULT_INTERNAL_ROLE,
} from '../internal-names'

// Production leak: a memory row "Bokslut och deklaration sköts av Jacob utanför
// Accounted" was rendered into the chat prompt, and the assistant told the
// customer who internally does the work, by name.

describe('neutralizeInternalNames', () => {
  const names = parseInternalNames('Jacob, Jacob Martens')

  it('drops the agent phrase in the production rule, so nobody is named as doing the work', () => {
    expect(neutralizeInternalNames('Bokslut och deklaration sköts av Jacob utanför Accounted', names)).toBe(
      'Bokslut och deklaration sköts utanför Accounted',
    )
    expect(neutralizeInternalNames('Underlag lämnas hos Jacob Martens varje månad', names)).toBe(
      'Underlag lämnas varje månad',
    )
  })

  it('keeps a genitive after a preposition as a role, not a dropped phrase', () => {
    expect(neutralizeInternalNames('sköts av Jacobs kollega', names)).toBe('sköts av byråns kollega')
  })

  it('replaces the full name before the first name, and the genitive', () => {
    expect(neutralizeInternalNames('Jacob Martens sköter bokslutet. Det är Jacobs uppgift.', names)).toBe(
      'byrån sköter bokslutet. Det är byråns uppgift.',
    )
  })

  it('is case-insensitive and whole-word only', () => {
    expect(neutralizeInternalNames('fråga JACOB', names)).toBe('fråga byrån')
    expect(neutralizeInternalNames('Jacobsson AB är leverantör', names)).toBe('Jacobsson AB är leverantör')
  })

  it('leaves text alone when no names are configured', () => {
    const rule = 'Alla betalningar utanför banken är Wilmas egna pengar (2018)'
    expect(neutralizeInternalNames(rule, [])).toBe(rule)
    expect(neutralizeInternalNames(rule, parseInternalNames(undefined))).toBe(rule)
  })

  it('uses a configured role', () => {
    expect(neutralizeInternalNames('fråga Jacob', names, 'redovisningskonsulten')).toBe(
      'fråga redovisningskonsulten',
    )
  })

  it('escapes regex characters in configured names', () => {
    expect(neutralizeInternalNames('A.B. Konsult sköter det', parseInternalNames('A.B. Konsult'))).toBe('byrån sköter det')
    expect(neutralizeInternalNames('sköts av AXB Konsult', parseInternalNames('A.B. Konsult'))).toBe('sköts av AXB Konsult')
  })
})

describe('internalNamesFromEnv', () => {
  it('reads names and role from the environment, longest name first', () => {
    const cfg = internalNamesFromEnv({ [INTERNAL_NAMES_ENV]: 'Jacob, Jacob Martens, ,', [INTERNAL_ROLE_ENV]: ' konsulten ' } as NodeJS.ProcessEnv)
    expect(cfg).toEqual({ names: ['Jacob Martens', 'Jacob'], role: 'konsulten' })
  })

  it('defaults to no names and the neutral role', () => {
    expect(internalNamesFromEnv({} as NodeJS.ProcessEnv)).toEqual({ names: [], role: DEFAULT_INTERNAL_ROLE })
  })
})

describe('neutralizeAndFlagInternal', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('flags a row that named an internal person, so callers can mark it internal', () => {
    vi.stubEnv('AGENT_INTERNAL_PERSON_NAMES', 'Jacob')
    expect(neutralizeAndFlagInternal('Bokslut sköts av Jacob utanför Accounted')).toEqual({
      text: 'Bokslut sköts utanför Accounted',
      internal: true,
    })
  })

  it('leaves an ordinary rule unflagged', () => {
    vi.stubEnv('AGENT_INTERNAL_PERSON_NAMES', 'Jacob')
    expect(neutralizeAndFlagInternal('Wilmas egna pengar bokförs som eget uttag')).toEqual({
      text: 'Wilmas egna pengar bokförs som eget uttag',
      internal: false,
    })
  })
})
