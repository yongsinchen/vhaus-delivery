import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast } from "./UIComponents";

// Running notes log on a sales order (vhaus-bot migration 111). Stored apart
// from the order itself, so adding a note never needs an amendment or any
// order-edit permission. The author (or master/manager/company_admin) can
// delete a note; notes aren't editable.

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const MAX_LEN = 4000;
const NOTE_ADMIN_ROLES = ["master", "manager", "company_admin"];

const authHeaders = async () => {
  const { data } = await supabase.auth.getSession();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${data?.session?.access_token || ""}` };
  const cid = localStorage.getItem("pulseActiveCompanyId");
  if (cid) headers["X-Company-ID"] = cid;
  return headers;
};
const readError = async (res, fallback) => (await res.json().catch(() => ({}))).error || fallback;
const fmtWhen = v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : ""; };

export default function OrderNotes({ orderId }) {
  const { user } = useAuth();
  const toast = useToast();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const url = `${API}/sales-orders/${orderId}/notes`;
  const isAdmin = NOTE_ADMIN_ROLES.includes((user?.role || "").toLowerCase());

  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const res = await fetch(url, { headers: await authHeaders() });
      if (!res.ok) throw new Error(await readError(res, "Failed to load notes"));
      const d = await res.json();
      setNotes(Array.isArray(d.notes) ? d.notes : []);
    } catch (e) { setLoadError(e.message); setNotes([]); }
    finally { setLoading(false); }
  }, [url]);

  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    try {
      const res = await fetch(url, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ body }) });
      if (!res.ok) throw new Error(await readError(res, "Failed to add note"));
      const d = await res.json();
      setNotes(prev => [...prev, d.note]);
      setDraft("");
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const deleteNote = async (note) => {
    if (!window.confirm("Delete this note?")) return;
    try {
      const res = await fetch(`${url}/${note.id}`, { method: "DELETE", headers: await authHeaders() });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete note"));
      setNotes(prev => prev.filter(n => n.id !== note.id));
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="border-t border-gray-100 pt-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-bold text-gray-500">NOTES ({notes.length})</p>
        <p className="text-[10px] text-gray-400">Doesn't change the order · no amendment needed</p>
      </div>

      {loading ? (
        <div className="space-y-1.5 animate-pulse">{[1, 2].map(i => <div key={i} className="h-12 bg-gray-50 rounded-xl" />)}</div>
      ) : loadError ? (
        <p className="text-xs text-red-500 mb-2">{loadError} <button onClick={load} className="underline">Retry</button></p>
      ) : notes.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {notes.map(n => (
            <div key={n.id} className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{n.body}</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-[10px] text-gray-400">{[n.created_by_name, fmtWhen(n.created_at)].filter(Boolean).join(" · ")}</p>
                {(n.created_by === user?.id || isAdmin) && (
                  <button onClick={() => deleteNote(n)} className="text-[10px] text-red-400 hover:text-red-600 ml-auto">Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <textarea rows={2} value={draft} maxLength={MAX_LEN} disabled={saving}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); } }}
        placeholder="Add a note…"
        className="w-full text-sm px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:border-violet-400 disabled:bg-gray-50" />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-gray-400">Ctrl+Enter to add</span>
        <button onClick={addNote} disabled={!draft.trim() || saving}
          className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 font-medium disabled:opacity-40">
          {saving ? "Adding…" : "Add Note"}
        </button>
      </div>
    </div>
  );
}
