import { describe, expect, it } from 'vitest'
import { firstNameFromFullName, resolveUserFirstName } from '../first-name'

describe('firstNameFromFullName', () => {
  it('takes the first word of the full name', () => {
    expect(firstNameFromFullName('Jacob Martens')).toBe('Jacob')
    expect(firstNameFromFullName('  Anna-Karin   Lind ')).toBe('Anna-Karin')
  })

  it('returns null instead of an empty string for a blank or missing name', () => {
    // A blank name used to yield "" and the chat greeted "Hej , ..." or let the
    // model pick a name out of the company memories.
    expect(firstNameFromFullName('')).toBeNull()
    expect(firstNameFromFullName('   ')).toBeNull()
    expect(firstNameFromFullName(null)).toBeNull()
    expect(firstNameFromFullName(undefined)).toBeNull()
    expect(firstNameFromFullName(42)).toBeNull()
  })
})

describe('resolveUserFirstName', () => {
  it('prefers the profile name the user set', () => {
    expect(resolveUserFirstName('Jacob Martens', { user_metadata: { full_name: 'Wilma Eldh' } })).toBe('Jacob')
  })

  it('falls back to the auth metadata name of the signed-in user', () => {
    expect(resolveUserFirstName(null, { user_metadata: { full_name: 'Jacob Martens' } })).toBe('Jacob')
    expect(resolveUserFirstName('  ', { user_metadata: { full_name: 'Jacob Martens' } })).toBe('Jacob')
  })

  it('returns null when neither source has a name', () => {
    expect(resolveUserFirstName(null, { user_metadata: {} })).toBeNull()
    expect(resolveUserFirstName(undefined, null)).toBeNull()
    expect(resolveUserFirstName(null)).toBeNull()
  })
})
