/**
 * Tilltalsnamnet för den inloggade användaren: första ordet i
 * profiles.full_name, annars i auth-användarens user_metadata.full_name.
 *
 * En enda källa för chattens hälsning, startsidan och bolagsväljaren
 * (fork bok.dalavs.se 2026-10-15). Tidigare räknade tre ställen ut det var för
 * sig med split(' ')[0], och ett tomt eller blankt namn gav "" i stället för
 * null, så att chatten hälsade "Hej , ..." eller lät modellen leta upp ett namn
 * ur bolagets minnen ("Hej Wilma" till en annan användare).
 */
export function firstNameFromFullName(fullName: unknown): string | null {
  if (typeof fullName !== 'string') return null
  const first = fullName.trim().split(/\s+/)[0]
  return first ? first : null
}

interface UserWithMetadata {
  user_metadata?: Record<string, unknown> | null
}

/** Profilens namn först (användaren ändrar det i kontoinställningarna), sedan auth-metadata. */
export function resolveUserFirstName(
  profileFullName: unknown,
  user?: UserWithMetadata | null,
): string | null {
  return firstNameFromFullName(profileFullName) ?? firstNameFromFullName(user?.user_metadata?.full_name)
}
