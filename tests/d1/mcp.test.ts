import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { hashAgentKey, newAgentKey } from "../../src/domain/agentKey.ts";
import type { Comparison } from "../../src/domain/compare.ts";
import { newReceiptSecret } from "../../src/domain/receipt.ts";
import type { Statistics } from "../../src/domain/statistics.ts";
import { parseStatsQuery } from "../../src/domain/statsQuery.ts";
import { handleApi } from "../../src/worker/api.ts";
import type { Db } from "../../src/worker/db.ts";
import { saveBoard } from "../../src/worker/events.ts";
import { handleMcp } from "../../src/worker/mcp.ts";
import { localD1 } from "../helpers/d1.ts";
import { datasetRecords } from "../helpers/dataset.ts";
import { csv } from "../helpers/export.ts";

let db: Db;
let dispose: () => Promise<void>;
const clients: Client[] = [];
/** The player's key, linked to their submission of records h1–h6; everyone else supplied the other four. */
let key: string;
let receipt: string;

const ORIGIN = "https://stats.test";
const mcp = (init: RequestInit) => handleMcp(new Request(`${ORIGIN}/mcp`, init), { DB: db });

const weekend = { id: "weekend-2026-10-03", name: "Weekend", startUtc: Date.parse("2026-10-02T00:00:00Z") / 1000, endUtc: Date.parse("2026-10-05T00:00:00Z") / 1000, note: "test" };

beforeAll(async () => {
  const d1 = await localD1();
  db = d1.db;
  dispose = d1.dispose;
  const env = { DB: db, SUBMISSIONS_OPEN: "true" };
  const records = datasetRecords();
  const submit = async (rows: typeof records) => {
    const secret = newReceiptSecret();
    const response = await handleApi(new Request(`${ORIGIN}/api/submissions`, { method: "POST", body: csv(rows.flat()), headers: { authorization: `Receipt ${secret}` } }), env);
    expect(response.status).toBe(201);
    return secret;
  };
  receipt = await submit(records.slice(0, 6));
  await submit(records.slice(6));
  key = newAgentKey();
  expect((await linkKey(receipt, key)).status).toBe(200);
  await saveBoard(db, [weekend], Date.parse("2026-10-04T00:00:00Z") / 1000);
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});
afterAll(() => dispose());

function linkKey(secret: string, agentKey: string): Promise<Response> {
  return hashAgentKey(agentKey).then((keyHash) =>
    handleApi(new Request(`${ORIGIN}/api/agent-keys`, { method: "POST", headers: { authorization: `Receipt ${secret}` }, body: JSON.stringify({ keyHash }) }), { DB: db }),
  );
}

/** An MCP client of the SDK's own, whose requests go straight to the Worker's handler; `headers` as a client would be configured. */
async function connect(headers: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { fetch: (url, init) => handleMcp(new Request(url, init), { DB: db }), requestInit: { headers } }),
  );
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function textOf(result: CallToolResult): string {
  const [first] = result.content;
  if (first?.type !== "text") throw new Error("expected a text result");
  return first.text;
}

async function apiStatistics(query: string): Promise<Statistics> {
  const response = await handleApi(new Request(`${ORIGIN}/api/statistics?${query}`), { DB: db });
  return ((await response.json()) as { statistics: Statistics }).statistics;
}

describe("the MCP server", () => {
  it("offers read-only tools only, and says how to read their numbers", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["compare_with_community", "get_drop_statistics", "get_my_statistics", "get_my_submissions", "list_ingress_events", "read_methodology"]);
    for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(client.getInstructions()).toContain("not the drop rate of every hack");
    expect(client.getServerVersion()?.name).toBe("glyph-drop-stats");
  });

  it("names every statistics argument as the HTTP API's query parameter", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = Object.keys(tools.find((tool) => tool.name === "get_drop_statistics")?.inputSchema.properties ?? {});
    expect(names).toHaveLength(17);
    const own = tools.find((tool) => tool.name === "compare_with_community")?.inputSchema.properties ?? {};
    expect(Object.keys(own).sort()).toEqual([...names, "key"].sort());
    for (const name of names) {
      const parsed = parseStatsQuery(new URLSearchParams({ [name]: "x" }));
      const issues = parsed.ok ? [] : parsed.issues;
      expect(issues.map((issue) => issue.key)).not.toContain("filter.unknown");
    }
  });

  it("answers with the same statistics as the HTTP API", async () => {
    const client = await connect();
    const result = await call(client, "get_drop_statistics", { panels: "portal", multiplied: "include", split: "event", portalLevelMin: 6, portalLevelMax: 6 });
    expect(result.isError).toBeFalsy();
    const statistics = JSON.parse(textOf(result)) as Statistics;
    expect(statistics).toEqual(await apiStatistics("panels=portal&multiplied=include&split=event&portalLevelMin=6&portalLevelMax=6"));
    expect(statistics.selection.matched).toBeGreaterThan(0);
    expect(statistics.groups.map((group) => group.key)).toContain(weekend.id);
  });

  it("uses the page's defaults when given no argument", async () => {
    const client = await connect();
    const statistics = JSON.parse(textOf(await call(client, "get_drop_statistics"))) as Statistics;
    expect(statistics).toEqual(await apiStatistics(""));
  });

  it("explains a filter it refuses, naming the argument", async () => {
    const client = await connect();
    const half = await call(client, "get_drop_statistics", { portalLevelMin: 6 });
    expect(half.isError).toBe(true);
    expect(textOf(half)).toBe("portalLevelMin and portalLevelMax must be given together.");
    const unordered = await call(client, "get_drop_statistics", { utcFrom: "2026-10-03T00:00:00Z", utcTo: "2026-10-02T00:00:00Z" });
    expect(unordered.isError).toBe(true);
    expect(textOf(unordered)).toBe("utcFrom must be before utcTo.");
  });

  it("refuses an argument outside its schema", async () => {
    const client = await connect();
    const result = await call(client, "get_drop_statistics", { portalLevelMin: 9, portalLevelMax: 9 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("portalLevelMin");
  });

  it("lists events with windows that can be passed back as a UTC filter", async () => {
    const client = await connect();
    const { events } = JSON.parse(textOf(await call(client, "list_ingress_events"))) as { events: { id: string; utcFrom: string; utcTo: string }[] };
    expect(events).toEqual([{ id: weekend.id, name: "Weekend", utcFrom: "2026-10-02T00:00:00Z", utcTo: "2026-10-05T00:00:00Z", note: "test" }]);
    const during = await call(client, "get_drop_statistics", { utcFrom: events[0].utcFrom, utcTo: events[0].utcTo });
    expect(during.isError).toBeFalsy();
  });

  it("gives the methodology document itself", async () => {
    const client = await connect();
    expect(textOf(await call(client, "read_methodology"))).toBe(readFileSync(new URL("../../docs/statistics.md", import.meta.url), "utf8"));
  });
});

describe("a player's own records", () => {
  it("need an agent key, and say where to make one", async () => {
    const client = await connect();
    for (const name of ["get_my_submissions", "get_my_statistics", "compare_with_community"]) {
      const result = await call(client, name);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("Submit page");
    }
  });

  it("refuse a receipt given as the key, and warn that it can withdraw", async () => {
    const client = await connect();
    const result = await call(client, "get_my_submissions", { key: receipt });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("can withdraw a submission");
    expect(textOf(result)).not.toContain("countedRecords");
  });

  it("refuse a malformed key, and one that matches nothing", async () => {
    const client = await connect();
    expect(textOf(await call(client, "get_my_submissions", { key: "gdsr_short" }))).toContain("isn't an agent key");
    const unknown = await call(client, "get_my_submissions", { key: newAgentKey() });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain("No agent key matches");
  });

  it("list the key's submissions and how many of their records count", async () => {
    const client = await connect();
    const body = JSON.parse(textOf(await call(client, "get_my_submissions", { key }))) as { submissions: { status: string; submitted: string; rows: number }[]; countedRecords: number };
    expect(body.countedRecords).toBe(6);
    expect(body.submissions).toHaveLength(1);
    expect(body.submissions[0]).toMatchObject({ status: "completed", withdrawn: null });
    expect(body.submissions[0].submitted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("read the key from a configured Authorization header, the model never seeing it", async () => {
    const client = await connect({ authorization: `Bearer ${key}` });
    const body = JSON.parse(textOf(await call(client, "get_my_submissions"))) as { countedRecords: number };
    expect(body.countedRecords).toBe(6);
  });

  it("give statistics over the player's records only, which with everyone else's make the public whole", async () => {
    const client = await connect();
    const filter = { panels: "portal", multiplied: "include" };
    const mine = JSON.parse(textOf(await call(client, "get_my_statistics", { ...filter, key }))) as Statistics;
    const whole = await apiStatistics("panels=portal&multiplied=include");
    expect(mine.records.total).toBe(6);
    const comparison = JSON.parse(textOf(await call(client, "compare_with_community", { ...filter, split: "portalLevel", key }))) as Comparison;
    expect(comparison.you.records).toBe(6);
    expect(comparison.others.records).toBe(4);
    expect(comparison.you.records + comparison.others.records).toBe(whole.summary.records);
    expect(comparison.you.eligible + comparison.others.eligible).toBe(whole.summary.eligible);
    expect(comparison.few).toBe(true);
    expect(comparison.split).toBe("portalLevel");
    for (const row of comparison.items) {
      expect(row.you.quantity + row.others.quantity).toBe(whole.items.byItem.find((total) => total.item === row.item)?.quantity);
    }
  });

  it("explain a refused filter before looking at the key", async () => {
    const client = await connect();
    const result = await call(client, "compare_with_community", { portalLevelMin: 6 });
    expect(textOf(result)).toBe("portalLevelMin and portalLevelMax must be given together.");
  });

  it("stop at once when the key is revoked", async () => {
    const other = newAgentKey();
    expect((await linkKey(receipt, other)).status).toBe(200);
    const client = await connect();
    expect((await call(client, "get_my_submissions", { key: other })).isError).toBeFalsy();
    await handleApi(new Request(`${ORIGIN}/api/agent-key/revoke`, { method: "POST", headers: { authorization: `Agent ${other}` } }), { DB: db });
    expect(textOf(await call(client, "get_my_submissions", { key: other }))).toContain("No agent key matches");
  });
});

describe("report prompts", () => {
  it("offer a community report and a report on the player's own drops", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(["community_report", "my_drop_report"]);
  });

  it("walk the agent through the tools, with the focus and the rules for honest figures", async () => {
    const client = await connect();
    const promptText = (result: GetPromptResult) => {
      const content = result.messages[0]?.content;
      return content?.type === "text" ? content.text : "";
    };
    const mine = promptText(await client.getPrompt({ name: "my_drop_report", arguments: { focus: "P8 portals" } }));
    expect(mine).toContain("Focus on: P8 portals");
    expect(mine).toContain("compare_with_community");
    expect(mine).toContain("Never ask for my receipt");
    expect(mine).toContain("never call them drop rates");
    const community = promptText(await client.getPrompt({ name: "community_report", arguments: {} }));
    expect(community).toContain("get_drop_statistics");
    expect(community).not.toContain("Focus on");
  });
});

describe("the MCP endpoint over HTTP", () => {
  it("answers POST only, with no session, and lets any origin call it", async () => {
    const get = await mcp({ method: "GET", headers: { accept: "text/event-stream" } });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST, OPTIONS");
    expect((await mcp({ method: "DELETE" })).status).toBe(405);

    const preflight = await mcp({ method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("mcp-protocol-version");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");

    const initialize = await mcp({
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "curl", version: "1" } } }),
    });
    expect(initialize.status).toBe(200);
    expect(initialize.headers.get("content-type")).toContain("application/json");
    expect(initialize.headers.get("access-control-allow-origin")).toBe("*");
    expect(initialize.headers.get("mcp-session-id")).toBeNull();
    expect(await initialize.json()).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "glyph-drop-stats" } } });
  });

  it("answers a tool call without a prior initialize, as the curl example in docs/mcp.md sends it", async () => {
    const response = await mcp({
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_ingress_events", arguments: {} } }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: CallToolResult };
    expect(JSON.parse(textOf(body.result))).toMatchObject({ events: [{ id: weekend.id }] });
  });

  it("refuses a receipt or anything but an agent key as the Authorization header", async () => {
    const post = (authorization: string) =>
      mcp({
        method: "POST",
        headers: { authorization, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    const withReceipt = await post(`Bearer ${receipt}`);
    expect(withReceipt.status).toBe(400);
    expect(JSON.stringify(await withReceipt.json())).toContain("can withdraw a submission");
    expect((await post("Basic dXNlcjpwYXNz")).status).toBe(400);
    expect((await post(`Bearer ${key}`)).status).toBe(200);
  });

  it("refuses an oversized body before reading it", async () => {
    const response = await mcp({ method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: " ".repeat(65 * 1024) });
    expect(response.status).toBe(413);
  });
});
