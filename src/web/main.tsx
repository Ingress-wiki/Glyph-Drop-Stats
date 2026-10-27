import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { newReceiptSecret } from "../domain/receipt.ts";
import { confirmUpload, fetchConfig, fetchStatistics, previewFile, submissionStatus, withdrawUpload } from "./api.ts";
import { App } from "./App.tsx";
import { Store, type View } from "./app/store.ts";
import { detectLocale, isLocale, LOCALE_KEY, type Locale } from "./i18n/index.ts";
import "./index.css";

const viewFromHash = (): View => (window.location.hash === "#submit" ? "submit" : "statistics");

/** Preferences only: failing storage (private windows, blocked site data) just means they aren't kept. */
const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Not kept; the page works the same.
    }
  },
};

/** Preferences of the canvas interface this page replaced: a returning visitor's are deleted. */
const RETIRED_KEYS = ["crt", "smooth-text", "cjk-size", "text-view"].map((name) => `glyph-drop-stats:${name}`);
try {
  for (const key of RETIRED_KEYS) window.localStorage.removeItem(key);
} catch {
  // Storage blocked: there is nothing stored to delete.
}

/** The language chosen here before, else the first of the browser's languages this site speaks. */
function initialLocale(): Locale {
  const saved = storage.get(LOCALE_KEY);
  return isLocale(saved) ? saved : detectLocale(navigator.languages ?? [navigator.language]);
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The async clipboard API exists only in secure contexts (HTTPS, localhost). Elsewhere,
 * such as a LAN address over HTTP, copy through a selected, off-screen text area.
 */
async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.className = "copy-buffer";
  document.body.append(area);
  area.select();
  // Deprecated, but the only way to copy without a secure context.
  const copied = document.execCommand("copy");
  area.remove();
  restoreFocus?.focus();
  if (!copied) throw new Error("The browser refused to copy");
}

const store = new Store(
  {
    previewFile,
    confirmUpload,
    submissionStatus,
    withdrawUpload,
    fetchStatistics,
    fetchConfig,
    newSecret: newReceiptSecret,
    download,
    copy: copyText,
    storage,
    setHash: (view) =>
      window.history.replaceState(null, "", view === "submit" ? "#submit" : window.location.pathname + window.location.search),
    origin: window.location.origin,
    now: () => new Date(),
  },
  viewFromHash(),
  initialLocale(),
);

// A file dropped anywhere on the page is checked in the submit view.
window.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files[0];
  if (!file) return;
  event.preventDefault();
  store.setView("submit");
  store.chooseFile(file);
});
window.addEventListener("hashchange", () => store.setView(viewFromHash()));

// F1/F2 switch views, F3 the filters, F4 the guide. Not while a dialog is open: it keeps the keyboard.
document.addEventListener("keydown", (event) => {
  if (event.repeat || !["F1", "F2", "F3", "F4"].includes(event.key)) return;
  if (store.dialogOpen()) return;
  switch (event.key) {
    case "F1":
      store.setView("statistics");
      break;
    case "F2":
      store.setView("submit");
      break;
    case "F3":
      if (store.state.view !== "statistics") return;
      store.toggleFilters();
      break;
    case "F4":
      if (store.state.view !== "statistics") return;
      store.setGuideOpen(true);
      break;
  }
  event.preventDefault();
});

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
void store.loadConfig();
if (store.state.view === "statistics") void store.loadStatistics("");
