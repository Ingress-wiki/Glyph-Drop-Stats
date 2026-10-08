import type { Context } from "@synth-ui/core";
import { scrollView, sheet, statusLine, tooltip, useTheme, type StatusMessage } from "@synth-ui/widgets";
import type { AppState, Store, View } from "../app/store.ts";
import { LOCALES, messages, problemText } from "../i18n/index.ts";
import { drawStatistics } from "./statisticsView.ts";
import { drawSubmit, type SubmitEnv } from "./submitView.ts";

export interface PageEnv extends SubmitEnv {
  /** Opens the site's code on GitHub in a new tab. */
  openSource(): void;
}
import { FONT, fontRoles, useLocale } from "./theme.ts";
import { actionButton, beginFrame, buttonHeight, bullets, drawFocusRing, errorLine, lineHeight, paragraph, pressable } from "./ui.ts";

const TABS: readonly { view: View; key: string }[] = [
  { view: "statistics", key: "F1" },
  { view: "submit", key: "F2" },
];

/**
 * The status line shows a message again whenever it gets a new object, so
 * each notice from the store becomes one message, kept while it's current.
 */
let shownNotice: AppState["notice"] = null;
let shownMessage: StatusMessage | null = null;

/**
 * synth-ui leaves the keyboard focus where it was when a sheet opens. The
 * language picker moves it to the current language as it opens, and back to
 * the switch as it closes, so Tab and Enter work on what is shown. Each is
 * done on the first frame that draws its control.
 */
const pickerFocus = { wasOpen: false, toPicker: false, toSwitch: false };

export function paint(ctx: Context, store: Store, env: PageEnv): void {
  const s = store.strings;
  useLocale(ctx, store.state.locale);
  beginFrame(s);
  const { colors: c } = useTheme(ctx);
  const { view, statistics, status, languageOpen } = store.state;
  if (languageOpen !== pickerFocus.wasOpen) {
    pickerFocus.wasOpen = languageOpen;
    pickerFocus.toPicker = languageOpen;
    pickerFocus.toSwitch = !languageOpen;
  }
  ctx.fillRect(ctx.bounds, c.bg);

  topBar(ctx, store, env);
  const lineH = Math.max(lineHeight(ctx, FONT.caps), lineHeight(ctx, FONT.small));
  const footer = ctx.cutBottom(lineH + 4);
  ctx.hline(footer.x, footer.y, footer.w, c.line);
  if (store.state.notice !== shownNotice) {
    shownNotice = store.state.notice;
    shownMessage = shownNotice ? { text: s.notice[shownNotice.id] } : null;
  }
  statusLine(ctx, { text: ctx.hint || s.app.statusLine, message: shownMessage }, { x: footer.x + 4, y: footer.y + 2, w: footer.w - 8, h: lineH + 2 });

  scrollView(ctx, { key: "page", axis: "y", fade: 6, wheelUnit: 24 }, (content) => {
    content.inset(6, 6, 6, 8);
    content.column({ gap: 4 }, (col) => {
      if (view === "statistics") drawStatistics(col, store);
      else drawSubmit(col, store, env);
    });
  });

  const sheetW = Math.min(400, ctx.screen.w - 16);
  const sheetH = (h: number) => Math.min(h, ctx.screen.h - 20);
  const disclaimer = sheet(
    ctx,
    {
      key: "sheet:disclaimer",
      open: view === "statistics" && statistics.disclaimerOpen && !languageOpen,
      title: s.disclaimer.title,
      w: sheetW,
      h: sheetH(150),
    },
    (content) => {
      scrollView(content, { key: "sheet:disclaimer:scroll", axis: "y" }, (inner) => {
        inner.inset(6, 4, 6, 4);
        inner.column({ gap: 6 }, (col) => {
          paragraph(col, s.disclaimer.text);
          if (actionButton(col, { key: "disclaimer:ok", label: s.disclaimer.ok, on: true })) store.dismissDisclaimer();
        });
      });
    },
  );
  if (disclaimer.dismissed) store.dismissDisclaimer();

  const guide = sheet(
    ctx,
    { key: "sheet:guide", open: view === "statistics" && statistics.guideOpen, title: s.guide.title, w: sheetW, h: sheetH(260) },
    (content) => {
      scrollView(content, { key: "sheet:guide:scroll", axis: "y" }, (inner) => {
        inner.inset(6, 4, 6, 4);
        inner.column({ gap: 4 }, (col) => {
          bullets(col, s.guide.points);
          col.place({ w: 0, h: 4 });
          paragraph(col, s.notices, { color: c.muted });
          col.place({ w: 0, h: 2 });
          if (actionButton(col, { key: "guide:close", label: s.app.close })) store.setGuideOpen(false);
        });
      });
    },
  );
  if (guide.dismissed) store.setGuideOpen(false);

  const { withdrawal } = status;
  const withdrawOpen = view === "submit" && (withdrawal.step === "confirming" || withdrawal.step === "uncertain" || withdrawal.step === "sending");
  const confirm = sheet(ctx, { key: "sheet:withdraw", open: withdrawOpen, title: s.withdraw.title, w: sheetW, h: sheetH(140) }, (content) => {
    scrollView(content, { key: "sheet:withdraw:scroll", axis: "y" }, (inner) => {
      inner.inset(6, 4, 6, 4);
      inner.column({ gap: 6 }, (col) => {
        paragraph(col, s.withdraw.note);
        if (withdrawal.step === "uncertain") errorLine(col, s.withdraw.failed(problemText(s, withdrawal.problem)));
        col.row({ gap: 6, h: buttonHeight(col) }, (row) => {
          const sending = withdrawal.step === "sending";
          const label = withdrawal.step === "uncertain" ? s.withdraw.retry : sending ? s.withdraw.confirming : s.withdraw.confirm;
          if (actionButton(row, { key: "withdraw:confirm", label, on: true, disabled: sending })) void store.confirmWithdraw();
          if (actionButton(row, { key: "withdraw:cancel", label: s.withdraw.keep, disabled: sending })) store.cancelWithdraw();
        });
      });
    });
  });
  if (confirm.dismissed && withdrawal.step !== "sending") store.cancelWithdraw();

  // Each language is named in its own script, so it's drawn in its own face.
  const buttonH = Math.max(...LOCALES.map((locale) => lineHeight(ctx, fontRoles(locale).caps))) + 6;
  const picker = sheet(
    ctx,
    { key: "sheet:language", open: languageOpen, title: s.app.language, w: Math.min(200, ctx.screen.w - 16), h: sheetH(LOCALES.length * (buttonH + 4) + 30) },
    (content) => {
      content.inset(6, 4, 6, 4);
      content.column({ gap: 4 }, (col) => {
        for (const locale of LOCALES) {
          const label = messages(locale).language.name;
          const font = fontRoles(locale).caps;
          const current = locale === store.state.locale;
          const takeFocus = current && pickerFocus.toPicker;
          if (takeFocus) pickerFocus.toPicker = false;
          if (actionButton(col, { key: `language:${locale}`, label, font, on: current, w: col.bounds.w, takeFocus })) store.setLocale(locale);
        }
      });
    },
  );
  if (picker.dismissed) store.setLanguageOpen(false);

  tooltip(ctx);
}

const BAR_PAD = 8;

/** The wordmark, the view tabs and the switches; the tabs take a second row when the screen is narrow. */
function topBar(ctx: Context, store: Store, env: PageEnv): void {
  const s = store.strings;
  const { colors: c } = useTheme(ctx);
  const capsH = lineHeight(ctx, FONT.caps);
  const smallH = lineHeight(ctx, FONT.small);
  const barH = capsH + BAR_PAD;
  const title = s.app.title;
  const titleW = ctx.measureText(title, { font: FONT.caps }) + 10;
  const tabLabel = (view: View) => (view === "statistics" ? s.app.statistics : s.app.submit);
  const keyW = (key: string) => ctx.measureText(key, { font: FONT.small }) + 3;
  const tabWidths = TABS.map((tab) => keyW(tab.key) + ctx.measureText(tabLabel(tab.view), { font: FONT.caps }) + 10);
  const switches = [
    { key: "source", text: "GitHub", label: s.app.source, hint: s.app.source, act: () => env.openSource() },
    { key: "language", text: s.language.code, label: s.app.language, hint: s.app.languageHint, act: () => store.setLanguageOpen(true) },
    {
      key: "font",
      text: store.state.smoothText ? s.app.fontSmooth : s.app.fontPixel,
      label: store.state.smoothText ? s.app.fontSmooth : s.app.fontPixel,
      hint: s.app.fontHint,
      act: () => store.toggleSmoothText(),
    },
    { key: "crt", text: store.state.crt ? s.app.crtOn : s.app.crtOff, label: s.a11y.crt(store.state.crt), hint: s.app.crtHint, act: () => store.toggleCrt() },
    { key: "text-view", text: s.app.textView, label: s.app.textView, hint: s.app.textViewHint, act: () => store.setTextView(true) },
  ];
  const switchWidths = switches.map((sw) => ctx.measureText(sw.text, { font: FONT.small }) + 8);
  const needed = titleW + 6 + tabWidths.reduce((total, w) => total + w + 2, 0) + switchWidths.reduce((total, w) => total + w + 4, 0);
  const twoRows = needed > ctx.bounds.w;
  const bar = ctx.cutTop(twoRows ? barH * 2 : barH);
  ctx.fillRect(bar, c.panel);
  ctx.hline(bar.x, bar.y + bar.h - 1, bar.w, c.border);
  ctx.fillRect({ x: bar.x, y: bar.y, w: titleW, h: barH - 1 }, c.accent);
  ctx.text(title, bar.x + 5, bar.y + Math.floor((barH - 1 - capsH) / 2), { color: c.void, font: FONT.caps });

  // Right end, from the edge: the text view (select, copy, search), the CRT switch, the language.
  let right = bar.x + bar.w - 2;
  [...switches].reverse().forEach((sw) => {
    const w = ctx.measureText(sw.text, { font: FONT.small }) + 8;
    const rect = { x: right - w, y: bar.y + 2, w, h: barH - 5 };
    const takeFocus = sw.key === "language" && pickerFocus.toSwitch;
    if (takeFocus) pickerFocus.toSwitch = false;
    const { it, activated } = pressable(ctx, rect, { key: sw.key, label: sw.label, hint: sw.hint, takeFocus });
    if (activated) sw.act();
    ctx.text(sw.text, rect.x + 4, rect.y + Math.floor((rect.h - smallH) / 2), { color: it.hovered ? c.paper : c.muted, font: FONT.small });
    if (it.focused) drawFocusRing(ctx, rect);
    right -= w + 4;
  });

  let x = twoRows ? bar.x + 2 : bar.x + titleW + 6;
  const y = twoRows ? bar.y + barH : bar.y;
  TABS.forEach((tab, index) => {
    const w = tabWidths[index];
    const rect = { x, y: y + 1, w, h: barH - 3 };
    const current = store.state.view === tab.view;
    const label = tabLabel(tab.view);
    const { it, activated } = pressable(ctx, rect, { key: `tab:${tab.view}`, label: s.a11y.view(label, current), hint: `${label} (${tab.key})` });
    if (activated) store.setView(tab.view);
    if (current) ctx.fillRect(rect, c.raised);
    ctx.text(tab.key, rect.x + 5, rect.y + Math.ceil((rect.h - smallH) / 2), { color: c.slate, font: FONT.small });
    const ink = current ? c.paper : it.hovered ? c.text : c.muted;
    ctx.text(label, rect.x + 5 + keyW(tab.key), rect.y + Math.floor((rect.h - capsH) / 2), { color: ink, font: FONT.caps });
    if (current) ctx.hline(rect.x, rect.y + rect.h - 1, rect.w, c.accent);
    if (it.focused) drawFocusRing(ctx, rect);
    x += w + 2;
  });
}
