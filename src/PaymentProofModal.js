// Edit / add a payment's PROOF — proof only. Saves through PATCH /payments/:id/proof, which never touches the amount, date, method,
// allocation, the order balance, commission or the approval status (the full Amend flow is still there for those).
//   pending  → replace / add / remove; the payment stays pending and Finance reviews the latest proof. Superseded proofs stay on record.
//   approved → supplementary proofs only (existing evidence is read-only).
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./AuthContext";
import { useToast, formatMoney } from "./UIComponents";
import { proofList } from "./paymentProofPolicy";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); const cid = localStorage.getItem("pulseActiveCompanyId"); return fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(cid ? { "X-Company-ID": cid } : {}) } }); };
const isPdf = u => /\.pdf(\?|$)/i.test(u);
const fileName = u => decodeURIComponent(String(u).split("/").pop() || u);

export default function PaymentProofModal({ payment, mode, onClose, onSaved }) {
  const toast = useToast();
  const original = proofList(payment);
  const [proofs, setProofs] = useState(original);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);            // synchronous double-click guard
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const append = mode === "append";

  useEffect(() => {
    let alive = true;
    af(`${API}/payments/${payment.id}/proof-history`).then(r => r.json()).then(d => { if (alive) setHistory(d.history || []); }).catch(() => {});
    return () => { alive = false; };
  }, [payment.id]);

  const changed = proofs.join(",") !== original.join(",");
  const superseded = original.filter(u => !proofs.includes(u));
  const removable = (u) => !append || !original.includes(u);   // approved evidence is read-only; only this session's new uploads can be dropped

  const upload = async (file) => {
    setUploading(true);
    try {
      const token = await getToken();
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`${API}/sales-orders/upload-attachment`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      const d = await res.json();
      if (d.url) setProofs(prev => [...prev, d.url]); else toast.error(d.error || "Upload failed");
    } catch { toast.error("Upload failed"); }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      const res = await af(`${API}/payments/${payment.id}/proof`, { method: "PATCH", body: JSON.stringify({ proof_url: proofs.join(", ") }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "Could not update the proof"); return; }
      if (d.audit_warning) toast.warning(d.audit_warning);
      toast.success(append ? "Supplementary proof added" : "Payment proof updated — still pending Finance approval");
      onSaved?.();
    } catch { toast.error("Could not update the proof"); }
    finally { savingRef.current = false; setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" data-testid="proof-modal">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-gray-900">{append ? "Add supplementary proof" : "Edit payment proof"}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{payment.or_number != null ? `OR #${payment.or_number} · ` : ""}RM {formatMoney(payment.amount)} · {payment.payment_method} · {append ? "Approved" : "Pending approval"}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
        </div>

        <div className={`text-xs rounded-xl p-3 ${append ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-violet-50 text-violet-800 border border-violet-100"}`} data-testid="proof-rule">
          {append
            ? "This payment is already approved. Existing proofs cannot be replaced or removed — you can only add a supplementary proof. Nothing else about the payment changes."
            : "Only the proof changes — amount, date, method and allocation stay as they are, and the payment stays Pending approval so Finance reviews the latest proof. A replaced proof is kept on record."}
        </div>

        <div className="space-y-2">
          {proofs.map((u, i) => (
            <div key={u} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2 py-1.5" data-testid="proof-row">
              <button type="button" onClick={() => setPreview(u)} title="Preview" className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-white border border-gray-200 flex items-center justify-center text-xs text-gray-400">
                {isPdf(u) ? "PDF" : <img src={u} alt={`Proof ${i + 1}`} className="w-full h-full object-cover" onError={e => { e.target.style.display = "none"; }} />}
              </button>
              <div className="flex-1 min-w-0">
                <button type="button" onClick={() => setPreview(u)} className="text-xs text-violet-600 underline truncate block max-w-full text-left">Proof {i + 1} · {fileName(u)}</button>
                <div className="flex gap-1 mt-0.5">
                  {i === proofs.length - 1 && proofs.length > 0 && <span className="text-[10px] font-semibold px-1.5 rounded-full bg-emerald-100 text-emerald-700" data-testid="latest-badge">Latest</span>}
                  {!original.includes(u) && <span className="text-[10px] font-semibold px-1.5 rounded-full bg-blue-100 text-blue-700">New — not saved yet</span>}
                  {original.includes(u) && append && <span className="text-[10px] px-1.5 rounded-full bg-gray-200 text-gray-500">Approved evidence</span>}
                </div>
              </div>
              {removable(u) && proofs.length > 1 && (
                <button type="button" onClick={() => setProofs(prev => prev.filter(x => x !== u))} title="Remove" className="text-red-400 hover:text-red-600 text-sm px-1">✕</button>
              )}
            </div>
          ))}
        </div>

        <label className={`flex items-center gap-2 text-xs cursor-pointer ${uploading ? "text-gray-400" : "text-violet-600 hover:text-violet-800"}`}>
          <span>{uploading ? "Uploading…" : append ? "+ Add a supplementary receipt / screenshot" : "+ Upload a new receipt / screenshot"}</span>
          <input type="file" accept="image/*,application/pdf" className="hidden" disabled={uploading} data-testid="proof-file"
            onChange={async e => { const f = e.target.files?.[0]; if (f) await upload(f); e.target.value = ""; }} />
        </label>

        {superseded.length > 0 && (
          <p className="text-xs text-amber-700" data-testid="superseded-note">{superseded.length} proof{superseded.length > 1 ? "s" : ""} will be taken off this payment and kept on record as superseded.</p>
        )}

        {history.length > 0 && (
          <details className="text-xs text-gray-500" data-testid="proof-history">
            <summary className="cursor-pointer font-medium">Proof history ({history.length})</summary>
            <ul className="mt-1 space-y-1">
              {history.map(h => (
                <li key={h.id} className="bg-gray-50 rounded-lg p-2">
                  {new Date(h.at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })} · {h.by_name || "—"} ({h.status_at_time})
                  {h.added.length > 0 && <span> · added {h.added.length}</span>}
                  {h.superseded.map(u => <button key={u} type="button" onClick={() => setPreview(u)} className="ml-2 text-violet-600 underline">superseded: {fileName(u)}</button>)}
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">Cancel</button>
          <button onClick={save} disabled={saving || uploading || !changed || proofs.length === 0}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">{saving ? "Saving…" : "Save proof"}</button>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[80] p-4" onClick={() => setPreview(null)} data-testid="proof-preview">
          <button onClick={() => setPreview(null)} className="absolute top-4 right-5 text-white/80 hover:text-white text-4xl leading-none">×</button>
          {isPdf(preview) ? <iframe title="Payment proof" src={preview} className="w-full h-full max-w-4xl bg-white rounded-lg" onClick={e => e.stopPropagation()} />
            : <img src={preview} alt="Payment proof" className="max-w-full max-h-full object-contain rounded-lg" onClick={e => e.stopPropagation()} />}
        </div>
      )}
    </div>
  );
}
