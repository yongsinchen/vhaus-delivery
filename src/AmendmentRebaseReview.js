import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./AuthContext";
import { useToast } from "./UIComponents";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => {
  const token = await getToken();
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } });
};
const money = v => `RM ${(Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Simple business labels — never expose internal field names to the user.
const HEADER_LABELS = {
  customer_name: "Customer Name", customer_contact: "Contact", customer_address: "Customer Address",
  customer_id_type: "ID Type", customer_id_no: "IC/ID", customer_email: "Email",
  delivery_address: "Delivery Address", delivery_date: "Delivery Date", delivery_time_slot: "Delivery Time",
  delivery_type: "Delivery Type", salesman_name: "Salesperson", branch_id: "Branch",
  country: "Country", sales_channel: "Sales Channel", order_date: "Order Date", remark: "Remark",
  subtotal: "Subtotal", discount: "Discount", admin_charges: "Admin Charges",
  gst_rate: "GST Rate", gst_amount: "GST Amount", gst_waived: "GST Waived",
  einvoice_requested: "E-Invoice", payment_method: "Payment Method",
};
const MONEY_FIELDS = new Set(["subtotal", "discount", "admin_charges", "gst_rate", "gst_amount"]);
const BOOL_FIELDS = new Set(["gst_waived", "einvoice_requested"]);
const ITEM_FIELD_LABELS = {
  product_code: "Product Code", product_name: "Product Name", size: "Size", color: "Color",
  quantity: "Quantity", unit_price: "Unit Price", unit_cost: "Unit Cost", notes: "Notes",
  custom_dimensions: "Dimensions", custom_specs: "Specifications", is_custom: "Custom Item", is_clearance: "Clearance Item",
};
const ITEM_MONEY_FIELDS = new Set(["unit_price", "unit_cost"]);

const fieldLabel = (field) => HEADER_LABELS[field] || field;
const itemFieldLabel = (field) => ITEM_FIELD_LABELS[field] || field;
const fmtVal = (field, v, isItem) => {
  if (v === null || v === undefined || v === "") return "—";
  if ((isItem ? ITEM_MONEY_FIELDS : MONEY_FIELDS).has(field)) return money(v);
  if (!isItem && BOOL_FIELDS.has(field)) return v === true || v === "true" ? "Yes" : "No";
  return String(v);
};

function findItemDisplay(itemId, ...snapshots) {
  for (const snap of snapshots) {
    const items = snap?.sales_order_items || snap?.items || [];
    const found = items.find(it => String(it.id) === String(itemId) || String(it.source_item_id) === String(itemId));
    if (found) return found;
  }
  return null;
}
function itemLabel(display) {
  if (!display) return "Item";
  const parts = [display.product_code, display.size, display.color].filter(Boolean);
  return display.product_name ? `${display.product_name}${parts.length ? ` (${parts.join(" / ")})` : ""}` : (display.product_code || "Item");
}

// Choice buttons — no default selection, ever.
function ChoiceButtons({ path, value, onChoose }) {
  return (
    <div className="flex gap-2 mt-2">
      <button onClick={() => onChoose(path, "proposed")}
        className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${value === "proposed" ? "bg-violet-600 text-white border-violet-600" : "bg-white text-violet-700 border-violet-200 hover:bg-violet-50"}`}>
        Use Salesman Change
      </button>
      <button onClick={() => onChoose(path, "live")}
        className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${value === "live" ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}>
        Keep Current Live
      </button>
    </div>
  );
}

function ConflictRow({ conflict, before, proposed, live, resolution, onChoose }) {
  const isRemoval = conflict.field === "__removed__";
  if (conflict.scope === "header") {
    const label = fieldLabel(conflict.field);
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-bold text-gray-900">{label}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 text-xs">
          <div><span className="text-gray-400 block">Original</span><span className="text-gray-600">{fmtVal(conflict.field, conflict.base)}</span></div>
          <div><span className="text-gray-400 block">Salesman Change</span><span className="font-medium text-violet-700">{fmtVal(conflict.field, conflict.proposed)}</span></div>
          <div><span className="text-gray-400 block">Current Live</span><span className="font-medium text-gray-800">{fmtVal(conflict.field, conflict.live)}</span></div>
        </div>
        <ChoiceButtons path={conflict.path} value={resolution} onChoose={onChoose} />
      </div>
    );
  }

  const display = findItemDisplay(conflict.item_id, live, proposed, before);
  const label = itemLabel(display);

  if (isRemoval) {
    const salesmanRemoved = conflict.proposed === "removed";
    const message = salesmanRemoved
      ? "Salesman removed this item, but the order item was updated after the amendment was submitted."
      : "The order item was removed, but the salesman changed it in this amendment.";
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-bold text-gray-900">{label}</p>
        <p className="text-xs text-gray-600 mt-1">{message}</p>
        <ChoiceButtons path={conflict.path} value={resolution} onChoose={onChoose} />
      </div>
    );
  }

  const fLabel = itemFieldLabel(conflict.field);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-bold text-gray-900">{label}</p>
      <p className="text-xs text-gray-500">{fLabel}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 text-xs">
        <div><span className="text-gray-400 block">Original</span><span className="text-gray-600">{fmtVal(conflict.field, conflict.base, true)}</span></div>
        <div><span className="text-gray-400 block">Salesman Change</span><span className="font-medium text-violet-700">{fmtVal(conflict.field, conflict.proposed, true)}</span></div>
        <div><span className="text-gray-400 block">Current Live</span><span className="font-medium text-gray-800">{fmtVal(conflict.field, conflict.live, true)}</span></div>
      </div>
      <ChoiceButtons path={conflict.path} value={resolution} onChoose={onChoose} />
    </div>
  );
}

// Non-conflicting changes — collapsed by default, shown for context only.
function autoMergedSummary(originalBefore, rebased, currentLive, originalProposed, conflictPaths) {
  const lines = [];
  for (const field of Object.keys(HEADER_LABELS)) {
    if (conflictPaths.has(`header.${field}`)) continue;
    const beforeVal = originalBefore?.[field], rebasedVal = rebased?.[field];
    if (String(beforeVal ?? "") === String(rebasedVal ?? "")) continue;
    const matchesProposed = String(originalProposed?.[field] ?? "") === String(rebasedVal ?? "");
    lines.push(`${matchesProposed ? "Salesman" : "Order"} changed ${fieldLabel(field)} to ${fmtVal(field, rebasedVal)}`);
  }
  const rebasedItems = rebased?.items || [];
  const beforeItems = originalBefore?.sales_order_items || originalBefore?.items || [];
  const beforeIds = new Set(beforeItems.map(it => String(it.id)));
  const rebasedIds = new Set(rebasedItems.map(it => String(it.id)));
  for (const it of rebasedItems) {
    if (conflictPaths.has(`items.${it.id}.__removed__`)) continue;
    if (!beforeIds.has(String(it.id))) lines.push(`New item added: ${itemLabel(it)}`);
  }
  for (const it of beforeItems) {
    if (conflictPaths.has(`items.${it.id}.__removed__`)) continue;
    if (!rebasedIds.has(String(it.id))) lines.push(`Item removed: ${itemLabel(it)}`);
  }
  return lines;
}

export default function AmendmentRebaseReview({ amendment, onClose, onApplied }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [preview, setPreview] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [stale, setStale] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showMerged, setShowMerged] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true); setLoadError(""); setStale(false); setResolutions({}); setUnsupported(false);
    try {
      const res = await af(`${API}/order-amendments/${amendment.id}/rebase-preview`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        if (d.code === "active_do_rebase_unsupported") { setUnsupported(true); return; }
        throw new Error(d.error || "Failed to load review");
      }
      setPreview(d);
    } catch (e) { setLoadError(e.message || "Failed to load review"); }
    finally { setLoading(false); }
  }, [amendment.id]);
  useEffect(() => { loadPreview(); }, [loadPreview]);

  const choose = (path, choice) => setResolutions(prev => ({ ...prev, [path]: { choice } }));

  const conflicts = preview?.conflicts || [];
  const allResolved = conflicts.length > 0 && conflicts.every(c => resolutions[c.path]);
  const conflictPaths = new Set(conflicts.map(c => c.path));
  const mergedLines = preview ? autoMergedSummary(preview.original_before, preview.rebased_proposed_snapshot, preview.current_live, preview.original_proposed, conflictPaths) : [];

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await af(`${API}/order-amendments/${amendment.id}/rebase-resolve`, { method: "POST", body: JSON.stringify({ field_resolutions: resolutions }) });
      const d = await res.json();
      if (!res.ok) {
        if (d.reason === "rebase_stale") { setStale(true); return; }
        throw new Error(d.error || "Failed to apply");
      }
      toast.success("Amendment Applied");
      onApplied?.();
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-scaleIn">
        <div className="px-5 sm:px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-gray-900">Review Order Changes</h3>
            <p className="text-xs text-gray-500 mt-1">This order changed after the salesman submitted the amendment. Review only the fields that now conflict.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
        </div>

        <div className="px-5 sm:px-6 py-4 overflow-y-auto flex-1 space-y-3">
          {loading && <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>}

          {!loading && unsupported && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              This order has an active Delivery Order — conflict resolution for Active-DO amendments isn't supported yet. Reject this amendment and ask the salesperson to resubmit, or resolve the Delivery Order state first.
            </div>
          )}

          {!loading && loadError && (
            <div className="text-center py-8">
              <p className="text-sm text-red-500 font-medium">{loadError}</p>
              <button onClick={loadPreview} className="mt-3 text-sm px-4 py-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-100">Retry</button>
            </div>
          )}

          {!loading && stale && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
              <p className="text-sm font-bold text-orange-800">Order changed again after this review started.</p>
              <button onClick={loadPreview} className="mt-3 text-sm px-4 py-2 rounded-xl bg-orange-600 text-white font-medium hover:bg-orange-700">Review Latest Changes</button>
            </div>
          )}

          {!loading && !loadError && !unsupported && !stale && preview && (
            <>
              {conflicts.length === 0 && (
                <p className="text-sm text-gray-500">No conflicting fields — every change can be merged automatically.</p>
              )}
              {conflicts.map((c, i) => (
                <ConflictRow key={c.path || i} conflict={c} before={preview.original_before} proposed={preview.original_proposed} live={preview.current_live}
                  resolution={resolutions[c.path]?.choice} onChoose={choose} />
              ))}

              {mergedLines.length > 0 && (
                <div className="border border-gray-200 rounded-xl">
                  <button onClick={() => setShowMerged(v => !v)} className="w-full px-3 py-2 text-left text-xs font-medium text-gray-600 flex items-center justify-between">
                    <span>Automatically Merged Changes ({mergedLines.length})</span>
                    <span>{showMerged ? "▲" : "▼"}</span>
                  </button>
                  {showMerged && (
                    <div className="px-3 pb-3 space-y-1">
                      {mergedLines.map((l, i) => <p key={i} className="text-xs text-gray-500">• {l}</p>)}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {!loading && !loadError && !unsupported && !stale && preview && (
          <div className="px-5 sm:px-6 py-4 border-t border-gray-100 flex gap-3">
            <button onClick={onClose} disabled={submitting} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">Cancel</button>
            <button onClick={submit} disabled={submitting || !allResolved}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
              {submitting ? "Applying…" : "Resolve & Apply"}
            </button>
          </div>
        )}
      </div>
      <style>{`
        @keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .animate-scaleIn { animation: scaleIn 0.2s ease-out; }
      `}</style>
    </div>
  );
}

// Named exports for direct unit testing of pure logic / subcomponents,
// matching this codebase's established convention of rendering a
// subcomponent with props only rather than mocking fetch wherever possible.
export { ConflictRow, ChoiceButtons, findItemDisplay, itemLabel, autoMergedSummary, fieldLabel, itemFieldLabel, fmtVal, HEADER_LABELS };
