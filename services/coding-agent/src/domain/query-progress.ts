export interface QueryProgress {
  query: string
  count: number
}

/** A model-facing reminder, never a command cache, denial or authorization decision. */
export function queryProgress(
  previous: QueryProgress | undefined,
  command: string,
  result: unknown,
): { state: QueryProgress | undefined; notice?: string } {
  if (!result || typeof result !== 'object' || !('exitCode' in result) || result.exitCode !== 0)
    return { state: undefined }
  // Only dependency metadata queries qualify. Different output filters do not make
  // querying the same package/field again useful; builds and tests are unaffected.
  const query =
    /^(?:npm|pnpm|yarn)\s+(?:view|info|show)\s+[@\w./~^*=-]+(?:\s+(?:versions?|engines|dependencies|peerDependencies))?(?=\s*\||\s*$)/.exec(
      command.trim(),
    )?.[0]
  if (!query) return { state: undefined }
  const state = { query, count: previous?.query === query ? previous.count + 1 : 1 }
  return {
    state,
    ...(state.count >= 3
      ? {
          notice: `This dependency metadata query has already succeeded ${state.count} times without an intervening file change. Reuse the results and move to the requested implementation. Query again only for a specific unresolved blocker; explain that blocker instead of widening the same output filter.`,
        }
      : {}),
  }
}
