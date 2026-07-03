/** Parses a `true`/`1`/`false`/`0` env var string as a boolean. Unset or anything else = false. */
export function isEnvFlagEnabled(value: string | undefined): boolean {
  return ['true', '1'].includes((value ?? '').trim().toLowerCase());
}
