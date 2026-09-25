// Amend / Delete buttons for the requester's own OPEN delivery-date request
// (pending / needs_reschedule). Shared by the Delivery Date Requests page and
// the Orders page SO view. The server re-checks ownership + open status and
// re-runs the 10-day auto-approval rule on an amended date.
import React, { useState } from "react";
import { supabase } from "./AuthContext";
import { useToast } from "./UIComponents";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => {
  const token = await getToken();
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } });
};
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export const canChangeRequest = (r, user) =>
  !!r && !!user?.id && r.requested_by === user.id && (r.status === "pending" || r.status === "needs_reschedule");

// Delete (withdraw) an open request after confirming. Returns true on success.
export async function deleteDeliveryDateRequest(r, toast) {
  if (!window.confirm(`Delete this delivery date request for SO ${r.so_number}?${r.link_group_id ? "\n\nThis is a linked delivery — the linked SOs' requests are deleted too." : ""}`)) return false;
  try {
    const res = await af(`${API}/delivery-date-requests/${r.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Failed to delete request");
    toast.success("Request deleted");
    return true;
  } catch (e) { toast.error(e.message); return false; }
}

// Amend dialog. Host it in a component that stays mounted while it's open.
export function AmendDeliveryDateRequestModal({ request: r, onClose, onSaved }) {
  const toast = useToast();
  const [date, setDate] = useState(r.requested_date || "");
  const [remark, setRemark] = useState(r.remark || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!date) { toast.warning("Choose a delivery date"); return; }
    setBusy(true);
    try {
      const res = await af(`${API}/delivery-date-requests/${r.id}`, { method: "PATCH", body: JSON.stringify({ requested_date: date, remark }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed to amend request");
      toast.success(d.request?.status === "approved" ? "Amended — auto-approved (10+ days out)" : "Request amended — sent for approval again");
      onSaved?.();
    } catch (e) { toast.error(e.message); setBusy(false); }
  };

  return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4" onClick={() => !busy && onClose()}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900">Amend request · SO {r.so_number}{r.delivery_orders?.do_number ? ` · ${r.delivery_orders.do_number}` : ""}</h3>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {r.link_group_id && (
                <p className="text-xs text-teal-700 bg-teal-50 rounded-lg px-3 py-2">🔗 Linked delivery — the new date and remark apply to every linked SO.</p>
              )}
              {r.status === "needs_reschedule" && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">The reviewer proposed other dates. Amending sends your new date for review instead.</p>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Delivery date</label>
                <input type="date" min={localToday()} value={date} onChange={e => setDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Remark <span className="text-gray-400">(reason / notes for the reviewer)</span></label>
                <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
                <button onClick={save} disabled={busy || !date}
                  className="px-5 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">{busy ? "Saving…" : "Save changes"}</button>
              </div>
            </div>
          </div>
        </div>
  );
}

// ✏️ Amend / 🗑 Delete buttons. Pass onAmend to host the dialog yourself
// (needed when this sits inside a component that remounts on every render);
// otherwise the dialog lives here.
export default function DeliveryDateRequestActions({ request: r, onChanged, onAmend }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    const ok = await deleteDeliveryDateRequest(r, toast);
    setBusy(false);
    if (ok) onChanged?.();
  };

  return (
    <>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => (onAmend ? onAmend(r) : setEditing(true))} disabled={busy}
          className="px-2.5 py-1 rounded-lg text-xs font-medium border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50">✏️ Amend</button>
        <button type="button" onClick={remove} disabled={busy}
          className="px-2.5 py-1 rounded-lg text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">🗑 Delete</button>
      </div>
      {editing && (
        <AmendDeliveryDateRequestModal request={r} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged?.(); }} />
      )}
    </>
  );
}
