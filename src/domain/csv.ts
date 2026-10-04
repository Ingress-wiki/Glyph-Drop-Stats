/**
 * A strict RFC 4180 reader. The exporter writes CRLF; LF alone is accepted
 * too because some tools rewrite line endings when a file is copied. Blank
 * lines are skipped: no v1 row can be a single empty field.
 */

export type CsvError =
  | { code: "unterminated_quote"; line: number }
  | { code: "unexpected_quote"; line: number }
  | { code: "text_after_quote"; line: number }
  | { code: "too_many_rows"; limit: number }
  | { code: "too_many_fields"; line: number; limit: number }
  | { code: "field_too_long"; line: number; limit: number };

export interface CsvRow {
  fields: string[];
  /** The physical line the row starts on, 1-based. */
  line: number;
}

export interface CsvResult {
  rows: CsvRow[];
  error: CsvError | null;
}

export interface CsvLimits {
  /** Rows, header included. */
  maxRows: number;
  maxFieldsPerRow: number;
  /** In UTF-16 code units. */
  maxFieldLength: number;
}

const QUOTE = 34;
const COMMA = 44;
const CR = 13;
const LF = 10;

/**
 * Splits `text` into rows. Stops at the first syntax error or exceeded limit,
 * so an oversized or hostile file costs bounded memory and work.
 */
export function parseCsv(text: string, limits: CsvLimits): CsvResult {
  const rows: CsvRow[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;

  while (i < n) {
    const rowLine = line;
    const fields: string[] = [];
    let lastQuoted = false;
    for (;;) {
      if (fields.length >= limits.maxFieldsPerRow) {
        return { rows, error: { code: "too_many_fields", line: rowLine, limit: limits.maxFieldsPerRow } };
      }
      let field: string;
      lastQuoted = text.charCodeAt(i) === QUOTE;
      if (lastQuoted) {
        const quoteLine = line;
        let start = ++i;
        field = "";
        for (;;) {
          const close = text.indexOf('"', start);
          if (close === -1) return { rows, error: { code: "unterminated_quote", line: quoteLine } };
          for (let k = text.indexOf("\n", start); k !== -1 && k < close; k = text.indexOf("\n", k + 1)) line++;
          field += text.slice(start, close);
          if (field.length > limits.maxFieldLength) {
            return { rows, error: { code: "field_too_long", line: quoteLine, limit: limits.maxFieldLength } };
          }
          if (text.charCodeAt(close + 1) === QUOTE) {
            field += '"';
            start = close + 2;
            continue;
          }
          i = close + 1;
          break;
        }
        const next = text.charCodeAt(i);
        if (i < n && next !== COMMA && next !== CR && next !== LF) {
          return { rows, error: { code: "text_after_quote", line } };
        }
      } else {
        const start = i;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === COMMA || c === CR || c === LF) break;
          if (c === QUOTE) return { rows, error: { code: "unexpected_quote", line } };
          i++;
        }
        if (i - start > limits.maxFieldLength) {
          return { rows, error: { code: "field_too_long", line, limit: limits.maxFieldLength } };
        }
        field = text.slice(start, i);
      }
      fields.push(field);
      if (i < n && text.charCodeAt(i) === COMMA) {
        i++;
        continue;
      }
      break;
    }
    // At a line break or the end of the text.
    if (i < n) {
      i += text.charCodeAt(i) === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
      line++;
    }
    const blank = fields.length === 1 && fields[0] === "" && !lastQuoted;
    if (!blank) {
      rows.push({ fields, line: rowLine });
      if (rows.length > limits.maxRows) return { rows, error: { code: "too_many_rows", limit: limits.maxRows } };
    }
  }
  return { rows, error: null };
}
