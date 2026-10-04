# Test fixtures

Every file here is synthetic. Never commit a real player's export.

- `sample-v1.csv`: a format v1 export with the real header, made from the
  DynamicGlyph column list rather than exported from a phone. The ids and
  build numbers are made up. It holds:
  - a hack with two portal items and one Bonus item;
  - a drop with a recognized item, an unrecognized row and an empty, partly
    read Bonus panel;
  - an older hack with no gear reading and no capture origin.

Tests build other cases in code with `tests/helpers/export.ts`.
