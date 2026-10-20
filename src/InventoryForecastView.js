import React, { useState, useMemo, useEffect } from "react";
import { productLabel, matchesProductSearch } from "./productLabel";

// Inventory → Forecast: per-month projected stock per product (data from GET /inventory/projection,
// already scoped to the active company by the backend). Quantities are shown exactly as the backend
// computes them; this view only labels, searches, filters and pages the product rows.

export const FORECAST_PAGE_SIZE = 50;

const fmtMonth = m => { const [y, mo] = String(m).split("-"); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-MY", { month: "short", year: "numeric" }); };
const fmtDay = d => d ? new Date(String(d).length <= 10 ? d + "T00:00:00" : d).toLocaleDateString("en-MY", { day: "numeric", month: "short" }) : "";

export function ProductCell({ label }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0" data-testid="product-cell">
      {label.model && <span className="font-mono text-xs font-semibold text-violet-700" data-part="model">{label.model}</span>}
      {label.name
        ? <span className="font-medium text-gray-900 break-words" data-part="name">{label.name}</span>
        : <span className="italic text-gray-400" data-part="name">No product name</span>}
      {label.size && <span className="text-xs text-gray-500" data-part="size">{label.size}</span>}
      {label.needsReview && (
        <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold tracking-wide" title={label.reviewText} data-part="review">
          NEEDS REVIEW
        </span>
      )}
      {label.reviewReason === "record_missing" && label.id && <span className="text-[10px] text-gray-400 font-mono">ID …{String(label.id).slice(-6)}</span>}
    </div>
  );
}

export default function InventoryForecastView({ projection = [], loading = false, months, onMonthsChange, resetKey }) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all"); // "all" | "review"
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set()); // "month|product_id"
  const toggle = key => setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Another company, new data, a new search or filter → back to page 1.
  useEffect(() => { setPage(0); }, [search, view, resetKey, projection]);
  useEffect(() => { setSearch(""); setView("all"); setExpanded(new Set()); }, [resetKey]);

  const labelled = useMemo(() => projection.map(p => ({ ...p, label: productLabel(p.product || { id: p.product_id, product_missing: true }) })), [projection]);
  const searched = useMemo(() => labelled.filter(p => matchesProductSearch(p.label, search)), [labelled, search]);
  const reviewCount = useMemo(() => searched.filter(p => p.label.needsReview).length, [searched]);
  const filtered = useMemo(() => {
    const rows = view === "review" ? searched.filter(p => p.label.needsReview) : searched;
    // Products that run out first, then model → name.
    return [...rows].sort((a, b) => (a.first_negative ? 0 : 1) - (b.first_negative ? 0 : 1)
      || a.label.model.localeCompare(b.label.model) || a.label.name.localeCompare(b.label.name));
  }, [searched, view]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / FORECAST_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * FORECAST_PAGE_SIZE, (safePage + 1) * FORECAST_PAGE_SIZE);

  // Month cards: every month lists this page's products; the "run out" count covers ALL filtered products.
  const byMonth = useMemo(() => {
    const map = {}, negatives = {};
    for (const p of filtered) for (const m of (p.months || [])) if (m.closing < 0) negatives[m.month] = (negatives[m.month] || 0) + 1;
    for (const p of pageRows) {
      for (const m of (p.months || [])) {
        const inQty = (m.events || []).filter(e => e.type === "in").reduce((s, e) => s + (Number(e.qty) || 0), 0);
        const outQty = (m.events || []).filter(e => e.type === "out").reduce((s, e) => s + (Number(e.qty) || 0), 0);
        (map[m.month] ||= []).push({ product_id: p.product_id, label: p.label, opening: m.opening, closing: m.closing, inQty, outQty, events: m.events || [] });
      }
    }
    return Object.keys(map).sort().map(month => ({
      month,
      rows: map[month].sort((a, b) => (a.closing < 0 ? 0 : 1) - (b.closing < 0 ? 0 : 1)),
      negatives: negatives[month] || 0,
    }));
  }, [filtered, pageRows]);

  const tabBtn = (key, text, count, tone) => (
    <button type="button" onClick={() => setView(key)} aria-pressed={view === key}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${view === key ? (tone === "amber" ? "bg-amber-500 text-white" : "bg-violet-600 text-white") : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
      {text} <span className={`ml-1 text-xs ${view === key ? "opacity-90" : "text-gray-400"}`}>{count}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <p className="text-sm text-gray-500 max-w-2xl">Projected stock per product: opening on-hand, upcoming <b>out</b> (confirmed orders by delivery date) and <b>in</b> (open POs by expected date), and each month's closing balance. A red month is when a product runs out — restock before that date.</p>
        {onMonthsChange && (
          <label className="text-xs text-gray-500 flex items-center gap-2">Horizon
            <select value={months} onChange={e => onMonthsChange(Number(e.target.value))} className="border rounded-lg px-2 py-1 text-sm">
              {[3, 6, 9, 12].map(m => <option key={m} value={m}>{m} months</option>)}
            </select>
          </label>
        )}
      </div>

      {!loading && projection.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search product"
            placeholder="Search product — model, SKU, name or size"
            className="w-full sm:w-80 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
          <div className="flex gap-2">
            {tabBtn("all", "All", searched.length)}
            {tabBtn("review", "Needs Review", reviewCount, "amber")}
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-gray-400">Loading forecast…</p>}
      {!loading && projection.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400">
          <p className="font-medium">Nothing to forecast yet</p>
          <p className="text-xs mt-1">Products appear here once they have stock, upcoming confirmed orders, or open purchase orders.</p>
        </div>
      )}
      {!loading && projection.length > 0 && filtered.length === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 text-sm">
          {view === "review" && !search ? "No products need review." : "No products match this search."}
          {(search || view !== "all") && <button type="button" onClick={() => { setSearch(""); setView("all"); }} className="ml-2 text-violet-700 underline">Clear</button>}
        </div>
      )}

      {!loading && filtered.length > 0 && byMonth.map(({ month, rows, negatives }) => (
        <div key={month} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${negatives > 0 ? "border-red-200" : "border-gray-100"}`}>
          <div className="px-3 sm:px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2 bg-gray-50/60">
            <span className="font-bold text-gray-900 text-sm">{fmtMonth(month)}</span>
            {negatives > 0
              ? <span className="bg-red-100 text-red-700 font-semibold text-xs px-2 py-1 rounded-full">{negatives} product{negatives > 1 ? "s" : ""} run out</span>
              : <span className="bg-emerald-100 text-emerald-700 font-medium text-xs px-2 py-1 rounded-full">All covered</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="text-gray-400 text-left text-xs uppercase tracking-wide">
                <th className="px-3 sm:px-4 py-2 font-medium">Product <span className="normal-case tracking-normal text-gray-300">(model · name · size)</span></th>
                <th className="px-3 py-2 font-medium text-right w-20">Opening</th>
                <th className="px-3 py-2 font-medium text-right w-20">In</th>
                <th className="px-3 py-2 font-medium text-right w-20">Out</th>
                <th className="px-3 sm:px-4 py-2 font-medium text-right w-24">Closing</th>
              </tr></thead>
              <tbody>
                {rows.map(r => {
                  const key = `${month}|${r.product_id}`;
                  const hasEvents = (r.events || []).length > 0;
                  const open = expanded.has(key);
                  return (
                    <React.Fragment key={r.product_id}>
                      <tr onClick={() => hasEvents && toggle(key)} data-testid="forecast-row"
                        className={`border-t border-gray-100 align-top ${r.closing < 0 ? "bg-red-50/50" : ""} ${hasEvents ? "cursor-pointer hover:bg-gray-50" : ""}`}>
                        <td className="px-3 sm:px-4 py-2.5">
                          <div className="flex gap-1">
                            <span className="text-gray-300 text-xs inline-block w-3 shrink-0 pt-0.5">{hasEvents ? (open ? "▾" : "▸") : ""}</span>
                            <ProductCell label={r.label} />
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-gray-500">{r.opening}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-emerald-600">{r.inQty ? `+${r.inQty}` : ""}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-red-600">{r.outQty ? `−${r.outQty}` : ""}</td>
                        <td data-testid="closing" className={`px-3 sm:px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-bold ${r.closing < 0 ? "text-red-600" : "text-gray-800"}`}>{r.closing}</td>
                      </tr>
                      {open && hasEvents && (
                        <tr className="bg-gray-50/70">
                          <td colSpan={5} className="px-3 sm:px-4 py-2">
                            <div className="space-y-0.5 pl-6">
                              {r.events.map((e, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                  <span className="text-gray-400 w-14 shrink-0">{fmtDay(e.date)}</span>
                                  <span className={`font-semibold w-12 shrink-0 tabular-nums ${e.type === "in" ? "text-emerald-600" : "text-red-600"}`}>{e.type === "in" ? "+" : "−"}{e.qty}</span>
                                  <span className="text-gray-500 shrink-0">{e.type === "in" ? "PO" : "SO"} {e.ref}</span>
                                  <span className="text-gray-400 ml-auto tabular-nums">balance {e.balance}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {!loading && filtered.length > FORECAST_PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 text-sm" data-testid="pager">
          <span className="text-gray-500">
            {safePage * FORECAST_PAGE_SIZE + 1}–{Math.min(filtered.length, (safePage + 1) * FORECAST_PAGE_SIZE)} of {filtered.length} products
          </span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-40">Previous</button>
            <span className="text-gray-500 tabular-nums">Page {safePage + 1} / {pageCount}</span>
            <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
