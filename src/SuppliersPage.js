import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";

const API = "https://vhaus-bot-production.up.railway.app";

const getToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || "";
};

const authHeaders = async () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${await getToken()}`,
});

const EMPTY = { name: "", code: "", contact: "", cost_divisor: "", color_mode: "combined" };

export default function SuppliersPage() {
  const { user } = useAuth();
  const companyId = user?.company_id;

  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const token = await getToken();
    const res = await fetch(`${API}/suppliers?company_id=${companyId}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json();
    setSuppliers(d.suppliers || []);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditId(null); setForm(EMPTY); setError(""); setDrawerOpen(true); };
  const openEdit = (s) => {
    setEditId(s.id);
    setForm({
      name: s.name || "", code: s.code || "", contact: s.contact || "",
      cost_divisor: s.cost_divisor != null ? String(s.cost_divisor) : "",
      color_mode: s.color_mode === "split" ? "split" : "combined",
    });
    setError("");
    setDrawerOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError("");
    const headers = await authHeaders();
    const body = {
      name: form.name.trim(), code: form.code.trim() || null, contact: form.contact.trim() || null,
      cost_divisor: form.cost_divisor === "" ? null : Number(form.cost_divisor),
      color_mode: form.color_mode,
    };
    const url = editId ? `${API}/suppliers/${editId}` : `${API}/suppliers`;
    const method = editId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
    const d = await res.json();
    setSaving(false);
    if (!res.ok) { setError(d.error || "Failed to save"); return; }
    setDrawerOpen(false);
    load();
  };

  const remove = async (s) => {
    setDeletingId(s.id);
    const headers = await authHeaders();
    let res = await fetch(`${API}/suppliers/${s.id}`, { method: "DELETE", headers });
    if (res.status === 409) {
      const d = await res.json();
      const ok = window.confirm(`"${s.name}" is used by ${d.product_count} product(s). Deleting will remove this supplier from those products. Continue?`);
      if (!ok) { setDeletingId(null); return; }
      res = await fetch(`${API}/suppliers/${s.id}?force=true`, { method: "DELETE", headers });
    }
    setDeletingId(null);
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); alert(d.error || "Failed to delete"); }
  };

  const filtered = suppliers.filter(s =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.code?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500">{suppliers.length} supplier{suppliers.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={openAdd} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors">
          + Add Supplier
        </button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or code…"
        className="px-3 py-2 rounded-xl border border-gray-200 text-sm w-64 focus:outline-none focus:border-violet-400" />

      <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3 hidden sm:table-cell">Code</th>
              <th className="px-4 py-3 hidden md:table-cell">Contact</th>
              <th className="px-4 py-3">Cost Rule</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No suppliers found</td></tr>}
            {!loading && filtered.map(s => (
              <tr key={s.id} className="border-b border-gray-50 hover:bg-violet-50/30 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900 cursor-pointer" onClick={() => openEdit(s)}>{s.name}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs hidden sm:table-cell">{s.code || "—"}</td>
                <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{s.contact || "—"}</td>
                <td className="px-4 py-3">
                  {s.cost_divisor > 0
                    ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">Price ÷ {s.cost_divisor}</span>
                    : <span className="text-gray-400 text-xs">Catalogue cost</span>}
                  {s.color_mode === "split" && <span className="inline-block ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Split colours</span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => openEdit(s)} className="text-xs text-gray-500 hover:text-violet-600 transition-colors mr-3">Edit</button>
                  <button onClick={() => remove(s)} disabled={deletingId === s.id}
                    className="text-xs text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50">
                    {deletingId === s.id ? "Deleting…" : "Delete"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-gray-900">{editId ? "Edit Supplier" : "Add Supplier"}</h2>
              <button onClick={() => setDrawerOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-xl">{error}</div>}

              <SField label="Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Supplier name" />
              <SField label="Code" value={form.code} onChange={v => setForm(f => ({ ...f, code: v }))} placeholder="Optional" />
              <SField label="Contact" value={form.contact} onChange={v => setForm(f => ({ ...f, contact: v }))} placeholder="Phone / email / person" />

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Cost divisor</label>
                <input type="number" min="0" step="any" value={form.cost_divisor}
                  onChange={e => setForm(f => ({ ...f, cost_divisor: e.target.value }))} placeholder="blank = use catalogue cost"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-right focus:outline-none focus:border-violet-400" />
                <p className="text-xs text-gray-400 mt-1">
                  {Number(form.cost_divisor) > 0
                    ? `Catalogue import will set cost = price ÷ ${Number(form.cost_divisor)} (e.g. 2000 → ${(2000 / Number(form.cost_divisor)).toFixed(2)}).`
                    : "Leave blank to use the cost printed in the catalogue."}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Colour in catalogue</label>
                <select value={form.color_mode} onChange={e => setForm(f => ({ ...f, color_mode: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                  <option value="combined">One combined colour (e.g. "Natural/White" = one two-tone product)</option>
                  <option value="split">Separate variants (e.g. "Natural / Walnut" = two colour options)</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  {form.color_mode === "split"
                    ? "On import, a slash-separated colour is split into one product per colour."
                    : "On import, a slash-separated colour is kept as a single colour value."}
                </p>
              </div>

              <button onClick={save} disabled={saving}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editId ? "Update Supplier" : "Create Supplier"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
    </div>
  );
}
