import React, { useEffect, useMemo, useRef, useState } from "react";

// ══════════════════════════════════════════════════════════════════
// Confirm Delivered Items — owner decision 2026-10-20: an order only becomes
// Delivered once the delivered ITEM QUANTITIES are recorded. Used by the
// Orders page ("Delivered" status), the Driver app and the Delivery Schedule
// board (legacy stops). "Delivered" = customer-confirmed delivery.
//
// Props:
//   title, subtitle            — header text
//   load()   → Promise<context>  GET …/delivery-confirmation body
//   submit({ lines, idempotency_key }) → Promise<{ ok, body }>
//   onClose(), onDone(confirmation)
//
// Defaults (never assume a DO was delivered):
//   • exactly one open Delivery Order → it is pre-selected, its lines at full quantity;
//   • several open Delivery Orders    → none selected — staff tick what was delivered;
//   • items not on any DO             → listed under "Delivered without a Delivery Order",
//                                        pre-filled only when the order has no open DO.
// A line left at 0 on a selected DO is recorded as not delivered and goes back
// to be scheduled again (partial delivery = a new DO for the rest, as today).
// ══════════════════════════════════════════════════════════════════

const num = v => Number(v) || 0;
export const doLineKey = (doId, itemId) => `${doId || "none"}|${itemId}`;
// Billing / service lines (BILL "Full Bill Amount", delivery / installation charges, fee lines — flagged by the
// server with the same exact rules as the forecast) are never delivered: shown read-only, never entered.
const goodsLines = d => (d.lines || []).filter(l => !l.non_goods);
const deliverableDos = ctx => (ctx?.open_delivery_orders || []).filter(d => goodsLines(d).length > 0);

/** Initial selection + quantities from the server context. */
export function initialConfirmState(ctx) {
  const openDos = deliverableDos(ctx);
  const selected = new Set(openDos.length === 1 ? [openDos[0].id] : []);
  const qty = {};
  for (const d of openDos) for (const l of goodsLines(d)) qty[doLineKey(d.id, l.sales_order_item_id)] = String(Math.max(0, num(l.quantity) - num(l.delivered_qty)));
  for (const i of ctx?.items || []) if (!i.non_goods && num(i.without_do) > 0) qty[doLineKey(null, i.id)] = String(openDos.length === 0 ? num(i.without_do) : 0);
  return { selected, qty };
}

/** The lines to send, plus validation problems (empty = OK). */
export function buildConfirmLines(ctx, selected, qty) {
  const openDos = deliverableDos(ctx);
  const items = new Map((ctx?.items || []).map(i => [i.id, i]));
  const lines = [], problems = [];
  if (ctx?.only_non_goods) return { lines, problems: ["This order has only billing / charge lines — there is nothing to deliver (flagged for review)"] };
  const bad = v => v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0);
  for (const d of openDos) {
    if (!selected.has(d.id)) continue;
    let total = 0;
    for (const l of goodsLines(d)) {
      const v = qty[doLineKey(d.id, l.sales_order_item_id)] ?? "";
      const max = Math.max(0, num(l.quantity) - num(l.delivered_qty));
      const name = items.get(l.sales_order_item_id)?.product_name || "item";
      if (bad(v)) { problems.push(`${d.do_number}: enter a valid quantity for ${name}`); continue; }
      if (num(v) > max) { problems.push(`${d.do_number}: ${name} — at most ${max}`); continue; }
      if (num(v) > 0) { lines.push({ sales_order_item_id: l.sales_order_item_id, delivery_order_id: d.id, quantity: num(v) }); total += num(v); }
    }
    if (total === 0) problems.push(`${d.do_number} is ticked but no quantity is entered — enter what was delivered or untick it`);
  }
  for (const i of ctx?.items || []) {
    if (i.non_goods || num(i.without_do) <= 0) continue;
    const v = qty[doLineKey(null, i.id)] ?? "";
    if (bad(v)) { problems.push(`Enter a valid quantity for ${i.product_name || "item"}`); continue; }
    if (num(v) > num(i.without_do)) { problems.push(`${i.product_name || "Item"} — at most ${num(i.without_do)} without a Delivery Order`); continue; }
    if (num(v) > 0) lines.push({ sales_order_item_id: i.id, delivery_order_id: null, quantity: num(v) });
  }
  if (!lines.length && !problems.length) problems.push("Enter the delivered quantity of at least one item");
  return { lines, problems };
}

/** What the order will look like after these lines: per PHYSICAL item, and overall (billing lines never count). */
export function summariseConfirm(ctx, lines) {
  const add = new Map();
  for (const l of lines) add.set(l.sales_order_item_id, (add.get(l.sales_order_item_id) || 0) + l.quantity);
  const rows = (ctx?.items || []).filter(i => !i.non_goods).map(i => {
    const after = num(i.delivered_qty) + (add.get(i.id) || 0);
    return { id: i.id, name: i.product_name, code: i.product_code, ordered: num(i.quantity), before: num(i.delivered_qty), now: add.get(i.id) || 0, after };
  });
  const all = rows.length > 0 && rows.every(r => r.after >= r.ordered);
  const any = rows.some(r => r.after > 0);
  return { rows, status: all ? "Delivered" : any ? "Partially Delivered" : "Not delivered" };
}

const newKey = () => {
  try { if (typeof crypto !== "undefined" && crypto.randomUUID) return `cdi-${crypto.randomUUID()}`; } catch {}
  return `cdi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

export default function ConfirmDeliveredItemsModal({ title = "Confirm Delivered Items", subtitle, load, submit, onClose, onDone }) {
  const [ctx, setCtx] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [qty, setQty] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [key] = useState(newKey);   // one key per dialog: a double click or retry can never count twice
  const loadRef = useRef(load);     // load once per dialog (callers pass an inline function)

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await loadRef.current();
        if (!alive) return;
        const init = initialConfirmState(c);
        setCtx(c); setSelected(init.selected); setQty(init.qty);
      } catch (e) { if (alive) setLoadError(e.message || "Could not load the order"); }
    })();
    return () => { alive = false; };
  }, []);

  const { lines, problems } = useMemo(() => (ctx ? buildConfirmLines(ctx, selected, qty) : { lines: [], problems: [] }), [ctx, selected, qty]);
  const summary = useMemo(() => (ctx ? summariseConfirm(ctx, lines) : null), [ctx, lines]);
  const itemName = id => ctx?.items?.find(i => i.id === id)?.product_name || "Item";
  const toggleDo = id => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setQ = (k, v) => setQty(q => ({ ...q, [k]: v }));

  const confirm = async () => {
    setError(null);
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true);
    try {
      const r = await submit({ lines, idempotency_key: key });
      if (!r.ok) { setError(r.body?.error || "Could not confirm the delivery"); return; }
      onDone?.(r.body?.confirmation || null);
    } catch (e) { setError(e.message || "Network error — try again (it will not be counted twice)"); }
    finally { setBusy(false); }
  };

  const noDoItems = (ctx?.items || []).filter(i => !i.non_goods && num(i.without_do) > 0);
  const nonGoodsItems = (ctx?.items || []).filter(i => i.non_goods);
  const openDos = deliverableDos(ctx);
  return (
    <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-4" role="dialog" aria-label={title}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Close">×</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4 text-sm">
          {!ctx && !loadError && <p className="text-gray-400">Loading items…</p>}
          {loadError && <p className="text-red-600" role="alert">{loadError}</p>}
          {ctx && (<>
            <p className="text-xs text-gray-600">Enter what the customer actually received. The order becomes <b>Delivered</b> only when every physical item is recorded; anything not delivered stays open to be scheduled again.</p>

            {ctx.only_non_goods && (
              <p className="rounded-xl bg-sky-50 border border-sky-200 px-3 py-2 text-sky-900" role="note" data-testid="only-non-goods">
                This order has only billing / charge lines — there is nothing to deliver. It keeps its current status and is flagged for review.
              </p>
            )}
            {!ctx.only_non_goods && openDos.length === 0 && noDoItems.length === 0 && <p className="text-gray-500">Nothing is left to deliver on this order.</p>}

            {openDos.map(d => (
              <div key={d.id} className={`rounded-xl border ${selected.has(d.id) ? "border-violet-300 bg-violet-50/40" : "border-gray-200"}`}>
                <label className="flex items-center gap-2 px-3 py-2 cursor-pointer">
                  <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleDo(d.id)} aria-label={`Delivered on ${d.do_number}`} />
                  <span className="font-semibold text-gray-800">{d.do_number}</span>
                  <span className="text-xs text-gray-500">{d.status.replace(/_/g, " ")} · {d.delivery_date || "TBC"}</span>
                </label>
                {selected.has(d.id) && (
                  <table className="w-full text-xs">
                    <thead><tr className="text-gray-500"><th className="text-left font-medium px-3 py-1">Item</th><th className="text-right font-medium px-3 py-1">On this DO</th><th className="text-right font-medium px-3 py-1 w-32">Delivered</th></tr></thead>
                    <tbody>
                      {(d.lines || []).map(l => {
                        const k = doLineKey(d.id, l.sales_order_item_id), max = Math.max(0, num(l.quantity) - num(l.delivered_qty));
                        if (l.non_goods) return (
                          <tr key={k} className="border-t border-gray-100 text-gray-400" data-testid="do-line-non-goods">
                            <td className="px-3 py-1.5">{itemName(l.sales_order_item_id)}</td>
                            <td className="px-3 py-1.5 text-right">—</td>
                            <td className="px-3 py-1.5 text-right text-xs">billing / charge line — not delivered</td>
                          </tr>
                        );
                        return (
                          <tr key={k} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 text-gray-800">{itemName(l.sales_order_item_id)}</td>
                            <td className="px-3 py-1.5 text-right text-gray-600">{max}</td>
                            <td className="px-3 py-1.5 text-right">
                              <input type="number" min="0" max={max} step="1" value={qty[k] ?? ""} onChange={e => setQ(k, e.target.value)}
                                aria-label={`Delivered ${itemName(l.sales_order_item_id)} on ${d.do_number}`}
                                className="w-20 px-2 py-1 rounded-lg border border-gray-200 text-right focus:outline-none focus:border-violet-400" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
            {openDos.length > 1 && <p className="text-xs text-amber-700">This order has {openDos.length} open Delivery Orders — tick only the ones that were delivered.</p>}

            {noDoItems.length > 0 && (
              <div className="rounded-xl border border-gray-200">
                <p className="px-3 py-2 font-semibold text-gray-800">Delivered without a Delivery Order <span className="font-normal text-xs text-gray-500">(a Delivery Order is created for these)</span></p>
                <table className="w-full text-xs">
                  <thead><tr className="text-gray-500"><th className="text-left font-medium px-3 py-1">Item</th><th className="text-right font-medium px-3 py-1">Not on a DO</th><th className="text-right font-medium px-3 py-1 w-32">Delivered</th></tr></thead>
                  <tbody>
                    {noDoItems.map(i => {
                      const k = doLineKey(null, i.id);
                      return (
                        <tr key={k} className="border-t border-gray-100">
                          <td className="px-3 py-1.5 text-gray-800">{i.product_name}{i.product_code ? <span className="text-gray-400"> · {i.product_code}</span> : null}</td>
                          <td className="px-3 py-1.5 text-right text-gray-600">{num(i.without_do)}</td>
                          <td className="px-3 py-1.5 text-right">
                            <input type="number" min="0" max={num(i.without_do)} step="1" value={qty[k] ?? ""} onChange={e => setQ(k, e.target.value)}
                              aria-label={`Delivered ${i.product_name} without a Delivery Order`}
                              className="w-20 px-2 py-1 rounded-lg border border-gray-200 text-right focus:outline-none focus:border-violet-400" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {(ctx.failed_delivery_orders || []).length > 0 && (
              <p className="text-xs text-gray-500">Failed Delivery Order{ctx.failed_delivery_orders.length > 1 ? "s" : ""} {ctx.failed_delivery_orders.map(d => d.do_number).join(", ")}: reschedule or cancel {ctx.failed_delivery_orders.length > 1 ? "them" : "it"} first — {ctx.failed_delivery_orders.length > 1 ? "their" : "its"} items cannot be confirmed here.</p>
            )}

            {nonGoodsItems.length > 0 && (
              <div className="rounded-xl border border-gray-200 px-3 py-2" data-testid="non-goods-lines">
                <p className="font-semibold text-gray-700 text-xs">Billing / charge lines — not delivered</p>
                <p className="text-[11px] text-gray-500 mb-1">Not physical goods: never recorded as delivered and never needed for the order to be Delivered.</p>
                <ul className="text-xs text-gray-600 space-y-0.5">
                  {nonGoodsItems.map(i => <li key={i.id}>{i.product_name}{i.product_code ? <span className="text-gray-400"> · {i.product_code}</span> : null} × {num(i.quantity)}</li>)}
                </ul>
              </div>
            )}

            {summary && summary.rows.length > 0 && (
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-xs font-semibold text-gray-700 mb-1">After confirming: <span className={summary.status === "Delivered" ? "text-emerald-700" : "text-amber-700"}>{summary.status}</span></p>
                <ul className="text-xs text-gray-600 space-y-0.5">
                  {summary.rows.map(r => <li key={r.id}>{r.name}: {r.after} of {r.ordered} delivered{r.now ? ` (+${r.now} now)` : ""}</li>)}
                </ul>
              </div>
            )}
          </>)}
          {error && <p className="text-red-600 text-xs" role="alert">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button onClick={confirm} disabled={!ctx || busy || lines.length === 0}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40">
            {busy ? "Confirming…" : "Confirm Delivered Items"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fetch helpers for the three entry points (base = API url, headers = auth headers). */
export function confirmEndpoints(base, kind, id) {
  const path = kind === "driver" ? `/driver/schedule/${id}` : kind === "schedule" ? `/delivery-schedules/${id}` : `/sales-orders/${id}`;
  return { contextUrl: `${base}${path}/delivery-confirmation`, confirmUrl: `${base}${path}/confirm-delivered-items` };
}
