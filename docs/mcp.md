# MCP: the statistics for AI agents

The site runs a [Model Context Protocol](https://modelcontextprotocol.io)
server, so you can ask your own AI agent to analyze Glyph Drop Stats: write
a report on everyone's drops, or on **your own** drops against everyone
else's.

```
https://stats.ingress.wiki/mcp
```

The site's **AI agents** page (`https://stats.ingress.wiki/#agents`, in the
top bar) explains all this in the page's five languages, with commands to
copy. This document is the full reference.

Everything through it is read-only. The public tools need no sign-in.
Your own records need a read-only **agent key**. Nothing through the server
can submit, look up a receipt or withdraw.

## Connecting

The server uses the Streamable HTTP transport. Add it as a remote MCP server
in any client that supports one:

- **Claude** (claude.ai, desktop): *Settings → Connectors → Add custom
  connector*, with the address above.
- **Claude Code**: `claude mcp add --transport http glyph-drop-stats https://stats.ingress.wiki/mcp`
- **Other clients** (Cursor, VS Code, ChatGPT and others): add a remote or
  HTTP server with the address above. A client that only starts local
  servers can reach it through `npx mcp-remote https://stats.ingress.wiki/mcp`.

## Your own drops: the agent key

1. Submit your export on the site, and keep the receipt.
2. On the Submit page, under *Check or withdraw a submission*, paste the
   receipt and press *Check*.
3. Under *AI agent key*, press *Create a key*. Copy the key (`gdsr_…`): it
   is shown once.
4. To cover another submission, look it up with its receipt, paste the key
   and press *Add this submission*. One key covers up to 100 submissions.

With an optional [account](accounts.md), make the key on the **Account**
page instead: it reads every submission in your account, including ones
you add later, so it needs no linking.

Then give the key to your agent in one of two ways:

- **As a header**, where the client supports it. The model never sees the
  key. Claude Code:
  `claude mcp add --transport http glyph-drop-stats https://stats.ingress.wiki/mcp --header "Authorization: Bearer gdsr_…"`.
  Through mcp-remote: `npx mcp-remote https://stats.ingress.wiki/mcp --header "Authorization: Bearer gdsr_…"`.
- **In the chat**, where it doesn't (claude.ai and ChatGPT connectors offer
  only OAuth or no sign-in). Paste the key when the agent asks for it. It
  then sits in the chat's history with the AI provider.

**What a key can and can't do.** It reads the records of the submissions it
covers that still count, and nothing else. It can't withdraw, look up a
receipt or read anyone else's records. Anyone holding it can read those
records, so revoke it from the same section (*Revoke key*) once you're done
or if it leaks. A withdrawn submission stops being read at once.

**Never give an agent your receipt** (`gds1_…`). A receipt can withdraw your
submission. The server refuses a receipt in place of a key and says why.

During the test period, keys are deleted with the submissions when the
test data is wiped.

## Reports

Two prompts, which Claude clients show as slash commands:

| Prompt | Writes |
| --- | --- |
| `community_report` | A report on everyone's submitted drops. |
| `my_drop_report` | A report on your drops against everyone else's. Needs your key. |

Each takes an optional `focus` (*P8 portals*, *Year 14 - Vector*, *rare
items*…). They tell the agent which tools to call and in what order, and
how to write the report:

- sample sizes first;
- figures from fewer than 30 eligible observations called weak;
- no figure called a drop rate, and no claim of significance;
- a closing section on what the data can't tell you.

## Tools

| Tool | Gives |
| --- | --- |
| `get_drop_statistics` | The statistics as JSON, exactly as `GET /api/statistics` returns them. |
| `list_ingress_events` | The Ingress events from the game's activity board, each with a UTC window ready to pass as `utcFrom` and `utcTo`. |
| `read_methodology` | [statistics.md](statistics.md), the rules behind every number. |
| `get_my_submissions` | The submissions your key covers, and how many of their records count now. |
| `get_my_statistics` | The same statistics as `get_drop_statistics`, over your records only. |
| `compare_with_community` | Your records against everyone else's, under the same filters. |

The statistics tools take the filters of `GET /api/statistics` as
arguments, with the same names and meanings: `kind`, `utcFrom`/`utcTo`,
`localDateFrom`/`localDateTo`, `localHourFrom`/`localHourTo`,
`portalLevelMin`/`portalLevelMax`, `hackingBonusMin`/`hackingBonusMax`,
`speedBonusMin`/`speedBonusMax`, `alignment`, `panels`, `multiplied` and
`split`. A refused filter is explained in the API's own words. The three
`my` tools also take `key`, which overrides the configured header.

### Comparing with everyone else

"Yours" are the counted records that your key's active submissions supply.
"Everyone else" is every other counted record. The two sides never share a
record, so you are never partly compared with yourself.

For each item, `compare_with_community` gives:

- each side's quantity, average per eligible observation, and the number
  of observations with at least one;
- `expected`: everyone else's average times your eligible observations;
- `ratio`: your quantity ÷ `expected`.

`few` is true when fewer than 30 of your observations are eligible. With
`split`, both sides are given per group, for example P6 against P8.

These are descriptions, not tests. Records cluster by player and session,
and agent level, mods and hack type aren't recorded, so a ratio away from 1
proves nothing by itself.

## How it works

`src/worker/mcp.ts` builds the server with the official TypeScript SDK on
every POST and answers with JSON. It keeps no session, so it needs no
Durable Object. `GET` and `DELETE` get 405, because there is no stream of
server messages and no session to end. Bodies over 64 KiB are refused
before they are read. Any origin may call it: the public data is public,
and a key is read-only.

The tools reuse the API's own query parser (`src/domain/statsQuery.ts`) and
statistics (`src/worker/statistics.ts`), so an agent and the page can't
disagree. `ownStatistics` loads the counted records once and splits them
by owner. `compareStatistics` (`src/domain/compare.ts`) builds the
comparison.

Keys are made in the browser, like receipts (`src/domain/agentKey.ts`):

- `POST /api/agent-keys` links a submission. The receipt goes in the
  header and only the key's SHA-256 in the body, so the server never holds
  a usable key.
- `POST /api/agent-key/revoke` (`Authorization: Agent gdsr_…`) deletes the
  key and its links.

Both are idempotent. `src/worker/agentKeys.ts` holds the tables' rules.

Tests:

- `tests/d1/mcp.test.ts` drives the server with the SDK's client.
- `tests/d1/agentKeys.test.ts` covers linking, withdrawal, the limit,
  revoking and the wipe.
- `tests/compare.test.ts` checks that the two sides add up to the whole.

Try the public tools from a terminal:

```sh
curl -s https://stats.ingress.wiki/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_ingress_events","arguments":{}}}'
```
