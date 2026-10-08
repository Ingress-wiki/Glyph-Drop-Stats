import type { Coverage, ItemExclusion, UnplacedReason } from "../../domain/statistics.ts";
import type { Outcome } from "../../domain/versions.ts";
import { ISSUE_MESSAGES, type IssueKey } from "../../domain/issueMessages.ts";

/**
 * Everything the page says, in English: the source every other language
 * follows (`Messages` is this object's type, so a translation that misses a
 * message, or takes different parameters, doesn't compile).
 *
 * Canvas headings and buttons are drawn in a capitals face, so they are
 * written in normal case here; the face upper-cases them. Item names stay
 * as the game prints them, in English, in every language.
 */
export const en = {
  language: { name: "English", code: "EN" },

  app: {
    title: "Glyph Drop Stats",
    statistics: "Statistics",
    submit: "Submit",
    crtOn: "CRT on",
    crtOff: "CRT off",
    crtHint: "Scanlines and glow (F8)",
    textView: "Text view",
    textViewHint: "Show everything as text you can select, copy and search (F9)",
    language: "Language",
    languageHint: "Choose the page's language",
    statusLine: "F1 statistics · F2 submit · F8 CRT · F9 text view",
    canvasLabel: "Glyph Drop Stats. A text version of everything shown here follows the canvas.",
    keyboardHelp:
      "Keyboard: Tab moves between controls and Enter or Space activates the focused one. F1 shows statistics, F2 submitting, F3 the filters, F4 how to read the numbers, F8 switches the CRT effect, F9 shows this text view.",
    fallback:
      "This browser can't draw the interface: it needs WebGPU or WebGL2. Everything it would show is below as text. Use a current browser to submit an export.",
    backToCanvas: "Back to the canvas view (F9)",
    textViewNote: "Text view: select, copy or search anything below.",
    close: "Close",
  },

  /** What a screen reader hears for the focused control. */
  a11y: {
    button: (label: string) => `${label}, button`,
    textField: (label: string) => `${label}, text field`,
    selectable: (label: string) => `${label}, selectable text`,
    checkbox: (label: string, checked: boolean) => `${label}, ${checked ? "checked" : "not checked"}`,
    view: (label: string, current: boolean) => `${label} view${current ? ", current" : ""}`,
    sortBy: (column: string, direction: "ascending" | "descending" | null) =>
      `Sort by ${column}${direction ? `, ${direction}` : ""}`,
    showCategory: (category: string) => `Show ${category} items`,
    searchItems: "Search items",
    receiptField: "Receipt",
    crt: (on: boolean) => `CRT effect ${on ? "on" : "off"}`,
    filterFrom: (label: string) => `${label} from`,
    filterTo: (label: string) => `${label} to`,
  },

  stats: {
    heading: "Statistics",
    loading: "Loading…",
    loadFailed: (problem: string) => `Couldn't load statistics: ${problem}`,
    search: "Search or click a tag",
    searchHint: "Search items by name, or type levelled, mod or other",
    items: (panel: string) => `Items: ${panel}`,
    panelShort: { portal: "portal", bonus: "bonus", both: "both" },
    panelChoice: { portal: "Items: portal panel", bonus: "Items: bonus panel", both: "Items: both panels" },
    kind: { "": "Hacks and drops", hack: "Hacks only", drop: "Drops only" },
    filters: (active: number) => (active > 0 ? `Filters (${active})` : "Filters"),
    filtersHint: "Dates, hours, level and bonus filters (F3)",
    about: "About",
    aboutHint: "How to read these numbers (F4)",
    tsv: "TSV",
    tsvHint: "Download the item table as tab-separated values",
    apply: "Apply",
    clear: "Clear",
    ranges: {
      utc: "UTC dates",
      localDate: "Local dates (needs an offset)",
      localHour: "Local hours (needs an offset)",
      portalLevel: "Portal level",
      hackingBonus: "Hacking bonus % (final only)",
      speedBonus: "Speed bonus % (final only)",
    },
    datePlaceholder: "YYYY-MM-DD",
    headline: {
      records: "Records",
      recordsNote: (unplaced: number) => (unplaced > 0 ? `Each counted once · ${unplaced} unplaced` : "Each counted once"),
      eligible: "Eligible",
      eligibleValue: (eligible: number, total: number) => `${eligible} of ${total}`,
      eligibleNote: (panel: string) => `${panel} read in full`,
      leftOut: "Left out",
      leftOutNote: "Unknown, never zero",
      items: "Items",
      itemsNote: "From eligible observations",
      perObservation: "Per observation",
      perObservationNote: (eligible: number) => `Items / ${eligible} eligible`,
    },
    table: {
      item: "Item",
      quantity: "Qty",
      perObservation: (eligible: number) => `Per obs n=${eligible}`,
      multiplied: "Mult.",
      colourUnread: "Colour ?",
      noEligible: "No eligible observations match these filters.",
      noMatch: "No item matches the search.",
    },
    categories: { levelled: "levelled", mod: "mod", other: "other" },
    breakdowns: { coverage: "Coverage", leftOut: "Left out of item counts", unplaced: "Couldn't be placed" },
    none: "none",
    caption: (hacks: number, drops: number, panel: string, updating: boolean) =>
      `${hacks} hack${hacks === 1 ? "" : "s"} · ${drops} drop group${drops === 1 ? "" : "s"} · items from the ${panel}${updating ? " · updating…" : ""}`,
    mirrorCaption: (panel: string, eligible: number) => `Items from the ${panel}, over ${eligible} eligible observations`,
    mirrorHeadline: { records: "Records", eligible: "Eligible observations", items: "Items", perObservation: "Per observation" },
    mirrorColumns: {
      item: "Item",
      quantity: "Quantity",
      perObservation: "Per observation",
      multiplied: "Multiplied",
      colourUnread: "Colour unread",
    },
    noLevels: "no levels",
    noneMirror: "None.",
    averageNone: "none",
  },

  panels: { portal: "portal panel", bonus: "bonus panel", both: "portal and bonus panels" } as Record<
    "portal" | "bonus" | "both",
    string
  >,

  /** Each follows a count: "2 with no portal level". */
  unplaced: {
    crosses_utc_boundary: "whose interval crosses a boundary of the UTC dates",
    no_local_time: "with no local time (recorded in UTC only)",
    no_local_hour: "with no local hour (whole-day interval)",
    no_portal_level: "with no portal level (includes every drop)",
    portal_level_crosses_filter: "whose portal level range crosses the filter",
    no_hacking_bonus: "with no hacking bonus (includes every drop)",
    hacking_bonus_not_final: "whose hacking bonus isn't final",
    no_speed_bonus: "with no speed bonus (includes every drop)",
    speed_bonus_not_final: "whose speed bonus isn't final",
  } as Record<UnplacedReason, string>,

  coverage: {
    both_panels_in_full: "with portal and bonus panels read in full",
    seen_panels_in_full: "with every panel seen read in full",
    partly_read: "with a panel partly read, or a row unidentified",
    no_panel: "read, but with no panel seen",
    notRead: "not read (timed out or capture lost)",
    unavailable: "with no gear reading",
    unsupported: "saved in an unsupported format",
  } as Record<Coverage, string>,

  exclusions: {
    no_reading: "with no gear reading",
    panel_not_seen: "without the selected panel",
    partly_read: "with the selected panel partly read",
    unidentified_items: "with an unreadable item or level",
    unlisted_item_names: "with an item name awaiting review",
  } as Record<ItemExclusion, string>,

  outcomes: {
    new: "new records",
    duplicate: "already submitted",
    duplicate_other_precision: "already submitted, with a different time precision",
    update_candidate: "more complete than the accepted copy",
    conflict: "different from the accepted copy",
  } as Record<Outcome, string>,
  heldForReview: "Held for review",

  guide: {
    title: "About these numbers",
    points: [
      "Records are hacks and drop groups players submitted. Each counts once, as its accepted version. Withdrawn submissions, conflicting copies and unreviewed updates don't count.",
      "Eligible observations had their gear read, with every selected panel seen, read in full and every item identified. Anything less is left out and counted below the table: a missing panel is unknown, not zero.",
      "Per observation is quantity ÷ eligible observations, including observations without that item.",
      "Shading brightens as a value approaches its column's largest. It means more, not better.",
      "Filters that can't judge a record (a drop has no portal level; an old record has no local time) set it aside and say so, instead of guessing.",
      "Only what the app read is here, and players choose what to submit. Agent level, faction, mods and hack type aren't recorded. There are no confidence intervals: records cluster by player and session.",
    ],
  },

  disclaimer: {
    title: "An important note",
    text: "These are descriptive counts of what players chose to submit, from what the DynamicGlyph app managed to read on their screens. They are not the drop rate of every hack played. Drop groups aren't confirmed hacks, the app can misread, and files can be edited. Brighter cells mean more items in that column; they don't mean better, rarer or certain.",
    ok: "Got it",
  },

  notices:
    "Code under the MIT licence. Drawn with synth-ui (MIT, © Cyandev). Text uses the X.org misc-fixed 5×7 font (public domain) and Fusion Pixel Font (SIL OFL 1.1). Licence texts: /licenses/. Not affiliated with Niantic or Ingress; item names are theirs.",

  submit: {
    heading: "Submit",
    lede: "Check a DynamicGlyph gear export (DynamicGlyph-gear-v1-….csv), then submit it if you want to. Checking stores nothing.",
    checkHeading: "Check a file",
    chooseFile: "Choose file",
    chooseFileHint: "Pick a DynamicGlyph export, or drop it on the page",
    checkFile: "Check file",
    checking: "Checking…",
    noFile: "No file chosen. You can also drop one on the page.",
    fileName: (name: string) => `File: ${name}`,
    noFileMirror: "No file chosen.",
    checkFailed: (problem: string) => `Couldn't check the file: ${problem}`,
    cantUse: "This file can't be used",
    summary: "Summary",
    rows: "Rows",
    validRecords: "Valid records",
    validValue: (valid: number, hacks: number, drops: number) => `${valid} (${hacks} hacks, ${drops} drop groups)`,
    gearRead: "Gear read",
    gearReadValue: (read: number, partly: number, notRead: number, unavailable: number) =>
      `${read} read (${partly} partly), ${notRead} not read, ${unavailable} unavailable`,
    unusable: "Unusable records",
    exportedBy: "Exported by",
    exportedByValue: (version: string, build: string, format: number) => `DynamicGlyph ${version} (${build}), format v${format}`,
    compared: "Compared with accepted data",
    unusableHeading: "Unusable records",
    rejectedRecord: (id: string | null, lines: string) => `${id ?? "unknown record"} · line ${lines}`,
    more: (n: number) => `…and ${n} more.`,
    previewMirror: (rows: number, valid: number, rejected: number) => `${rows} rows; ${valid} valid records; ${rejected} unusable.`,
    notes: [
      "Only the checked fields of the valid records are stored, never the file itself. Unusable records aren't stored.",
      "You get a private receipt. It is the only way to see or withdraw this submission, and it can't be recovered if lost.",
      "Withdrawing removes this submission's support. A record another active submission also supplied stays in the statistics.",
      "A record already accepted from an earlier submission isn't replaced. A different or more complete copy is kept for review.",
    ],
    closed:
      "Submitting isn't open yet. It opens once the data terms and the retention rules are published. You can still check a file: checking stores nothing.",
    createReceipt: "Create my receipt",
    receiptHeading: "Your receipt. Keep it private.",
    yourReceipt: "Your receipt",
    receiptMirror: (secret: string) => `Your receipt: ${secret}`,
    download: "Download",
    downloadHint: "Save the receipt as a text file",
    copy: "Copy",
    copyHint: "Copy the receipt exactly, case and all",
    saved: "I've saved my receipt",
    savedMirror: (saved: boolean): string => (saved ? "Receipt marked as saved." : "Save your receipt, then confirm."),
    send: (n: number) => `Submit ${n} records`,
    sending: "Submitting…",
    sendFailed: (problem: string) => `Couldn't confirm the submission (${problem}). It may have gone through.`,
    retry: "Try again with the same receipt",
    refused: (message: string) => `Not submitted: ${message}`,
    submitted: "Submitted",
    submittedText: "Thank you.",
    replayedText: "This upload had already been confirmed; nothing was counted twice.",
    alreadyWithdrawn: "Already withdrawn",
    alreadyWithdrawnText: "This submission was already withdrawn. Retrying has not reactivated it.",
  },

  status: {
    heading: "Check or withdraw a submission",
    placeholder: "Paste your receipt",
    hint: "Your receipt, as gds1_…",
    check: "Check",
    checking: "Checking…",
    active: "Active",
    withdrawnAt: (when: string) => `Withdrawn ${when}`,
    line: (state: string, submitted: string, rows: number, rejected: number) =>
      `${state}, submitted ${submitted}. ${rows} rows; ${rejected} unusable records weren't stored.`,
    mirrorLine: (active: boolean, rows: number, rejected: number) =>
      `${active ? "Active" : "Withdrawn"}; ${rows} rows; ${rejected} unusable records weren't stored.`,
    failed: (problem: string) => `Couldn't check: ${problem}`,
    withdraw: "Withdraw this submission",
    withdrawing: "Withdrawing…",
    notWithdrawn: (message: string) => `Not withdrawn: ${message}`,
  },

  withdraw: {
    title: "Withdraw this submission?",
    note: "Withdrawal stops this submission contributing to statistics. It does not currently delete its stored data. It can't be undone. A record that another active submission also supplied keeps counting, and no other version of a record takes its place.",
    confirm: "Withdraw",
    confirming: "Withdrawing…",
    retry: "Try again",
    keep: "Keep it",
    failed: (problem: string) => `Couldn't confirm the withdrawal (${problem}). It may have gone through.`,
  },

  /** Why an answer couldn't be used: shown inside the messages above. */
  problems: {
    network: (detail: string) => `the connection failed: ${detail}`,
    unreadable: (status: number) => `the answer couldn't be read, ${status}`,
    unclear: (status: number) => `the server didn't answer clearly, ${status}`,
  },

  notice: {
    receiptCopied: "Receipt copied",
    copyFailed: "Couldn't copy: download the receipt instead",
  },

  announce: {
    checked: (valid: number, rejected: number) => `Checked: ${valid} valid records, ${rejected} unusable.`,
    cantUse: "This file can't be used.",
    checkFailed: "Couldn't check the file.",
    receiptCreated: (secret: string) => `Receipt created: ${secret}`,
    retry: "Couldn't confirm the submission; try again with the same receipt.",
    found: (active: boolean): string => (active ? "Submission found: active." : "Submission found: withdrawn."),
    notFound: "No submission found.",
    statistics: (records: number, eligible: number) => `Statistics: ${records} records, ${eligible} eligible.`,
  },

  receiptFile: {
    title: "Glyph Drop Stats submission receipt",
    warning: [
      "Keep this private. Anyone with it can view or withdraw your submission,",
      "and it can't be recovered if you lose it.",
    ],
    receipt: "Receipt",
    site: "Site",
    created: "Created",
  },

  /** Words a server message's parameters name: panel stages, filter fields. */
  terms: {
    panel: { portal: "portal", bonus: "bonus" } as Record<string, string>,
    filter: {} as Record<string, string>,
  },
  issueLine: (message: string, line: number) => `${message} (line ${line})`,

  /** Server messages by key, with the server's `{name}` placeholders. */
  issues: ISSUE_MESSAGES as Record<IssueKey, string>,
};

export type Messages = typeof en;
