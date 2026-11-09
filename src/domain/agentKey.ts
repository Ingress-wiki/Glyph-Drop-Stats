import { base64url, sha256Hex } from "./hash.ts";

/**
 * A read-only agent key lets a player's AI agent read the records of the
 * submissions it is linked to, through the MCP server, and nothing else: it
 * can't withdraw, look up a receipt or read anyone else's records. That is
 * what makes it safe to paste into a chat, unlike a receipt. Like a receipt
 * it is a 256-bit secret made in the player's browser; the server is sent
 * only its SHA-256 when it is linked, and stores only that.
 */

const PREFIX = "gdsr_";
const KEY_PATTERN = /^gdsr_[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function newAgentKey(): string {
  return PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function isAgentKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

export function isAgentKeyHash(value: string): boolean {
  return HASH_PATTERN.test(value);
}

/** The key has 256 bits of entropy, so a fast hash is enough, as for receipts. */
export function hashAgentKey(key: string): Promise<string> {
  return sha256Hex(key);
}
