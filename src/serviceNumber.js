// Service Case numbering + schedule salesperson — display helpers.
//
// The backend (lib/service-number.js) sends `display_number` (`_display_number`
// on /service-cases): "SV-30228" for a case linked to SO 30228 ("SV-30228-2"
// for a 2nd case on the same SO); a standalone case keeps its running number.
// The internal running number (sv_number) is never shown as the primary number
// of a linked case. Older payloads without display_number fall back to it.

/** "30228" / "SO30228" → "SO30228" (the stored number is bare). */
export const soLabel = n => {
  // Same rule as the backend label: every SO number in the stored text
  // ("55732 55733" / "21312 & 21313" → "SO55732 / SO55733").
  const text = String(n || "").trim();
  if (!text) return null;
  if (/^[A-Za-z][A-Za-z]?-\d+$/.test(text)) return text; // a lettered order code ("F-11131") is shown as stored
  const toks = text.match(/(?:SO[-\s]?)?\d+(?:-\d+)?/gi) || [];
  return toks.length ? [...new Set(toks.map(t => `SO${t.replace(/^SO[-\s]?/i, "")}`))].join(" / ") : text;
};

/** The number staff see for a Service Case (workbench row, /service-cases row, or a Service legacy order). */
export const serviceNumberOf = x =>
  x?.display_number || x?._display_number || x?.sv_number || x?._sv_number || null;

/** "SO30228" for a Service linked to a Sales Order, else null (never invented for a standalone case). */
export const linkedSoLabelOf = x =>
  x?.linked_so_label || x?._linked_so_label || (x?.linked_so ? soLabel(x.linked_so) : null);

/**
 * Salesperson of a schedule stop / pool card. The backend resolves it from the
 * Sales Order (or, for a linked Service, its source Sales Order); a standalone
 * Service shows only its own stored salesman. Never inferred from the customer
 * or from who scheduled the job.
 */
export const salespersonOf = o => {
  if (!o) return null;
  if (o.salesperson !== undefined) return o.salesperson || null;
  const isService = String(o.type || "").toLowerCase() === "service";
  if (isService) return o.linked_so ? null : o.salesman || null;
  return o.salesman || null;
};
