/**
 * vault.ts — Legacy token resolution helper.
 *
 * v7: The vault API and vault CRUD have been removed.
 * This file retains only `resolveToken` which is used by the legacy
 * tool fallback path in tool-context.ts for explicit token params.
 *
 * Will be fully removed once all tools migrate to resolveForRoom.
 */

/**
 * Resolve room + token for legacy tool calls that pass explicit params.
 * No vault lookup — just passthrough for explicit room+token pairs.
 */
export async function resolveToken(
  userId: string | null,
  room?: string,
  token?: string,
): Promise<{ room: string; token: string } | null> {
  // Explicit token always wins (only remaining use case)
  if (room && token) return { room, token };
  return null;
}
