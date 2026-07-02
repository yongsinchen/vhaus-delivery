import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast, useLoading } from "./UIComponents";

const API = "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { let { data } = await supabase.auth.getSession(); let s = data?.session; if (s?.expires_at && s.expires_at * 1000 < Date.now() + 60000) { const { data: r } = await supabase.auth.refreshSession(); s = r?.session || s; } return s?.access_token || ""; };
const authHeaders = async (json = true) => { const cid = localStorage.getItem("pulseActiveCompanyId"); return { ...(json && { "Content-Type": "application/json" }), Authorization: `Bearer ${await getToken()}`, ...(cid && { "X-Company-ID": cid }) }; };
const fmt = (d) => { if (!d) return "-"; try { return new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }); } catch { return d; } };

const DO_STATUS_STYLE = { Processed: "bg-gray-100 text-gray-600", Reviewed: "bg-blue-100 text-blue-700", Labeled: "bg-violet-100 text-violet-700", Completed: "bg-emerald-100 text-emerald-700" };
const MATCH_BADGE = {
  matched:          { label: "Matched",          cls: "bg-emerald-100 text-emerald-700" },
  pinned:           { label: "Pinned",           cls: "bg-emerald-100 text-emerald-700" },
  already_arrived:  { label: "Already arrived",  cls: "bg-violet-100 text-violet-700" },
  showroom:         { label: "Showroom",         cls: "bg-blue-100 text-blue-700" },
  no_so:            { label: "No SO number",     cls: "bg-gray-100 text-gray-600" },
  so_not_found:     { label: "SO not found",     cls: "bg-amber-100 text-amber-700" },
  item_not_matched: { label: "Item not matched", cls: "bg-red-100 text-red-600" },
};
const ITEM_STATUS_BADGE = (it) => {
  if (it.status === "Matched") return <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">Matched</span>;
  if (it.status === "Resolved" || it.status === "Dismissed") return <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-600">{it.status}</span>;
  const style = { showroom: "bg-blue-100 text-blue-700", no_so: "bg-gray-100 text-gray-600", so_not_found: "bg-amber-100 text-amber-700", item_not_matched: "bg-yellow-100 text-yellow-700", duplicate_arrival: "bg-violet-100 text-violet-700" };
  return <span className={`px-2 py-0.5 rounded-full text-xs ${style[it.reason] || "bg-gray-100 text-gray-600"}`}>{(it.reason || "pending").replace(/_/g, " ")}</span>;
};

export default function SupplierDOPage() {
  const { user, activeCompanyId } = useAuth();
  const toast = useToast();
  const { withLoading } = useLoading();
  const companyId = activeCompanyId || user?.company_id;

  const [dos, setDos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [detail, setDetail] = useState(null);       // { delivery, items }
  const [viewPhoto, setViewPhoto] = useState(null);

  // Upload → preview → confirm flow
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);     // { header, photo_url, items, duplicate_of }
  const [rematching, setRematching] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadDOs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (supplierFilter) params.set("supplier", supplierFilter);
      if (fromDate) params.set("from_date", fromDate);
      if (toDate) params.set("to_date", toDate);
      const res = await fetch(`${API}/supplier-dos?${params}`, { headers: await authHeaders(false) });
      const d = await res.json();
      setDos(Array.isArray(d) ? d : []);
    } catch (e) { toast.error("Failed to load DOs: " + e.message); }
    finally { setLoading(false); }
  }, [supplierFilter, fromDate, toDate, companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadDOs(); }, [loadDOs]);

  const openDetail = async (d) => {
    try {
      await withLoading("Fetching DO details…", async () => {
        const res = await fetch(`${API}/supplier-dos/${d.id}`, { headers: await authHeaders(false) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        setDetail(data);
      });
    } catch (e) { toast.error("Failed to load DO: " + e.message); }
  };

  // ── Step 1: upload file → extract + match preview ─────────────────
  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      await withLoading("Reading document… this may take a moment", async () => {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`${API}/supplier-dos/upload`, { method: "POST", headers: await authHeaders(false), body: fd });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Upload failed");
        setPreview(d);
      });
    } catch (e) { toast.error(e.message); }
    finally { setUploading(false); }
  };

  // ── Step 2: manual fix helpers ─────────────────────────────────────
  const setItem = (idx, patch) => setPreview(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }));

  const rematch = async () => {
    setRematching(true);
    try {
      const res = await fetch(`${API}/supplier-dos/preview-match`, {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ items: preview.items.map(it => ({ itemCode: it.itemCode, itemName: it.itemName, quantity: it.quantity, soNumber: it.soNumber, isShowroom: it.isShowroom })) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Re-match failed");
      setPreview(p => ({ ...p, items: d.items }));
      toast.success("Re-matched");
    } catch (e) { toast.error(e.message); }
    finally { setRematching(false); }
  };

  // ── Step 3: confirm save ───────────────────────────────────────────
  const confirmSave = async (allowDuplicate = false) => {
    setSaving(true);
    try {
      const payload = {
        header: preview.header,
        photo_url: preview.photo_url,
        allow_duplicate: allowDuplicate,
        items: preview.items.map(it => ({
          itemCode: it.itemCode, itemName: it.itemName, quantity: it.quantity,
          soNumber: it.soNumber, isShowroom: it.isShowroom,
          // Pin what the user saw/picked so the commit is deterministic
          _target: it._target || it.match || null,
          product_id: it.product?.id || null,
        })),
      };
      const res = await fetch(`${API}/supplier-dos`, { method: "POST", headers: await authHeaders(), body: JSON.stringify(payload) });
      const d = await res.json();
      if (res.status === 409) {
        if (window.confirm(`${d.error}\n\nSave anyway as a new record?`)) { setSaving(false); return confirmSave(true); }
        setSaving(false); return;
      }
      if (!res.ok) throw new Error(d.error || "Save failed");
      let msg = `DO saved — ${d.matched} matched, ${d.pending_review} pending review, ${d.showroom} showroom`;
      if (d.unrecognized > 0) msg += `, ${d.unrecognized} not in product master`;
      toast.success(msg);
      setPreview(null);
      loadDOs();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  // ══ Preview / manual-fix screen ═════════════════════════════════════
  if (preview) {
    const matchedCount = preview.items.filter(it => ["matched", "pinned"].includes(it._target ? "pinned" : it.matchStatus)).length;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Confirm Supplier DO</h1>
            <p className="text-sm text-gray-500">Review the extracted data, fix any mismatches, then confirm.</p>
          </div>
          <button onClick={() => { if (window.confirm("Discard this upload?")) setPreview(null); }} className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl px-4 py-2">✕ Discard</button>
        </div>

        {preview.duplicate_of && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-800">
            ⚠️ DO #{preview.duplicate_of.do_number} was already uploaded on {fmt(preview.duplicate_of.created_at)} ({preview.duplicate_of.supplier || "unknown supplier"}). Saving will be blocked unless you explicitly allow a duplicate.
          </div>
        )}

        {/* Editable header */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[["do_number", "DO Number"], ["supplier", "Supplier"], ["do_date", "DO Date", "date"], ["supplier_reference", "Reference"]].map(([k, label, type]) => (
            <div key={k}>
              <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
              <input type={type || "text"} value={preview.header[k] || ""} onChange={e => setPreview(p => ({ ...p, header: { ...p.header, [k]: e.target.value } }))}
                className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
          ))}
        </div>

        {/* Items */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-700">Items ({preview.items.length}) — {matchedCount} matched</h3>
            <div className="flex gap-2 items-center">
              {preview.photo_url && <button onClick={() => setViewPhoto(preview.photo_url)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-violet-100">📷 Photo</button>}
              <button onClick={rematch} disabled={rematching} className="text-xs px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50">{rematching ? "Matching…" : "🔄 Re-match"}</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left w-28">SO #</th>
                <th className="px-3 py-2 text-center w-20">Qty</th><th className="px-3 py-2 text-left">Match</th>
              </tr></thead>
              <tbody>
                {preview.items.map((it, idx) => {
                  const status = it._target ? "pinned" : it.matchStatus;
                  const badge = MATCH_BADGE[status] || MATCH_BADGE.item_not_matched;
                  const needsFix = !["matched", "pinned", "showroom"].includes(status);
                  return (
                    <tr key={idx} className={`border-t border-gray-50 ${needsFix ? "bg-red-50/40" : ""}`}>
                      <td className="px-3 py-2">
                        <input value={it.itemName || ""} onChange={e => setItem(idx, { itemName: e.target.value, _target: null })}
                          className="w-full font-medium text-gray-900 bg-transparent border-b border-transparent focus:border-violet-300 focus:outline-none" />
                        <input value={it.itemCode || ""} placeholder="code" onChange={e => setItem(idx, { itemCode: e.target.value, _target: null })}
                          className="w-full text-xs text-violet-600 font-mono bg-transparent border-b border-transparent focus:border-violet-300 focus:outline-none" />
                        {it.product ? <p className="text-[11px] text-emerald-600 mt-0.5">✓ Product master: {it.product.code || it.product.name}</p>
                          : <p className="text-[11px] text-amber-600 mt-0.5">⚠ Not in product master</p>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <input value={it.soNumber || ""} onChange={e => setItem(idx, { soNumber: e.target.value, _target: null })}
                          className={`w-24 text-xs font-mono rounded-lg border px-2 py-1 focus:outline-none focus:border-violet-400 ${it.soNumber ? "border-gray-200" : "border-red-200 bg-red-50"}`} />
                      </td>
                      <td className="px-3 py-2 text-center align-top">
                        <input value={it.quantity || ""} onChange={e => setItem(idx, { quantity: e.target.value })}
                          className="w-16 text-xs text-center rounded-lg border border-gray-200 px-1 py-1 focus:outline-none focus:border-violet-400" />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${badge.cls}`}>{badge.label}</span>
                        {(it.match || it._target) && (
                          <p className="text-[11px] text-gray-500 mt-1">→ {(it._target || it.match).itemCode ? `[${(it._target || it.match).itemCode}] ` : ""}{(it._target || it.match).itemName}</p>
                        )}
                        {needsFix && (it.candidates || []).length > 0 && (
                          <select className="mt-1 w-full text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none"
                            value="" onChange={e => {
                              const c = (it.candidates || [])[Number(e.target.value)];
                              if (c) setItem(idx, { _target: { order_id: c.order_id, item_index: c.item_index, itemCode: c.itemCode, itemName: c.itemName }, soNumber: c.so_number });
                            }}>
                            <option value="">Pick order item manually…</option>
                            {(it.candidates || []).map((c, ci) => (
                              <option key={ci} value={ci}>SO {c.so_number} · {c.itemCode ? `[${c.itemCode}] ` : ""}{c.itemName}{c.arrivalDate ? " (arrived)" : ""}{c.suggested ? " ★" : ""}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
          <p className="text-xs text-gray-500">Unmatched items go to DO Review. Matched items stamp today's arrival date on the SO item.</p>
          <button onClick={() => confirmSave(false)} disabled={saving}
            className="bg-violet-600 text-white rounded-xl px-6 py-2.5 text-sm font-semibold hover:bg-violet-700 disabled:opacity-50">
            {saving ? "Saving…" : "✓ Confirm & Save"}
          </button>
        </div>

        {viewPhoto && (
          <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-6" onClick={() => setViewPhoto(null)}>
            <img src={viewPhoto} alt="DO" className="max-h-full max-w-full rounded-xl shadow-2xl" />
          </div>
        )}
      </div>
    );
  }

  // ══ List screen ═════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900">Supplier DOs</h1>
        <label className={`text-sm bg-violet-600 text-white px-4 py-2 rounded-xl font-medium flex items-center gap-2 ${uploading ? "opacity-60 cursor-wait" : "hover:bg-violet-700 cursor-pointer"}`}>
          {uploading ? <><span className="w-3.5 h-3.5 border-2 border-violet-300 border-t-white rounded-full animate-spin" /> Processing…</> : "📤 Upload DO"}
          <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <input value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} placeholder="Supplier name…" className="col-span-2 sm:col-span-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
          <button onClick={loadDOs} className="bg-gray-100 text-gray-700 rounded-xl px-4 py-2 text-sm font-medium hover:bg-gray-200">Refresh</button>
        </div>
      </div>

      {loading ? <div className="space-y-2 py-4">{[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
        : dos.length === 0
          ? <div className="text-center py-16 text-gray-400"><div className="text-4xl mb-3">📦</div><p className="font-medium">No supplier DOs found</p><p className="text-sm mt-1">Upload one above, or snap it in the Telegram DO group</p></div>
          : <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="bg-gray-50 border-b border-gray-100">{["Supplier", "DO #", "DO Date", "Reference", "Status", "Source", "Photo", "Logged"].map(h => <th key={h} className="px-4 py-3 text-left font-semibold text-gray-500 whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {dos.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(d)}>
                      <td className="px-4 py-3 font-semibold text-gray-800">{d.supplier || "-"}</td>
                      <td className="px-4 py-3 text-violet-700 font-medium">{d.do_number || "-"}</td>
                      <td className="px-4 py-3 text-gray-600">{d.do_date ? fmt(d.do_date) : "-"}</td>
                      <td className="px-4 py-3 text-gray-500">{d.supplier_reference || "-"}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full font-medium ${DO_STATUS_STYLE[d.status] || "bg-gray-100 text-gray-600"}`}>{d.status || "-"}</span></td>
                      <td className="px-4 py-3 text-gray-500">{d.source === "telegram" ? "📱 Telegram" : d.source === "webapp" ? "💻 Webapp" : "-"}</td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>{d.photo_url ? <button onClick={() => setViewPhoto(d.photo_url)} className="text-violet-600 hover:underline font-medium">View 📷</button> : <span className="text-gray-300">-</span>}</td>
                      <td className="px-4 py-3 text-gray-400">{d.created_at ? new Date(d.created_at).toLocaleDateString("en-MY") : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>}

      {/* Detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900">DO #{detail.delivery.do_number || "-"}</h2>
                <p className="text-sm text-gray-500">{detail.delivery.supplier} · {detail.delivery.do_date ? fmt(detail.delivery.do_date) : "-"}
                  {detail.delivery.source && <span className="ml-2 text-xs text-gray-400">via {detail.delivery.source}</span>}</p>
              </div>
              <div className="flex items-center gap-2">
                {detail.delivery.photo_url && <button onClick={() => setViewPhoto(detail.delivery.photo_url)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-violet-100">📷 Photo</button>}
                <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                {[["Status", detail.delivery.status], ["Reference", detail.delivery.supplier_reference || "-"], ["Logged", detail.delivery.created_at ? fmt(detail.delivery.created_at) : "-"]].map(([l, v]) => (
                  <div key={l} className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400 mb-0.5">{l}</p><p className="font-semibold">{v}</p></div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-700 mb-2">Items ({(detail.items || []).length})</h3>
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">SO #</th>
                      <th className="px-3 py-2 text-center">Qty</th><th className="px-3 py-2 text-center">Arrival</th><th className="px-3 py-2 text-center">Status</th>
                    </tr></thead>
                    <tbody>
                      {(detail.items || []).length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-xs">No items recorded (older DOs only logged exceptions)</td></tr>}
                      {(detail.items || []).map((it, idx) => (
                        <tr key={it.id || idx} className="border-t border-gray-50">
                          <td className="px-3 py-2">
                            <p className="font-medium text-gray-900">{it.item_name || "-"}</p>
                            {it.item_code && <p className="text-xs text-violet-600 font-mono">{it.item_code}</p>}
                          </td>
                          <td className="px-3 py-2">{it.so_number ? <span className="text-xs font-mono text-violet-700">{it.so_number}</span> : <span className="text-xs text-gray-400">—</span>}</td>
                          <td className="px-3 py-2 text-center text-xs">{it.quantity || "-"}</td>
                          <td className="px-3 py-2 text-center text-xs text-gray-600">{it.arrival_date ? fmt(it.arrival_date) : "—"}</td>
                          <td className="px-3 py-2 text-center">{ITEM_STATUS_BADGE(it)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewPhoto && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-6" onClick={() => setViewPhoto(null)}>
          <img src={viewPhoto} alt="DO" className="max-h-full max-w-full rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  );
}
