import { makeIssue } from "../domain/importer.ts";
import type { IssueKey, IssueParams } from "../domain/issueMessages.ts";

/** Responses and request bodies shared by the API's routes. Nothing here is cached: every answer is current. */

export const NO_STORE = { "cache-control": "no-store" };

export function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function error(status: number, code: string, key: IssueKey, params?: IssueParams): Response {
  return json(status, { ok: false, issues: [makeIssue(code, key, params)] });
}

/**
 * Reads the body into memory, giving up as soon as it passes `maxBytes`, so
 * a body without a Content-Length can't make the Worker buffer more.
 * Returns null when the body is too large.
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get("content-length") ?? "0") > maxBytes) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
