# Fonts for the Delivery Schedule PDF

`NotoSansSC-Schedule-Regular.ttf` and `NotoSansSC-Schedule-Bold.ttf` are
glyph **subsets** of Noto Sans SC (Regular 400 / Bold 700), used by
`src/teamSchedulePdf.js` so the downloaded schedule PDF can render Chinese
remarks, service notes and item names. They are fetched only when someone
clicks **Download PDF**.

- Regular: Basic Latin + Latin-1, general punctuation, CJK symbols and
  full-width forms, all GB2312 characters, plus every character present in
  the production schedule data when the subset was built (2026-10-01).
- Bold: Latin + punctuation only (bold is used for SO numbers, headers and
  status labels; non-Latin bold text falls back to Regular).

Source: Noto Sans SC, Copyright 2014-2021 Adobe (http://www.adobe.com/), with
Reserved Font Name 'Source'. Obtained from the `@expo-google-fonts/noto-sans-sc`
package (static TTF builds of the Google Fonts release).

Licensed under the SIL Open Font License, Version 1.1 — see `OFL.txt`.
These are Modified Versions (subsets) under the OFL and do not use the
Reserved Font Name.
