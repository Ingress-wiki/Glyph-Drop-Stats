import { createViewHost, DEFAULT_FX, type ViewHost } from "@synth-ui/backend";
import { newReceiptSecret } from "../domain/receipt.ts";
import { confirmUpload, fetchConfig, fetchStatistics, previewFile, submissionStatus, withdrawUpload } from "./api.ts";
import { announcement, renderMirror } from "./app/mirror.ts";
import { Store, type View } from "./app/store.ts";
import { detectLocale, isLocale, LOCALE_KEY, messages, type Locale } from "./i18n/index.ts";
import { paint } from "./canvas/app.ts";
import { TextLayer } from "./canvas/textLayer.ts";
import { COLORS, FONTS, PALETTE } from "./canvas/theme.ts";
import { endFrame } from "./canvas/ui.ts";
import { SOURCE_URL } from "./site.ts";
import "./index.css";

function element<T extends HTMLElement>(id: string, type: { new (): T; prototype: T }): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`index.html has no #${id} of the expected kind`);
  return node;
}

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

/** The language chosen here before, else the first of the browser's languages this site speaks. */
function initialLocale(): Locale {
  const saved = storage.get(LOCALE_KEY);
  return isLocale(saved) ? saved : detectLocale(navigator.languages ?? [navigator.language]);
}

/** The page's own text outside the canvas and the mirror, in `locale`. */
function localizePage(locale: Locale, canvas: HTMLCanvasElement): void {
  const s = messages(locale);
  document.documentElement.lang = locale;
  document.title = s.app.title;
  canvas.setAttribute("aria-label", s.app.canvasLabel);
  element("fallback-text", HTMLElement).textContent = s.app.fallback;
  element("canvas-view", HTMLButtonElement).textContent = s.app.backToCanvas;
  element("text-view-note", HTMLElement).textContent = s.app.textViewNote;
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
async function copyText(text: string, restoreFocus: HTMLElement): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.className = "copy-buffer";
  document.body.append(area);
  area.select();
  // Deprecated, but the only way to copy without a secure context.
  const copied = document.execCommand("copy");
  area.remove();
  restoreFocus.focus();
  if (!copied) throw new Error("The browser refused to copy");
}

async function main(): Promise<void> {
  const canvas = element("screen", HTMLCanvasElement);
  const textLayer = new TextLayer(canvas, element("canvas-text", HTMLElement));
  const mirror = element("mirror", HTMLElement);
  const live = element("live", HTMLElement);
  const focusLive = element("focus-live", HTMLElement);
  const fileInput = element("file", HTMLInputElement);

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
      copy: (text) => copyText(text, canvas),
      storage,
      setHash: (view) =>
        window.history.replaceState(null, "", view === "submit" ? "#submit" : window.location.pathname + window.location.search),
      origin: window.location.origin,
      now: () => new Date(),
    },
    viewFromHash(),
    initialLocale(),
  );

  // The canvas can't hold a native file picker, so a hidden input does; the canvas's
  // CHOOSE FILE button opens it. Clearing it lets the same file be chosen again.
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0] ?? null;
    fileInput.value = "";
    if (file) store.chooseFile(file);
  });
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

  // The text view shows the mirror on screen in place of the canvas.
  const backToCanvas = element("canvas-view", HTMLButtonElement);
  backToCanvas.addEventListener("click", () => store.setTextView(false));
  // Native selection moves focus away from the canvas. Keep page shortcuts
  // available there and in the text view, without sending them twice to the host.
  document.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    const isShortcut = ["F1", "F2", "F3", "F4", "F8", "F9"].includes(event.key);
    if (!isShortcut) return;
    // While the canvas shows a dialog, it keeps the page: only the text view switch
    // still works (the dialog's text is in the text view too).
    if (event.key !== "F9" && store.dialogOpen() && !store.state.textView) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    switch (event.key) {
      case "F1": store.setView("statistics"); break;
      case "F2": store.setView("submit"); break;
      case "F3":
        if (store.state.view !== "statistics") return;
        store.toggleFilters();
        break;
      case "F4":
        if (store.state.view !== "statistics") return;
        store.setGuideOpen(true);
        break;
      case "F8": store.toggleCrt(); break;
      case "F9": store.setTextView(!store.state.textView); break;
      default: return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  let host: ViewHost | null = null;
  let previous = store.state;
  const showTextView = (on: boolean) => {
    document.body.classList.toggle("text-view", on);
    if (!host) return;
    if (on) {
      host.stop();
      backToCanvas.focus();
    } else {
      host.start();
      canvas.focus();
    }
  };
  store.subscribe(() => {
    const next = store.state;
    const said = announcement(previous, next);
    if (next.textView !== previous.textView) showTextView(next.textView);
    if (next.locale !== previous.locale) localizePage(next.locale, canvas);
    previous = next;
    if (said) live.textContent = said;
    renderMirror(next, mirror);
    textLayer.smooth = next.smoothText;
    if (host) {
      host.fx.enabled = next.crt;
      // A control the canvas draws can change the state mid-frame, and an invalidation
      // then is lost when the frame ends: ask for the next frame once this one is done.
      queueMicrotask(() => host?.invalidate());
    }
  });
  localizePage(store.state.locale, canvas);
  renderMirror(store.state, mirror);
  textLayer.smooth = store.state.smoothText;

  const env = {
    openFilePicker: () => fileInput.click(),
    openSource: () => window.open(SOURCE_URL, "_blank", "noopener,noreferrer"),
  };
  try {
    host = await createViewHost(
      canvas,
      (ctx) => {
        if (host) textLayer.paint(host.ui, () => paint(ctx, store, env));
        else paint(ctx, store, env);
        const focused = endFrame();
        if (focused) focusLive.textContent = focused;
      },
      {
        // 120%: two CSS pixels per virtual pixel read as too small.
        pixelScale: 2.4,
        palette: PALETTE,
        fonts: FONTS,
        defaultFont: "text",
        background: COLORS.bg,
        fx: { ...DEFAULT_FX, enabled: store.state.crt },
        redraw: "auto",
        label: store.strings.app.canvasLabel,
      },
    );
    localizePage(store.state.locale, canvas);
    if (store.state.textView) showTextView(true);
    else canvas.focus();
  } catch (error) {
    // No WebGPU or WebGL2: show the text version instead of a blank page. The host may have
    // styled the canvas inline, so it is removed rather than hidden.
    canvas.remove();
    document.body.classList.add("fallback");
    element("fallback-reason", HTMLElement).textContent = error instanceof Error ? error.message : String(error);
  }
  void store.loadConfig();
  if (store.state.view === "statistics") void store.loadStatistics("");
}

void main();
