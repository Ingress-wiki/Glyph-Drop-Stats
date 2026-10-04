import { DEFAULT_LIMITS, parseExport } from "../domain/importer.ts";
import { previewOf } from "../domain/preview.ts";

const JSON_HEADERS = { "cache-control": "no-store" };

function error(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, issues: [{ code, message }] }, { status, headers: JSON_HEADERS });
}

/**
 * Reads the body into memory, giving up as soon as it passes `maxBytes`, so
 * a body without a Content-Length can't make the Worker buffer more.
 * Returns null when the body is too large.
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array | null> {
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

/**
 * Validates an export and describes it. Nothing is stored: the file is read
 * from the request body, checked, and discarded with the request.
 */
async function preview(request: Request): Promise<Response> {
  const tooLarge = () => error(413, "file_too_large", `The file is larger than ${DEFAULT_LIMITS.maxBytes} bytes.`);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > DEFAULT_LIMITS.maxBytes) return tooLarge();
  const body = await readBodyLimited(request, DEFAULT_LIMITS.maxBytes);
  if (body === null) return tooLarge();
  const result = parseExport(body);
  return Response.json(previewOf(result), { status: result.ok ? 200 : 422, headers: JSON_HEADERS });
}

export async function handleApi(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/health") {
    return request.method === "GET"
      ? Response.json({ ok: true }, { headers: JSON_HEADERS })
      : error(405, "method_not_allowed", "Use GET.");
  }
  if (pathname === "/api/preview") {
    return request.method === "POST" ? preview(request) : error(405, "method_not_allowed", "Use POST.");
  }
  return error(404, "not_found", "No such endpoint.");
}
