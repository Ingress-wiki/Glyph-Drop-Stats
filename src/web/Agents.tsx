import type { AppState, Store } from "./app/store.ts";
import { messages } from "./i18n/index.ts";
import { MCP_GUIDE_URL } from "./site.ts";

/** A command or address to copy as written: shown in full, selected in one click, with a copy button named after it. */
function Copyable({ store, label, text, copy }: { store: Store; label: string; text: string; copy: string }) {
  return (
    <div className="copyable">
      <code>{text}</code>
      <button type="button" aria-label={`${copy}: ${label}`} onClick={() => void store.copyText(text)}>
        {copy}
      </button>
    </div>
  );
}

/**
 * The landing page for the MCP server: what an AI agent can do with the
 * site, how to connect one, and how a player lets it read their own drops.
 * The addresses come from the page's own origin, so a local or preview
 * deployment shows its own.
 */
export function AgentsView({ store, state }: { store: Store; state: AppState }) {
  const s = messages(state.locale);
  const a = s.agents;
  const server = `${window.location.origin}/mcp`;
  return (
    <div className="page agents">
      <section>
        <h2>{a.title}</h2>
        <p className="lede">{a.lede}</p>
        <div className="receipt">
          <p className="label">{a.address}</p>
          <Copyable store={store} label={a.address} text={server} copy={a.copy} />
        </div>
      </section>

      <section>
        <h2>{a.askHeading}</h2>
        <ul className="examples">
          {a.examples.map((example) => (
            <li key={example}>{example}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{a.connectHeading}</h2>
        <p>{a.claude}</p>
        <p>{a.claudeCode}</p>
        <Copyable store={store} label="Claude Code" text={`claude mcp add --transport http glyph-drop-stats ${server}`} copy={a.copy} />
        <p>{a.others}</p>
        <Copyable store={store} label="mcp-remote" text={`npx mcp-remote ${server}`} copy={a.copy} />
      </section>

      <section>
        <h2>{a.ownHeading}</h2>
        {state.testPeriod && <p className="notice">{a.testPeriod}</p>}
        <ol>
          {a.ownSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <Copyable store={store} label={`Claude Code, ${s.agentKey.heading}`} text={`claude mcp add --transport http glyph-drop-stats ${server} --header "Authorization: Bearer gdsr_…"`} copy={a.copy} />
        <p className="notice" role="note">
          {a.receiptWarning}
        </p>
        <p>
          <button type="button" className="primary" onClick={() => store.setView("submit")}>
            {a.toSubmit}
          </button>
        </p>
      </section>

      <section>
        <h2>{a.reportsHeading}</h2>
        <p>{a.reports}</p>
      </section>

      <section>
        <h2>{a.toolsHeading}</h2>
        <ul className="tools">
          {Object.entries(a.tools).map(([tool, what]) => (
            <li key={tool}>
              <code>{tool}</code> {what}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{a.limitsHeading}</h2>
        <ul>
          {a.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
        <p>
          <a href={MCP_GUIDE_URL} target="_blank" rel="noreferrer">
            {a.docs}
          </a>
        </p>
      </section>
    </div>
  );
}
