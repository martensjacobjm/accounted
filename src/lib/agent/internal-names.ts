/**
 * Internal person names that must never reach a customer as fact.
 *
 * Company rules and chat memory (agent_memory) are written by whoever runs the
 * instance as much as by the customer: the accountant, the operator, the
 * person who set the company up. A rule like "Bokslut och deklaration sköts
 * av <operator> utanför Accounted" is an internal work instruction, but the
 * chat rendered it into the system prompt verbatim and the assistant then told
 * the customer who internally does the work, by name.
 *
 * The names are configuration, not code: a heuristic on capitalised words
 * would also rewrite legitimate facts ("Wilmas egna pengar", "sköts av
 * Skatteverket"). Set AGENT_INTERNAL_PERSON_NAMES to a comma-separated list
 * ("Förnamn, Förnamn Efternamn"); every whole-word match, and its Swedish
 * genitive (name + "s"), is replaced by a neutral role before the text reaches
 * a model prompt. Unset means no rewriting: the always-on prompt rule in
 * buildIdentityBlock still forbids repeating internal names.
 *
 * An agent phrase ("sköts av <name>", "hos/via/genom <name>") is dropped
 * instead of rewritten. With the role in its place the chat eval still saw the
 * work split relayed ("sköts av byrån åt er") in about half the runs; the
 * model cannot relay who does a task when the prompt never says who.
 */

export const INTERNAL_NAMES_ENV = 'AGENT_INTERNAL_PERSON_NAMES'
export const INTERNAL_ROLE_ENV = 'AGENT_INTERNAL_PERSON_ROLE'
export const DEFAULT_INTERNAL_ROLE = 'byrån'

/** Parses the comma-separated env value; blank entries are dropped. */
export function parseInternalNames(raw: string | undefined | null): string[] {
  if (!raw) return []
  const names = raw
    .split(',')
    .map((n) => n.replace(/\s+/g, ' ').trim())
    .filter((n) => n.length >= 2)
  // Longest first, so "Förnamn Efternamn" is replaced before "Förnamn".
  return [...new Set(names)].sort((a, b) => b.length - a.length)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replaces every listed name (whole word, case-insensitive, optional genitive
 * "s") with the role. Pure: the caller passes the names, so tests never depend
 * on the process environment.
 */
export function neutralizeInternalNames(
  text: string,
  names: string[],
  role: string = DEFAULT_INTERNAL_ROLE,
): string {
  if (!text || names.length === 0) return text
  let out = text
  for (const name of names) {
    const agent = new RegExp(
      `\\s+(?:av|hos|via|genom)\\s+${escapeRegExp(name).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`,
      'giu',
    )
    out = out.replace(agent, '')
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(name).replace(/ /g, '\\s+')}(s?)(?![\\p{L}\\p{N}])`,
      'giu',
    )
    out = out.replace(pattern, (_m, genitive: string) => `${role}${genitive ? 's' : ''}`)
  }
  return out
}

/** Names and role from the environment, read per call so a config change needs no rebuild. */
export function internalNamesFromEnv(env: NodeJS.ProcessEnv = process.env): {
  names: string[]
  role: string
} {
  const role = env[INTERNAL_ROLE_ENV]?.trim()
  return {
    names: parseInternalNames(env[INTERNAL_NAMES_ENV]),
    role: role && role.length > 0 ? role : DEFAULT_INTERNAL_ROLE,
  }
}

/** Convenience for prompt rendering: neutralize with the configured names. */
export function neutralizeConfiguredInternalNames(text: string): string {
  const { names, role } = internalNamesFromEnv()
  return neutralizeInternalNames(text, names, role)
}

/**
 * Neutralizes and reports whether the row named an internal person. A row
 * that did is an internal work instruction ("X sköts av <operator>"): the
 * chat eval showed the model still relayed the work split once the name was
 * gone ("sköts av er redovisningsbyrå"), so callers mark such rows for the
 * model as internal instead of rendering them as plain facts.
 */
export function neutralizeAndFlagInternal(text: string): { text: string; internal: boolean } {
  const out = neutralizeConfiguredInternalNames(text)
  return { text: out, internal: out !== text }
}

/** Prefix for a rule line that named an internal person (company-rules surfaces). */
export const INTERNAL_RULE_PREFIX = 'Intern arbetsinstruktion, återges inte: '
