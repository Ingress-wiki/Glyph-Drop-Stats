import type { Coverage, ItemExclusion, UnplacedReason } from "../../domain/statistics.ts";
import type { Outcome } from "../../domain/versions.ts";
import { ISSUE_MESSAGES, type IssueKey } from "../../domain/issueMessages.ts";

/**
 * Everything the page says, in English: the source every other language
 * follows (`Messages` is this object's type, so a translation that misses a
 * message, or takes different parameters, doesn't compile).
 *
 * Headings and buttons are upper-cased by the stylesheet, so they are
 * written in normal case here. Item names stay as the game prints them, in
 * English, in every language.
 */
export const en = {
  language: { name: "English" },

  app: {
    title: "Glyph Drop Stats",
    statistics: "Statistics",
    submit: "Submit",
    source: "Source code on GitHub",
    language: "Language",
    testPeriod:
      "Test period: submissions are open for testing only. Everything submitted now, and the statistics built from it, will be deleted before the site opens to the public, and may be wiped sooner.",
    keyboardHelp: "Shortcuts: F1 statistics · F2 submit · F3 filters · F4 how to read the numbers",
    close: "Close",
    views: "Views",
  },

  /** What a screen reader hears for the focused control. */
  a11y: {
    showCategory: (category: string) => `Show ${category} items`,
    searchItems: "Search items",
    receiptField: "Receipt",
    filterFrom: (label: string) => `${label} from`,
    filterTo: (label: string) => `${label} to`,
  },

  stats: {
    loading: "Loading…",
    loadFailed: (problem: string) => `Couldn't load statistics: ${problem}`,
    search: "Search or click a tag",
    searchHint: "Search items by name, or type levelled, mod or other",
    items: (panel: string) => `Items: ${panel}`,
    panelShort: { portal: "portal", bonus: "bonus", both: "both" },
    panelChoice: { portal: "Items: portal panel", bonus: "Items: bonus panel", both: "Items: both panels" },
    kind: { "": "Hacks and drops", hack: "Hacks only", drop: "Drops only" },
    multipliedChoice: { include: "Multiplied: counted", exclude: "Multiplied: left out" },
    alignmentChoice: {
      "": "All portals",
      same_faction: "Own-faction portals",
      enemy: "Enemy portals",
      machina: "Machina portals",
    },
    filters: (active: number) => (active > 0 ? `Filters (${active})` : "Filters"),
    filtersHint: "Dates, hours, level and bonus filters (F3)",
    about: "About",
    aboutHint: "How to read these numbers (F4)",
    tsv: "TSV",
    tsvHint: "Download the item table as tab-separated values",
    copyLink: "Copy link",
    copyLinkHint: "Copy a link that opens this view: filters, comparison, search and sorting",
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
      recordsNote: (uploads: number | null, unplaced: number): string =>
        [uploads === null ? "Each counted once" : `From ${uploads} upload${uploads === 1 ? "" : "s"}`, unplaced > 0 ? `${unplaced} unplaced` : ""]
          .filter(Boolean)
          .join(" · "),
      eligible: "Eligible",
      eligibleValue: (eligible: number, total: number) => `${eligible} of ${total}`,
      eligibleNote: (panel: string) => `${panel} read in full`,
      perObservation: "Per observation",
      perObservationNote: (eligible: number) => `Items / ${eligible} eligible`,
      rare: "Rare or better",
      rareNote: (known: number) => `Has a Rare or Very Rare item · of ${known}`,
      key: "Portal Key",
      keyNote: (known: number) => `Has a key · of ${known}`,
      few: "few observations",
    },
    compare: {
      heading: "Compare",
      splitChoice: {
        alignment: "By portal alignment",
        portalLevel: "By portal level",
        glyphCount: "By Glyph count",
        speedCommand: "By speed command",
        keyCommand: "By key command",
        panelEffect: "By panel effect",
        event: "By Ingress event",
        week: "By UTC week",
        day: "By UTC day",
      },
      columns: {
        records: "Records",
        eligible: "Eligible",
        perObservation: "Per obs",
        rare: "Rare+",
        key: "Key",
      },
      alignments: {
        same_faction: "Own faction",
        enemy: "Enemy",
        machina: "Machina",
      },
      portalLevel: (level: string) => `P${level}`,
      glyphCount: (count: number) => `${count} Glyph${count === 1 ? "" : "s"}`,
      speedCommands: { simple: "Simple", complex: "Complex" },
      keyCommands: {
        requestKey: "Request key",
        noKey: "No key",
        keysOnly: "Keys only",
      },
      panelEffects: { none: "No effect shown", "ITO EN (+)": "ITO EN (+)", "ITO EN (-)": "ITO EN (−)" },
      outsideEvents: "Outside events",
      week: (date: string) => `Week of ${date}`,
      unknown: "Unknown",
      few: (min: number) => `Dimmed rows rest on fewer than ${min} eligible observations.`,
      notes: {
        alignment:
          "Only Glyph hacks from DynamicGlyph builds after 1.0.0 have an alignment. It comes from the portal screen read just before the hack, not a verified portal, and neutral portals aren't recognized yet.",
        portalLevel: "Only exact portal levels the app was sure of. Ranges, conflicts and low confidence are Unknown.",
        glyphCount: "Drops have no Glyph count.",
        speedCommand: "A command counts only when the app saw it confirmed.",
        keyCommand: "A command counts only when the app saw it confirmed.",
        panelEffect: "ITO EN (+) and (−) as the app read them on the panel. “No effect shown” also holds readings from builds that didn't record effects.",
        event: "Each event's UTC window, as listed in the site's code with its source. A record whose time crosses an event's start or end is Unknown.",
        week: "Weeks run Monday to Monday, UTC. A record whose time crosses into the next week (a local day can) is Unknown. Shaded: known Ingress events.",
        day: "Days are UTC. A record whose time crosses into the next day, as a local day outside UTC does, is Unknown. Shaded: known Ingress events.",
      },
      empty: "Nothing to compare yet.",
    },
    levels: {
      heading: "Item level by portal level",
      all: "All",
      note: "Each row splits one portal level's levelled items (Resonators, XMP Bursters, Ultra Strikes, Power Cubes) by item level, in percent. Only exact portal levels the app was sure of.",
      row: (level: number, observations: number) => `P${level} n=${observations}`,
      cell: (level: string, items: number, total: number, percent: string) => `${level}: ${items} of ${total} levelled items (${percent}%)`,
      empty: "No eligible observation has a trusted portal level yet.",
      mirrorCaption: (group: string) => `Share of levelled items by item level, for each portal level: ${group}`,
    },
    gives: {
      heading: "What an observation gives",
      note: (eligible: number) => `Average items per eligible observation, n=${eligible}`,
      groups: { shields: "Shields", mods: "Other mods", other: "Other items" },
    },
    distribution: {
      heading: "How many per observation",
      item: "Item",
      observations: "Observations",
      poisson: "Poisson, same mean",
      mean: "Mean",
      variance: "Variance",
      dispersion: "Variance ÷ mean",
      legend: "Bars: eligible observations with that many. Dots: what a Poisson count with the same mean would give.",
      note: "Near 1, variance ÷ mean is what a Poisson count gives; above 1, counts bunch up (more with none and more with many), below 1, they are more even. This describes the sample and is not a test: records cluster by player and session.",
      bin: (observations: number, percent: string) => `${observations} observations (${percent}%)`,
      expected: (count: string) => `Poisson: ${count}`,
      empty: "No eligible observation has an item yet.",
    },
    sample: {
      heading: "About this sample",
      hint: "Coverage, records left out and the app builds behind these numbers",
      apps: "App builds",
      app: (version: string, build: string) => `DynamicGlyph ${version} (${build})`,
      appUnknown: "unknown",
      gaps: "Builds before 0.1.0 beta 4 recorded level-1 portal hacks as drops, missed Enlightened and Machina portal screens, and often missed the 38% hacking bonus. Every build through 1.0.0 (2) can misread an L1 portal as L7; levels it flags as conflicting or low-confidence are left out.",
    },
    table: {
      item: "Item",
      quantity: "Qty",
      perObservation: (eligible: number) => `Per obs n=${eligible}`,
      chance: "Chance",
      whenPresent: "If any",
      multiplied: "Mult.",
      colourUnread: "Colour ?",
      rarity: { common: "Common", rare: "Rare", veryRare: "V. rare", unread: "Rarity ?" },
      rarityHint: { common: "Quantity that was Common", rare: "Quantity that was Rare", veryRare: "Quantity that was Very Rare", unread: "Quantity whose rarity wasn't read" },
      noEligible: "No eligible observations match these filters.",
      noMatch: "No item matches the search.",
    },
    categories: { levelled: "levelled", mod: "mod", other: "other" },
    breakdowns: { coverage: "Coverage", leftOut: "Left out of item counts", unplaced: "Couldn't be placed" },
    none: "none",
    caption: (hacks: number, drops: number, panel: string, updating: boolean) =>
      `${hacks} hack${hacks === 1 ? "" : "s"} · ${drops} drop group${drops === 1 ? "" : "s"} · items from the ${panel}${updating ? " · updating…" : ""}`,
    mirrorCaption: (panel: string, eligible: number) => `Items from the ${panel}, over ${eligible} eligible observations`,
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
    portal_level_unreliable: "whose portal level conflicts or has low confidence",
    portal_level_crosses_filter: "whose portal level range crosses the filter",
    no_hacking_bonus: "with no hacking bonus (includes every drop)",
    hacking_bonus_not_final: "whose hacking bonus isn't final",
    no_speed_bonus: "with no speed bonus (includes every drop)",
    speed_bonus_not_final: "whose speed bonus isn't final",
    no_alignment: "with no portal alignment (includes every drop)",
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
    multiplied: "with a multiplied item (red quantity)",
    multiplied_unread: "with an item whose colour wasn't read",
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
      "A red quantity was multiplied (by a Fracker, the day's first hack, a beacon…); the app records neither the factor nor the cause, so it is counted as shown. Choose “Multiplied: left out” to keep only observations whose counted items were all read in normal colour. Mods and other items without a level are split by rarity instead.",
      "Per observation is quantity ÷ eligible observations, including observations without that item.",
      "Shading brightens as a value approaches its column's largest. It means more, not better.",
      "Filters that can't judge a record (a drop has no portal level; an old record has no local time) set it aside and say so, instead of guessing.",
      "Only what the app read is here, and players choose what to submit. Agent level, mods and hack type aren't recorded, and no one's faction is stored: only a portal's alignment, from newer builds. There are no confidence intervals: records cluster by player and session, so figures from fewer than 30 observations are dimmed.",
    ],
  },

  disclaimer: {
    title: "An important note",
    text: "These are descriptive counts of what players chose to submit, from what the DynamicGlyph app managed to read on their screens. They are not the drop rate of every hack played. Drop groups aren't confirmed hacks, the app can misread, and files can be edited. Brighter cells mean more items in that column; they don't mean better, rarer or certain.",
    ok: "Got it",
  },

  notices:
    "Code under the MIT licence. Fonts: Departure Mono, IBM Plex Mono and Inter (SIL OFL 1.1). Licence texts: /licenses/. Not affiliated with Niantic or Ingress; item names are theirs.",

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
    download: "Download",
    downloadHint: "Save the receipt as a text file",
    copy: "Copy",
    copyHint: "Copy the receipt exactly, case and all",
    saved: "I've saved my receipt",
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
    linkCopied: "Link copied",
    linkCopyFailed: "Couldn't copy: use the address bar instead",
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
