import { sha256Hex } from "./hash.ts";

/**
 * A submission receipt is a 256-bit secret made in the uploader's browser
 * before anything is sent. Because the uploader holds it first, a
 * confirmation whose response is lost can be retried with the same secret:
 * the server recognizes it and answers with the original result instead of
 * counting the file again. The server stores only `hashReceiptSecret`.
 */

const PREFIX = "gds1_";
const SECRET_PATTERN = /^gds1_[A-Za-z0-9_-]{43}$/;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function newReceiptSecret(): string {
  return PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function isReceiptSecret(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/**
 * The secret has 256 bits of entropy, so a fast hash is enough: there is no
 * dictionary to guess from, unlike a password.
 */
export function hashReceiptSecret(secret: string): Promise<string> {
  return sha256Hex(secret);
}

export interface ReceiptLabels {
  title: string;
  warning: readonly string[];
  receipt: string;
  site: string;
  created: string;
}

/** The text a player saves, in the page's language. It never leaves their device except to authorize a request. */
export function receiptText(secret: string, site: string, createdAt: Date, labels: ReceiptLabels): string {
  return [
    labels.title,
    "",
    ...labels.warning,
    "",
    `${labels.receipt}: ${secret}`,
    `${labels.site}: ${site}`,
    `${labels.created}: ${createdAt.toISOString()}`,
    "",
  ].join("\n");
}
