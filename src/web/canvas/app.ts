import type { Context } from "@synth-ui/core";
import { scrollView, sheet, statusLine, tooltip, useTheme } from "@synth-ui/widgets";
import type { Store, View } from "../app/store.ts";
import { drawStatistics } from "./statisticsView.ts";
import { DISCLAIMER, GUIDE, NOTICES, WITHDRAW_NOTE } from "../copy.ts";
import { drawSubmit, type SubmitEnv } from "./submitView.ts";
import { COLORS, FONT } from "./theme.ts";
import { actionButton, beginFrame, BUTTON_H, bullets, drawFocusRing, errorLine, paragraph, pressable } from "./ui.ts";

const TABS: readonly { view: View; label: string; key: string }[] = [
  { view: "statistics", label: "STATISTICS", key: "F1" },
  { view: "submit", label: "SUBMIT", key: "F2" },
];

export function paint(ctx: Context, store: Store, env: SubmitEnv): void {
  const { colors: c } = useTheme(ctx);
  beginFrame();
  const { view, statistics, status } = store.state;
  ctx.fillRect(ctx.bounds, c.bg);

  topBar(ctx, store);
  const footer = ctx.cutBottom(11);
  ctx.hline(footer.x, footer.y, footer.w, c.line);
  const notice = store.state.notice;
  statusLine(ctx, { text: ctx.hint || "F1 STATISTICS · F2 SUBMIT · F8 CRT · F9 TEXT VIEW", message: notice }, { x: footer.x + 4, y: footer.y + 2, w: footer.w - 8, h: 9 });

  scrollView(ctx, { key: "page", axis: "y", fade: 6, wheelUnit: 24 }, (content) => {
    content.inset(6, 6, 6, 8);
    content.column({ gap: 4 }, (col) => {
      if (view === "statistics") drawStatistics(col, store);
      else drawSubmit(col, store, env);
    });
  });

  const screenW = ctx.screen.w;
  const sheetW = Math.min(400, screenW - 16);
  const disclaimer = sheet(
    ctx,
    { key: "sheet:disclaimer", open: view === "statistics" && statistics.disclaimerOpen, title: "AN IMPORTANT NOTE", w: sheetW, h: 120 },
    (content) => {
      content.inset(6, 4, 6, 4);
      content.column({ gap: 6 }, (col) => {
        paragraph(col, DISCLAIMER);
        if (actionButton(col, { key: "disclaimer:ok", label: "GOT IT", on: true })) store.dismissDisclaimer();
      });
    },
  );
  if (disclaimer.dismissed) store.dismissDisclaimer();

  const guide = sheet(
    ctx,
    { key: "sheet:guide", open: view === "statistics" && statistics.guideOpen, title: "ABOUT THESE NUMBERS", w: sheetW, h: Math.min(250, ctx.screen.h - 20) },
    (content) => {
      scrollView(content, { key: "sheet:guide:scroll", axis: "y" }, (inner) => {
        inner.inset(6, 4, 6, 4);
        inner.column({ gap: 4 }, (col) => {
          bullets(col, GUIDE);
          col.place({ w: 0, h: 4 });
          paragraph(col, NOTICES, { color: COLORS.muted });
          col.place({ w: 0, h: 2 });
          if (actionButton(col, { key: "guide:close", label: "CLOSE" })) store.setGuideOpen(false);
        });
      });
    },
  );
  if (guide.dismissed) store.setGuideOpen(false);

  const { withdrawal } = status;
  const withdrawOpen = view === "submit" && (withdrawal.step === "confirming" || withdrawal.step === "uncertain" || withdrawal.step === "sending");
  const confirm = sheet(ctx, { key: "sheet:withdraw", open: withdrawOpen, title: "WITHDRAW THIS SUBMISSION?", w: sheetW, h: 112 }, (content) => {
    content.inset(6, 4, 6, 4);
    content.column({ gap: 6 }, (col) => {
      paragraph(col, WITHDRAW_NOTE);
      if (withdrawal.step === "uncertain") errorLine(col, `Couldn't confirm the withdrawal (${withdrawal.message}). It may have gone through.`);
      col.row({ gap: 6, h: BUTTON_H }, (row) => {
        const sending = withdrawal.step === "sending";
        const label = withdrawal.step === "uncertain" ? "TRY AGAIN" : sending ? "WITHDRAWING..." : "WITHDRAW";
        if (actionButton(row, { key: "withdraw:confirm", label, on: true, disabled: sending })) void store.confirmWithdraw();
        if (actionButton(row, { key: "withdraw:cancel", label: "KEEP IT", disabled: sending })) store.cancelWithdraw();
      });
    });
  });
  if (confirm.dismissed && withdrawal.step !== "sending") store.cancelWithdraw();

  tooltip(ctx);
}

const BAR_H = 15;

/** The wordmark, the view tabs and the CRT switch; the tabs take a second row when the screen is narrow. */
function topBar(ctx: Context, store: Store): void {
  const { colors: c } = useTheme(ctx);
  const title = "GLYPH DROP STATS";
  const titleW = ctx.measureText(title, { font: FONT.caps }) + 10;
  const tabWidths = TABS.map((tab) => ctx.measureText(`${tab.key} ${tab.label}`, { font: FONT.caps }) + 10);
  const crt = store.state.crt ? "CRT ON" : "CRT OFF";
  const switchesW = ctx.measureText(crt, { font: FONT.small }) + ctx.measureText("TEXT VIEW", { font: FONT.small }) + 24;
  const needed = titleW + 6 + tabWidths.reduce((total, w) => total + w + 2, 0) + switchesW;
  const twoRows = needed > ctx.bounds.w;
  const bar = ctx.cutTop(twoRows ? BAR_H * 2 : BAR_H);
  ctx.fillRect(bar, c.panel);
  ctx.hline(bar.x, bar.y + bar.h - 1, bar.w, c.border);
  ctx.fillRect({ x: bar.x, y: bar.y, w: titleW, h: BAR_H - 1 }, c.accent);
  ctx.text(title, bar.x + 5, bar.y + 4, { color: c.void, font: FONT.caps });

  // Right end: the text view (select, copy, search) and the CRT switch.
  let right = bar.x + bar.w - 2;
  const switches = [
    { key: "crt", text: crt, label: `CRT effect ${store.state.crt ? "on" : "off"}`, hint: "Scanlines and glow (F8)", act: () => store.toggleCrt() },
    { key: "text-view", text: "TEXT VIEW", label: "Text view", hint: "Show everything as text you can select, copy and search (F9)", act: () => store.setTextView(true) },
  ];
  for (const sw of switches) {
    const w = ctx.measureText(sw.text, { font: FONT.small }) + 8;
    const rect = { x: right - w, y: bar.y + 2, w, h: BAR_H - 5 };
    const { it, activated } = pressable(ctx, rect, { key: sw.key, label: sw.label, hint: sw.hint });
    if (activated) sw.act();
    ctx.text(sw.text, rect.x + 4, rect.y + 3, { color: it.hovered ? c.paper : c.muted, font: FONT.small });
    if (it.focused) drawFocusRing(ctx, rect);
    right -= w + 4;
  }

  let x = twoRows ? bar.x + 2 : bar.x + titleW + 6;
  const y = twoRows ? bar.y + BAR_H : bar.y;
  TABS.forEach((tab, index) => {
    const w = tabWidths[index];
    const rect = { x, y: y + 1, w, h: BAR_H - 3 };
    const current = store.state.view === tab.view;
    const { it, activated } = pressable(ctx, rect, {
      key: `tab:${tab.view}`,
      label: `${tab.label.toLowerCase()} view${current ? ", current" : ""}`,
      hint: `${tab.label} (${tab.key})`,
    });
    if (activated) store.setView(tab.view);
    if (current) ctx.fillRect(rect, c.raised);
    ctx.text(tab.key, rect.x + 5, rect.y + 5, { color: c.slate, font: FONT.small });
    const keyW = ctx.measureText(tab.key, { font: FONT.small }) + 3;
    ctx.text(tab.label, rect.x + 5 + keyW, rect.y + 3, { color: current ? c.paper : it.hovered ? c.text : c.muted, font: FONT.caps });
    if (current) ctx.hline(rect.x, rect.y + rect.h - 1, rect.w, c.accent);
    if (it.focused) drawFocusRing(ctx, rect);
    x += w + 2;
  });
}
