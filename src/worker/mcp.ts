import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult, GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import methodology from "../../docs/statistics.md?raw";
import { hashAgentKey, isAgentKey } from "../domain/agentKey.ts";
import { compareStatistics } from "../domain/compare.ts";
import { PORTAL_ALIGNMENTS } from "../domain/format.ts";
import { isReceiptSecret } from "../domain/receipt.ts";
import { SPLITS, type StatsFilter } from "../domain/statistics.ts";
import { parseStatsQuery } from "../domain/statsQuery.ts";
import type { SubmissionSummary } from "../domain/submission.ts";
import { keyUploads, ownRecordIds } from "./agentKeys.ts";
import type { Db } from "./db.ts";
import { loadEvents } from "./events.ts";
import { ownStatistics, statistics } from "./statistics.ts";
import { uploadSummaries } from "./submissions.ts";

/**
 * A read-only MCP server, so a player's own AI agent can analyze the
 * statistics the page shows and, with a read-only agent key, the player's
 * own submitted records against everyone else's. It is stateless: every
 * POST builds a fresh server, answers with JSON and keeps nothing, so it
 * needs no Durable Object and no session store. Nothing here can submit,
 * look up a receipt or withdraw.
 */

export interface McpEnv {
  DB: Db;
}

/** A JSON-RPC request is small; the transport refuses anything larger before parsing it. */
const MAX_BODY = 64 * 1024;

const SITE = "Glyph Drop Stats (stats.ingress.wiki)";

const INSTRUCTIONS = `${SITE} publishes Ingress hack drop statistics built from observations that players chose to submit, read from their screens by the DynamicGlyph app.
Public: get_drop_statistics for numbers (every argument is optional; filters narrow the records and split compares groups), list_ingress_events for event windows to filter by, read_methodology for the rules behind every number. Read it before drawing conclusions.
A player's own records: get_my_submissions, get_my_statistics and compare_with_community need their read-only agent key (gdsr_…), made on the site's Submit page, either configured as an Authorization: Bearer header or passed as the key argument. Never ask for or use a receipt (gds1_…): it can withdraw a submission.
These are descriptive counts of a self-selected sample, not the drop rate of every hack. Records a filter can't judge are set aside and counted (selection.unplaced), not guessed. Observations whose panels weren't fully read are left out of item figures and counted in items.excluded. Figures from fewer than 30 eligible observations are weak, and records cluster by player and session, so no difference is significant in itself.`;

const iso = (seconds: number) => new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
const text = (body: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: body }], ...(isError ? { isError } : {}) });
const refusal = (body: string) => text(body, true);

const timestamp = (what: string) => z.string().describe(`${what}, as YYYY-MM-DDTHH:MM:SSZ. Give it with its pair.`);
const localDate = (what: string) => z.string().describe(`${what}, as YYYY-MM-DD in the player's local time. Give it with its pair.`);
const bounded = (min: number, max: number, what: string) => z.number().int().min(min).max(max).describe(`${what}. Give it with its pair.`);

/** Named exactly as the HTTP API's query parameters, so its English error messages name the argument at fault. */
const STATISTICS_ARGUMENTS = {
  kind: z.enum(["hack", "drop"]).optional().describe("hack: a hack result with its panels. drop: a group of panels the app couldn't tie to a confirmed hack. Both when omitted."),
  utcFrom: timestamp("Start of a UTC window; a record counts only if its whole interval is inside").optional(),
  utcTo: timestamp("End of the UTC window, exclusive").optional(),
  localDateFrom: localDate("First local date").optional(),
  localDateTo: localDate("Last local date, inclusive").optional(),
  localHourFrom: bounded(0, 23, "First local hour").optional(),
  localHourTo: bounded(0, 23, "Last local hour, inclusive").optional(),
  portalLevelMin: bounded(1, 8, "Lowest portal level").optional(),
  portalLevelMax: bounded(1, 8, "Highest portal level").optional(),
  hackingBonusMin: bounded(0, 1000, "Lowest final hacking bonus, in percent").optional(),
  hackingBonusMax: bounded(0, 1000, "Highest final hacking bonus, in percent").optional(),
  speedBonusMin: bounded(0, 1000, "Lowest final speed bonus, in percent").optional(),
  speedBonusMax: bounded(0, 1000, "Highest final speed bonus, in percent").optional(),
  alignment: z.enum(PORTAL_ALIGNMENTS).optional().describe("The hacked portal's alignment relative to the player. Only newer app builds record it; other records are set aside."),
  panels: z.enum(["portal", "bonus", "both"]).optional().describe("Which item panels count: the portal's own, the hacking-bonus panel, or both (the default)."),
  multiplied: z
    .enum(["include", "exclude"])
    .optional()
    .describe("exclude (the default) leaves out observations with a multiplied quantity, whose factor the app doesn't record; include counts every quantity as shown."),
  split: z
    .enum(SPLITS)
    .optional()
    .describe("How groups are formed for comparison (default alignment). event: Ingress events, which overlap, so a record can be in several. week and day: UTC periods."),
};

const KEY_ARGUMENT = {
  key: z
    .string()
    .optional()
    .describe(
      "The player's read-only agent key (gdsr_…), made on the site's Submit page. Leave it out when the key is configured as this server's Authorization: Bearer header. Never pass a receipt (gds1_…): a receipt can withdraw a submission.",
    ),
};

type StatisticsArguments = { [K in keyof typeof STATISTICS_ARGUMENTS]?: z.infer<(typeof STATISTICS_ARGUMENTS)[K]> };

/** The filter the arguments describe, checked by the API's own parser. */
function filterOf(args: StatisticsArguments): { ok: true; filter: StatsFilter } | { ok: false; refusal: CallToolResult } {
  const params = new URLSearchParams();
  for (const name of Object.keys(STATISTICS_ARGUMENTS) as (keyof StatisticsArguments)[]) {
    const value = args[name];
    if (value !== undefined) params.set(name, String(value));
  }
  const parsed = parseStatsQuery(params);
  return parsed.ok ? parsed : { ok: false, refusal: refusal(parsed.issues.map((issue) => issue.message).join("\n")) };
}

const NO_KEY = `This tool reads the player's own submitted records, so it needs their read-only agent key (gdsr_…). They make one on the Submit page of ${SITE}: look the submission up with its receipt, then create a key. Pass it as key, or configure it as this server's Authorization: Bearer header.`;
const RECEIPT_GIVEN =
  "That is a receipt (gds1_…), not an agent key. A receipt can withdraw a submission, so it must not be shared with an agent: it was not used. Make a read-only agent key on the site's Submit page instead, and consider the receipt exposed if it was pasted into a chat.";

/** The uploads a key reads, or why it can't be used. The argument, given on purpose, wins over the configured header. */
async function uploadsOf(db: Db, argument: string | undefined, header: string | null): Promise<{ ok: true; uploads: number[] } | { ok: false; refusal: CallToolResult }> {
  const key = argument?.trim() || header;
  if (!key) return { ok: false, refusal: refusal(NO_KEY) };
  if (isReceiptSecret(key)) return { ok: false, refusal: refusal(RECEIPT_GIVEN) };
  if (!isAgentKey(key)) return { ok: false, refusal: refusal("That isn't an agent key: one is gdsr_ followed by 43 letters, digits, - or _.") };
  const uploads = await keyUploads(db, await hashAgentKey(key));
  if (uploads === null) {
    return { ok: false, refusal: refusal("No agent key matches. It may have been revoked, or deleted with its submissions when the site's test period ended. Make a new one on the Submit page.") };
  }
  return { ok: true, uploads };
}

const submissionView = (summary: SubmissionSummary) => ({
  status: summary.status,
  submitted: iso(summary.createdAt),
  withdrawn: summary.withdrawnAt === null ? null : iso(summary.withdrawnAt),
  rows: summary.rowCount,
  rejected: summary.rejected,
  outcomes: summary.outcomes,
});

const REPORT_RULES = `Rules for every figure:
- Give it with its denominator (eligible observations, records).
- Call figures from fewer than 30 eligible observations weak, and draw no conclusion from them.
- These are counts of what players chose to submit, as the app read them: never call them drop rates.
- Claim no statistical significance: records cluster by player and session.
- Differences can come from what the data doesn't record, such as agent level, mods and hack type; say so where it matters.`;

const focusLine = (focus: string | undefined) => (focus?.trim() ? `\nFocus on: ${focus.trim()}` : "");

function prompt(body: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text: body } }] };
}

function createServer(db: Db, headerKey: string | null): McpServer {
  const server = new McpServer({ name: "glyph-drop-stats", title: "Glyph Drop Stats", version: "1.1.0" }, { instructions: INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
  const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

  server.registerTool(
    "get_drop_statistics",
    {
      title: "Drop statistics",
      description:
        "Live item drop statistics from every submitted Ingress hack, the same numbers the website shows. Returns JSON: filter (as applied), selection (matched records; unplaced counts records a filter couldn't judge, by reason), records (counts by kind, read status, panel coverage and app build), summary and groups (per split group: records, eligible observations, total quantity, average items per observation, rare and key shares, and portalLevels/levelGrid item counts by level), events, and items (eligible observations, exclusions by reason, and per item: quantity, averagePerObservation, multiplied counts, levels, observations, rarities, distribution of counts 0–10+, variance).",
      inputSchema: STATISTICS_ARGUMENTS,
      annotations: readOnly,
    },
    async (args) => {
      const parsed = filterOf(args);
      if (!parsed.ok) return parsed.refusal;
      return text(JSON.stringify(await statistics(db, parsed.filter)));
    },
  );

  server.registerTool(
    "list_ingress_events",
    {
      title: "Ingress events",
      description:
        "The Ingress events known to the site, read daily from the game's activity board, with UTC windows ready to pass as utcFrom and utcTo. Local-time events (First Saturday, Second Sunday) are widened to the UTC window they cover in every time zone.",
      annotations: readOnly,
    },
    async () => {
      const events = await loadEvents(db);
      return text(JSON.stringify({ events: events.map((event) => ({ id: event.id, name: event.name, utcFrom: iso(event.startUtc), utcTo: iso(event.endUtc), note: event.note })) }));
    },
  );

  server.registerTool(
    "read_methodology",
    {
      title: "How the statistics are made",
      description: "The rules behind every published number: what the data is and isn't, which records count, how filters place records, and what each figure means. Read it before interpreting results.",
      annotations: readOnly,
    },
    async () => text(methodology),
  );

  server.registerTool(
    "get_my_submissions",
    {
      title: "My submissions",
      description:
        "The player's submissions that their agent key covers: when each was submitted, whether it was withdrawn, its rows, and how its records were classified. countedRecords is how many of their records count now. Needs their read-only agent key.",
      inputSchema: KEY_ARGUMENT,
      annotations: readOnly,
    },
    async ({ key }) => {
      const owner = await uploadsOf(db, key, headerKey);
      if (!owner.ok) return owner.refusal;
      const [summaries, own] = await Promise.all([uploadSummaries(db, owner.uploads), ownRecordIds(db, owner.uploads)]);
      return text(JSON.stringify({ submissions: summaries.map(submissionView), countedRecords: own.size }));
    },
  );

  server.registerTool(
    "get_my_statistics",
    {
      title: "My drop statistics",
      description:
        "The same statistics as get_drop_statistics, over the player's own counted records only: those their agent key's active submissions supply. Takes the same filters. Needs their read-only agent key.",
      inputSchema: { ...STATISTICS_ARGUMENTS, ...KEY_ARGUMENT },
      annotations: readOnly,
    },
    async (args) => {
      const parsed = filterOf(args);
      if (!parsed.ok) return parsed.refusal;
      const owner = await uploadsOf(db, args.key, headerKey);
      if (!owner.ok) return owner.refusal;
      const { mine } = await ownStatistics(db, parsed.filter, await ownRecordIds(db, owner.uploads));
      return text(JSON.stringify(mine));
    },
  );

  server.registerTool(
    "compare_with_community",
    {
      title: "Me against everyone else",
      description:
        "The player's records against everyone else's under the same filters; everyone else never includes the player's records. Returns JSON: few (true when fewer than 30 of the player's observations are eligible for items), you and others (records, eligible observations, total quantity, average items per observation, rare and key shares), itemEligible (the item averages' denominators), items (per item: each side's quantity, average per observation and observations; expected, what the player's eligible observations would hold at everyone else's average; ratio, the player's quantity ÷ expected), and groups (both sides per split group). Needs their read-only agent key.",
      inputSchema: { ...STATISTICS_ARGUMENTS, ...KEY_ARGUMENT },
      annotations: readOnly,
    },
    async (args) => {
      const parsed = filterOf(args);
      if (!parsed.ok) return parsed.refusal;
      const owner = await uploadsOf(db, args.key, headerKey);
      if (!owner.ok) return owner.refusal;
      const { mine, others } = await ownStatistics(db, parsed.filter, await ownRecordIds(db, owner.uploads));
      return text(JSON.stringify(compareStatistics(mine, others)));
    },
  );

  const focus = { focus: z.string().optional().describe("What to look at, e.g. portal levels, an event, rare items or Power Cubes.") };

  server.registerPrompt(
    "community_report",
    { title: "Community drop report", description: `A report on everyone's submitted hack drops at ${SITE}.`, argsSchema: focus },
    ({ focus: topic }) =>
      prompt(`Write a report on Ingress hack drops from ${SITE}.${focusLine(topic)}

1. Call read_methodology and follow it.
2. Call get_drop_statistics with no arguments for the overview, then with the filters and split the focus needs. For an event, call list_ingress_events, then use split "event" or its utcFrom and utcTo.
3. Write the report in the user's language, in this order:
   - Sample: records, eligible observations, uploads, and what was excluded or set aside, and why.
   - Headline: items per eligible observation, and the shares of observations with a rare item and with a key.
   - Items: a table of each item's quantity, average per observation and observations.
   - Comparison: the split's groups side by side.
   - What this can't tell you.

${REPORT_RULES}`),
  );

  server.registerPrompt(
    "my_drop_report",
    { title: "My drop report", description: `A report on my own submitted hack drops at ${SITE}, against everyone else's. Needs my read-only agent key.`, argsSchema: focus },
    ({ focus: topic }) =>
      prompt(`Write a report on my own Ingress hack drops, as I submitted them to ${SITE}, against everyone else's.${focusLine(topic)}

1. Call read_methodology and follow it.
2. Call get_my_submissions. If a tool says it needs a key, ask me for my read-only agent key (gdsr_…), which I make on the site's Submit page. Never ask for my receipt (gds1_…), and don't use one if I give it: a receipt can withdraw my submission.
3. Call compare_with_community with no filters, then with split "portalLevel", then with whatever filters or split the focus needs.
4. Write the report in my language, in this order:
   - My sample: my submissions, records and eligible observations, and what was excluded. If "few" is true, say plainly at the top that my sample is too small to conclude much.
   - Headline: my items per eligible observation against everyone else's.
   - Items: a table of my quantity, what I'd expect at everyone else's average, the ratio, and everyone else's average per observation.
   - By portal level: my groups against everyone else's.
   - Rare items and keys: my shares against everyone else's.
   - What this can't tell me.

"Everyone else" never includes my records. A ratio built on few observations means little.
${REPORT_RULES}`),
  );

  return server;
}

/** The data is public and a key is read-only, so any origin may call it, browser-based agents included. */
const CORS = { "access-control-allow-origin": "*" };
const PREFLIGHT = {
  ...CORS,
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-max-age": "86400",
};

function withCors(response: Response): Response {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(CORS)) copy.headers.set(name, value);
  return copy;
}

const rpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, { status, headers: { ...CORS, ...headers } });

/** A key configured as `Authorization: Bearer gdsr_…`, which the model never sees. */
function headerKeyOf(request: Request): { ok: true; key: string | null } | { ok: false; response: Response } {
  const header = request.headers.get("authorization");
  if (header === null) return { ok: true, key: null };
  const match = /^Bearer (\S+)$/.exec(header);
  if (match && isAgentKey(match[1])) return { ok: true, key: match[1] };
  if (match && isReceiptSecret(match[1])) return { ok: false, response: rpcError(400, RECEIPT_GIVEN) };
  return { ok: false, response: rpcError(400, "Authorization must be Bearer followed by a read-only agent key (gdsr_…), or left out for the public tools.") };
}

/**
 * Streamable HTTP, stateless and JSON-only. GET would open a stream for
 * server-sent messages and DELETE would end a session; this server has
 * neither, so both are refused, as the transport specification allows.
 */
export async function handleMcp(request: Request, env: McpEnv): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: PREFLIGHT });
  if (request.method !== "POST") return rpcError(405, "Method not allowed: this MCP server is stateless and answers POST only.", { allow: "POST, OPTIONS" });
  const header = headerKeyOf(request);
  if (!header.ok) return header.response;
  const server = createServer(env.DB, header.key);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_BODY });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request));
  } finally {
    await server.close();
  }
}
