import { describe, expect, it } from "vitest";
import { parseCsv, type CsvLimits } from "../src/domain/csv.ts";

const LIMITS: CsvLimits = { maxRows: 100, maxFieldsPerRow: 10, maxFieldLength: 20 };

const fields = (text: string) => parseCsv(text, LIMITS).rows.map((row) => row.fields);

describe("parseCsv", () => {
  it("splits CRLF rows into fields", () => {
    expect(fields("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("accepts LF line endings and a missing final line break", () => {
    expect(fields("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps empty fields, including a trailing one", () => {
    expect(fields(",a,,\r\n")).toEqual([["", "a", "", ""]]);
  });

  it("reads quoted fields with commas, doubled quotes and line breaks", () => {
    expect(fields('"a,b","say ""hi""","two\r\nlines"\r\nx,y,z\r\n')).toEqual([
      ["a,b", 'say "hi"', "two\r\nlines"],
      ["x", "y", "z"],
    ]);
  });

  it("reads an empty quoted field as a field", () => {
    expect(fields('""\r\n')).toEqual([[""]]);
    expect(fields('a,""\r\n')).toEqual([["a", ""]]);
  });

  it("skips blank lines", () => {
    expect(fields("a\r\n\r\nb\r\n\r\n")).toEqual([["a"], ["b"]]);
  });

  it("reports the line each row starts on", () => {
    const result = parseCsv('a\r\n"x\ny"\r\nb\r\n', LIMITS);
    expect(result.rows.map((row) => row.line)).toEqual([1, 2, 4]);
  });

  it("rejects an unterminated quote", () => {
    expect(parseCsv('a,"b\r\n', LIMITS).error).toEqual({ code: "unterminated_quote", line: 1 });
  });

  it("rejects a quote inside an unquoted field", () => {
    expect(parseCsv('ab"c\r\n', LIMITS).error).toEqual({ code: "unexpected_quote", line: 1 });
  });

  it("rejects text after a closing quote", () => {
    expect(parseCsv('"a"b,c\r\n', LIMITS).error).toEqual({ code: "text_after_quote", line: 1 });
  });

  it("stops once the row limit is passed", () => {
    const result = parseCsv("a\r\nb\r\nc\r\nd\r\n", { ...LIMITS, maxRows: 2 });
    expect(result.error).toEqual({ code: "too_many_rows", limit: 2 });
    expect(result.rows).toHaveLength(3);
  });

  it("stops at a row with too many fields", () => {
    expect(parseCsv("a,b,c\r\n", { ...LIMITS, maxFieldsPerRow: 2 }).error).toEqual({
      code: "too_many_fields",
      line: 1,
      limit: 2,
    });
  });

  it("stops at a field that is too long, quoted or not", () => {
    const long = "x".repeat(21);
    expect(parseCsv(`a,${long}\r\n`, LIMITS).error).toEqual({ code: "field_too_long", line: 1, limit: 20 });
    expect(parseCsv(`a\r\n"${long}"\r\n`, LIMITS).error).toEqual({ code: "field_too_long", line: 2, limit: 20 });
  });

  it("counts lines inside quoted fields", () => {
    expect(parseCsv('"a\r\nb\r\nc"\r\n"', LIMITS).error).toEqual({ code: "unterminated_quote", line: 4 });
  });
});
