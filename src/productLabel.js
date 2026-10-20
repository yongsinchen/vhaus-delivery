// Product labels for operational lists (Inventory → Forecast) — PRESENTATION ONLY.
// The stored product data is never changed: text is upper-cased for display,
// nothing missing is ever filled in, and a row without a real product name is
// flagged "Needs Review" instead of being shown under a generic "Product" label.
//   model = products.code (the model / SKU code) · name = products.name · size = products.size

const clean = v => String(v ?? "").replace(/\s+/g, " ").trim();

// Names that are only a placeholder, not a product name.
const PLACEHOLDER_NAMES = new Set(["PRODUCT", "PRODUCTS", "ITEM"]);

export const REVIEW_REASONS = {
  record_missing: "Product record not found for this company",
  name_missing: "Product name missing",
  placeholder_name: "Product name is only a placeholder",
};

export function productLabel(product) {
  const p = product || {};
  const model = clean(p.code).toUpperCase();
  const storedName = clean(p.name).toUpperCase();
  const size = clean(p.size).toUpperCase();
  let reason = null;
  if (p.product_missing) reason = "record_missing";
  else if (!storedName) reason = "name_missing";
  else if (PLACEHOLDER_NAMES.has(storedName)) reason = "placeholder_name";
  const name = reason === "placeholder_name" ? "" : storedName;
  return {
    id: p.id || null,
    model,
    name,
    size,
    needsReview: !!reason,
    reviewReason: reason,
    reviewText: reason ? REVIEW_REASONS[reason] : null,
    // model → name → size, the same order the row shows them
    searchText: [model, storedName, size].filter(Boolean).join(" ").toLowerCase(),
  };
}

// Case-insensitive; every word typed must appear somewhere in model / name / size
// ("kayla 6ft" finds model KAYLA in size 6FT).
export function matchesProductSearch(label, query) {
  const terms = clean(query).toLowerCase().split(" ").filter(Boolean);
  if (!terms.length) return true;
  return terms.every(t => label.searchText.includes(t));
}
