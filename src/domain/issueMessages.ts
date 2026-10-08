/**
 * Every message the server can send about a file, a record, a filter or a
 * request: a stable key, and the English text with `{name}` placeholders.
 * Responses carry the key and its parameters, so a page can say the same
 * thing in another language; `message` keeps the English for other clients.
 */
export const ISSUE_MESSAGES = {
  "csv.unterminatedQuote": "A quoted field is never closed.",
  "csv.unexpectedQuote": "A quote appears inside an unquoted field.",
  "csv.textAfterQuote": "Text follows a closing quote.",

  "file.tooLarge": "The file is larger than {limit} bytes.",
  "file.tooManyRows": "The file has more than {limit} data rows.",
  "file.tooManyFields": "A row has more than {limit} fields.",
  "file.fieldTooLong": "A field is longer than {limit} characters.",
  "file.tooManyRecords": "The file has more than {limit} records.",
  "file.invalidEncoding": "The file is not valid UTF-8.",
  "file.empty": "The file is empty.",
  "file.notGearExport": "This is not a DynamicGlyph gear export.",
  "file.unexpectedColumn": 'Column {index} should be "{expected}". This export\'s format isn\'t supported.',
  "file.badHeader": "The header has blank or repeated column names.",
  "file.noRecords": "The file has a header but no records.",
  "file.unsupportedVersion": "Only format version {version} is supported.",
  "file.mixedExporters": "Rows were written by different app builds; upload each export separately.",

  "warning.ignoredColumns": "{count} column(s) this site doesn't know were ignored and not stored: {columns}.",
  "warning.unlistedItems":
    "Item names not on this site's list yet, with the app build that captured them: {items}. They are kept as unverified text, never shown publicly, and their records are left out of item statistics until the names are reviewed.",

  "row.width": "The row has {fields} fields; the header has {expected}.",

  "cell.notInteger": "{column} is not an integer.",
  "cell.outOfRange": "{column} is outside {min}–{max}.",
  "cell.notBoolean": '{column} is not "true" or "false".',
  "cell.notAllowed": "{column} is not an allowed value.",
  "cell.notTimestamp": "{column} is not a YYYY-MM-DDTHH:MM:SSZ timestamp.",
  "cell.notRealTime": "{column} is not a real time.",
  "cell.notDate": "{column} is not a YYYY-MM-DD date.",
  "cell.notRealDate": "{column} is not a real date.",
  "cell.notRecordId": "{column} is not h or d followed by 32 lowercase hex digits.",
  "cell.notItemName": "{column} is not an item name.",
  "cell.unknownEffect": "{column} lists an unknown panel effect.",
  "cell.notVersion": "{column} is not a version or build string.",

  "record.columnDiffers": "{column} differs between rows of one record.",
  "record.blank": "{column} is blank.",
  "record.blankOnItemRow": "{column} is blank on an item row.",
  "record.mustBeBlankForDrop": "{column} must be blank for a drop.",
  "record.mustBeBlankWhenRead": "{column} must be blank when gear was read.",
  "record.mustBeBlankForStatus": "{column} must be blank when read_status is {status}.",
  "record.mustBeBlankWithoutReading": "{column} must be blank without a reading.",
  "record.mustBeBlankWithoutCommandMode": "{column} must be blank without command_mode.",
  "record.idKind": "record_id's first letter doesn't match kind.",
  "record.basisKind": "time_basis doesn't match kind.",
  "record.dropAlwaysRead": "A drop is always read.",
  "record.oneRowWithoutReading": "A record without a reading must have exactly one row.",

  "time.notHourOrDay": "The time interval is neither one hour nor one day.",
  "time.implausible": "The time interval is outside the plausible range.",
  "time.localWithoutOffset": "local_date and local_hour must be blank without utc_offset_minutes.",
  "time.notUtcHour": "Without an offset the interval must be a UTC hour.",
  "time.notUtcDay": "Without an offset the interval must be a UTC day.",
  "time.notLocalHour": "The interval isn't an hour in its own UTC offset.",
  "time.notLocalDay": "The interval isn't a day in its own UTC offset.",
  "time.localDateMismatch": "local_date doesn't match the interval and offset.",
  "time.localHourMismatch": "local_hour doesn't match the interval and offset.",
  "time.localHourOnDay": "local_hour must be blank for a day interval.",

  "hack.bonusPair": "{name} and {name}_final must both be set or both blank.",
  "hack.commandStatuses": "Command statuses are required with command_mode.",
  "hack.commandNotConfirmed": "{column} is set but not confirmed.",
  "hack.levelColumns": "Portal level columns must all be set or all blank.",
  "hack.levelOrder": "portal_level_low is above portal_level_high.",

  "panel.withoutPanel": "A row without a panel must be the record's only row, with item columns blank.",
  "panel.order": "The portal panel's rows must come before the bonus panel's.",
  "panel.observedMismatch": "observed_panels_read_in_full doesn't match the panels and items.",
  "panel.bothMismatch": "both_panels_read doesn't match the panels.",
  "panel.columnsDiffer": "The {panel} panel's columns differ between its rows.",
  "panel.mixedPlaceholder": "The {panel} panel mixes an empty-panel row with other rows.",
  "panel.slotTwice": "The {panel} panel has slot {slot} twice.",

  "item.levelState": "level must be set exactly when level_state is known.",
  "item.rarityPair": "rarity and rarity_source must both be set or both blank.",

  "api.invalidReceipt": "Send the receipt as `Authorization: Receipt <receipt>`.",
  "api.noValidRecords": "The file has no valid records to submit.",
  "api.receiptInUse": "This receipt was already used for a different file. Make a new one.",
  "api.notFound": "No submission has this receipt.",
  "api.noEndpoint": "No such endpoint.",
  "api.methodNotAllowed": "Use {methods}.",
  "api.submissionsClosed": "Submitting isn't open yet. Checking a file still works and stores nothing.",

  "filter.unknown": "{name} is not a known filter.",
  "filter.repeated": "{name} is given more than once.",
  "filter.pair": "{first} and {second} must be given together.",
  "filter.timestamp": "{name} must be a YYYY-MM-DDTHH:MM:SSZ time.",
  "filter.date": "{name} must be a YYYY-MM-DD date.",
  "filter.hour": "{name} must be an hour from 0 to 23.",
  "filter.integer": "{name} must be an integer from {min} to {max}.",
  "filter.utcOrder": "utcFrom must be before utcTo.",
  "filter.localDateOrder": "localDateFrom must not be after localDateTo.",
  "filter.localHourOrder": "localHourFrom must not be after localHourTo.",
  "filter.rangeOrder": "{first} must not be above {second}.",
  "filter.kind": "kind must be hack or drop.",
  "filter.panels": "panels must be portal, bonus or both.",
} as const;

export type IssueKey = keyof typeof ISSUE_MESSAGES;
export type IssueParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/** The placeholder names a template uses, sorted and without repeats. */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1]))].sort();
}

/** Fills `{name}` placeholders; a missing parameter is left visible rather than dropped. */
export function formatTemplate(template: string, params: IssueParams = {}): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export function issueMessage(key: IssueKey, params?: IssueParams): string {
  return formatTemplate(ISSUE_MESSAGES[key], params);
}
