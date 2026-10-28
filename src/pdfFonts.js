// Shared font + text helpers for the app's jsPDF documents (Delivery Schedule
// PDF, Sales Order PDF). The fonts are self-hosted Noto Sans SC subsets in
// public/fonts (see public/fonts/README.md) so Chinese text renders.

export const SCHEDULE_FONT_FILES = { regular: "NotoSansSC-Schedule-Regular.ttf", bold: "NotoSansSC-Schedule-Bold.ttf" };

// Invisible/zero-width characters (seen in pasted remarks) and CR/tab
// normalisation — they'd otherwise print as missing-glyph boxes.
export const clean = s => String(s ?? "").replace(/[​-‍⁠﻿]/g, "").replace(/\r\n?/g, "\n").replace(/\t/g, " ");
// The bold subset only carries Latin + punctuation; anything else is drawn in
// Regular so it never comes out as missing glyphs.
const BOLD_EXTRA = new Set([0x20ac, 0x2122, 0x2713, 0x2714]); // € ™ ✓ ✔
export const boldSafe = s => [...String(s)].every(ch => {
  const cp = ch.codePointAt(0);
  return cp <= 0xff || (cp >= 0x2010 && cp <= 0x203a) || BOLD_EXTRA.has(cp);
});

// Register the regular + bold subsets on a jsPDF document under `name`.
export function registerPdfFonts(doc, fonts, name) {
  doc.addFileToVFS(SCHEDULE_FONT_FILES.regular, fonts.regular);
  doc.addFont(SCHEDULE_FONT_FILES.regular, name, "normal");
  doc.addFileToVFS(SCHEDULE_FONT_FILES.bold, fonts.bold);
  doc.addFont(SCHEDULE_FONT_FILES.bold, name, "bold");
  doc.setFont(name, "normal");
}

// Fonts are fetched once per session, only when a PDF is actually downloaded.
const fontCache = {};
const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
export function loadFont(file) {
  if (!fontCache[file]) {
    fontCache[file] = fetch(`${process.env.PUBLIC_URL || ""}/fonts/${file}`)
      .then(r => { if (!r.ok) throw new Error(`Could not load the PDF font (${r.status})`); return r.arrayBuffer(); })
      .then(toBase64)
      .catch(e => { delete fontCache[file]; throw e; });
  }
  return fontCache[file];
}

export const loadPdfFonts = () => Promise.all([loadFont(SCHEDULE_FONT_FILES.regular), loadFont(SCHEDULE_FONT_FILES.bold)])
  .then(([regular, bold]) => ({ regular, bold }));
