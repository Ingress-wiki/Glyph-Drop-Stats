/**
 * Line breaking for prose. synth-ui's word wrap breaks only at spaces, so a
 * Chinese or Japanese sentence (which has none) after an English word moves
 * whole to the next line. Here Chinese and Japanese may break between any two
 * characters, but not before closing punctuation or after opening
 * punctuation (a light kinsoku). Korean, like English, breaks at spaces.
 */

/** Characters each set apart from their neighbours: Han, kana and full-width forms. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

/** Never start a line with these: closing punctuation, small kana, the prolonged sound mark. */
const NO_BREAK_BEFORE = new Set([..."、。，．,.！？!?：；:;）)」』】〕〉》〟”’…‥ー・ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ％%"]);

/** Never end a line with these: opening punctuation. */
const NO_BREAK_AFTER = new Set([..."（(「『【〔〈《〝“‘"]);

/** Whether a line may break between `before` and `after` (neither a space). */
function breakable(before: string, after: string): boolean {
  if (NO_BREAK_BEFORE.has(after) || NO_BREAK_AFTER.has(before)) return false;
  return CJK.test(before) || CJK.test(after);
}

/** Pieces that stay on one line: a word, or one CJK character with any punctuation it holds on to. */
function pieces(text: string): { text: string; spaceBefore: boolean }[] {
  const out: { text: string; spaceBefore: boolean }[] = [];
  let current = "";
  let spaceBefore = false;
  let pendingSpace = false;
  for (const ch of text) {
    if (ch === " ") {
      if (current) out.push({ text: current, spaceBefore });
      current = "";
      spaceBefore = false;
      pendingSpace = true;
      continue;
    }
    const last = [...current].at(-1);
    if (current && last !== undefined && breakable(last, ch)) {
      out.push({ text: current, spaceBefore });
      current = "";
      spaceBefore = false;
    }
    if (!current) spaceBefore = pendingSpace;
    pendingSpace = false;
    current += ch;
  }
  if (current) out.push({ text: current, spaceBefore });
  return out;
}

/**
 * `text` as lines no wider than `width` (as `measure` measures them), keeping
 * its own newlines. A piece wider than a whole line is split by character.
 */
export function breakLines(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const piece of pieces(paragraph)) {
      const joined = line ? line + (piece.spaceBefore ? " " : "") + piece.text : piece.text;
      if (measure(joined) <= width) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const ch of piece.text) {
        if (line && measure(line + ch) > width) {
          lines.push(line);
          line = "";
        }
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}
