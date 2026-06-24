import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";

const API = "https://vhaus-bot-production.up.railway.app";

const getToken = async () => {
  let { data } = await supabase.auth.getSession();
  let session = data?.session;
  if (session?.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    session = refreshed?.session || session;
  }
  return session?.access_token || "";
};
const authHeaders = async () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${await getToken()}`,
});

const TABS = ["Company Info", "Branches", "Operations", "Categories"];

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const [tab, setTab] = useState(0);

  // Company settings
  const [settings, setSettings] = useState({
    company_name: "", registration_no: "", address: "", hotline: "", bank_account: "", branches_display: "",
    work_start: "09:00", work_end: "18:00", base_address: "",
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");

  // Branches
  const [branches, setBranches] = useState([]);
  const [branchForm, setBranchForm] = useState({ name: "" });
  const [branchEditId, setBranchEditId] = useState(null);

  // Categories
  const [categories, setCategories] = useState([]);
  const [catForm, setCatForm] = useState({ name: "" });
  const [catEditId, setCatEditId] = useState(null);

  const loadSettings = useCallback(async () => {
    if (!companyId) return;
    const res = await fetch(`${API}/company-settings?company_id=${companyId}`);
    const d = await res.json();
    if (d.settings && d.settings.company_id) {
      setSettings(prev => ({ ...prev, ...d.settings }));
    }
  }, [companyId]);

  const loadBranches = useCallback(async () => {
    if (!companyId) return;
    const res = await fetch(`${API}/branches?company_id=${companyId}`);
    const d = await res.json();
    setBranches(d.branches || []);
  }, [companyId]);

  const loadCategories = useCallback(async () => {
    if (!companyId) return;
    const res = await fetch(`${API}/categories?company_id=${companyId}`);
    const d = await res.json();
    setCategories(d.categories || []);
  }, [companyId]);

  useEffect(() => { loadSettings(); loadBranches(); loadCategories(); }, [loadSettings, loadBranches, loadCategories]);

  // ── Settings save ─────────────────────────────────────────────────
  const saveSettings = async () => {
    setSettingsSaving(true); setSettingsMsg("");
    const headers = await authHeaders();
    const res = await fetch(`${API}/company-settings`, { method: "POST", headers, body: JSON.stringify(settings) });
    setSettingsSaving(false);
    if (res.ok) { setSettingsMsg("Saved"); setTimeout(() => setSettingsMsg(""), 2000); }
    else { const d = await res.json(); setSettingsMsg(d.error || "Failed"); }
  };

  // ── Branch CRUD ───────────────────────────────────────────────────
  const saveBranch = async () => {
    if (!branchForm.name.trim()) return;
    const headers = await authHeaders();
    const url = branchEditId ? `${API}/branches/${branchEditId}` : `${API}/branches`;
    const method = branchEditId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers, body: JSON.stringify(branchForm) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Failed to save branch"); return; }
    setBranchForm({ name: "" }); setBranchEditId(null); loadBranches();
  };

  const deleteBranch = async (id) => {
    if (!window.confirm("Delete this branch?")) return;
    const headers = await authHeaders();
    await fetch(`${API}/branches/${id}`, { method: "DELETE", headers });
    loadBranches();
  };

  // ── Category CRUD ─────────────────────────────────────────────────
  const saveCategory = async () => {
    if (!catForm.name.trim()) return;
    const headers = await authHeaders();
    if (catEditId) {
      await fetch(`${API}/categories/${catEditId}`, { method: "PUT", headers, body: JSON.stringify(catForm) });
    } else {
      await fetch(`${API}/categories`, { method: "POST", headers, body: JSON.stringify(catForm) });
    }
    setCatForm({ name: "" }); setCatEditId(null); loadCategories();
  };

  const deleteCategory = async (id) => {
    if (!window.confirm("Delete this category? Products using it will be unlinked.")) return;
    const headers = await authHeaders();
    await fetch(`${API}/categories/${id}`, { method: "DELETE", headers });
    loadCategories();
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Company Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2 text-sm font-medium rounded-t-xl transition-colors ${tab === i ? "bg-violet-600 text-white" : "text-gray-500 hover:text-violet-700 hover:bg-violet-50"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab: Company Info */}
      {tab === 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4 max-w-2xl">
          <Field label="Company Name" value={settings.company_name || ""} onChange={v => setSettings(s => ({ ...s, company_name: v }))} />
          <Field label="Registration No" value={settings.registration_no || ""} onChange={v => setSettings(s => ({ ...s, registration_no: v }))} placeholder="e.g. 202301043392 (1537308-U)" />
          <Field label="Address" value={settings.address || ""} onChange={v => setSettings(s => ({ ...s, address: v }))} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hotline" value={settings.hotline || ""} onChange={v => setSettings(s => ({ ...s, hotline: v }))} />
            <Field label="Bank Account" value={settings.bank_account || ""} onChange={v => setSettings(s => ({ ...s, bank_account: v }))} placeholder="e.g. CIMB 8011211457" />
          </div>
          <Field label="Branch Contacts (for printed SO header)" value={settings.branches_display || ""} onChange={v => setSettings(s => ({ ...s, branches_display: v }))} placeholder="Georgetown — 014-388 9328 | Alma — 014-388 9328" />
          <div className="flex items-center gap-3">
            <button onClick={saveSettings} disabled={settingsSaving}
              className="px-6 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
              {settingsSaving ? "Saving…" : "Save"}
            </button>
            {settingsMsg && <span className={`text-sm ${settingsMsg === "Saved" ? "text-emerald-600" : "text-red-600"}`}>{settingsMsg}</span>}
          </div>
        </div>
      )}

      {/* Tab: Branches */}
      {tab === 1 && (
        <div className="space-y-4 max-w-lg">
          <div className="flex gap-2">
            <input value={branchForm.name} onChange={e => setBranchForm({ name: e.target.value })} placeholder="Branch name"
              className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400"
              onKeyDown={e => e.key === "Enter" && saveBranch()} />
            <button onClick={saveBranch} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">
              {branchEditId ? "Update" : "Add"}
            </button>
            {branchEditId && <button onClick={() => { setBranchEditId(null); setBranchForm({ name: "" }); }} className="px-3 py-2 rounded-xl text-sm bg-gray-100 text-gray-600">Cancel</button>}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {branches.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">No branches yet</p>}
            {branches.map(b => (
              <div key={b.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-gray-900">{b.name}</span>
                <div className="flex gap-2">
                  <button onClick={() => { setBranchEditId(b.id); setBranchForm({ name: b.name }); }}
                    className="text-xs text-violet-600 hover:underline">Edit</button>
                  <button onClick={() => deleteBranch(b.id)}
                    className="text-xs text-red-500 hover:underline">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Operations */}
      {tab === 2 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4 max-w-2xl">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Work Start</label>
              <input type="time" value={settings.work_start || "09:00"} onChange={e => setSettings(s => ({ ...s, work_start: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Work End</label>
              <input type="time" value={settings.work_end || "18:00"} onChange={e => setSettings(s => ({ ...s, work_end: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
          </div>
          <Field label="Base Warehouse Address" value={settings.base_address || ""} onChange={v => setSettings(s => ({ ...s, base_address: v }))} placeholder="Warehouse address for delivery routing" />
          <div className="flex items-center gap-3">
            <button onClick={saveSettings} disabled={settingsSaving}
              className="px-6 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
              {settingsSaving ? "Saving…" : "Save"}
            </button>
            {settingsMsg && <span className={`text-sm ${settingsMsg === "Saved" ? "text-emerald-600" : "text-red-600"}`}>{settingsMsg}</span>}
          </div>
        </div>
      )}

      {/* Tab: Categories */}
      {tab === 3 && (
        <div className="space-y-4 max-w-lg">
          <div className="flex gap-2">
            <input value={catForm.name} onChange={e => setCatForm({ name: e.target.value })} placeholder="Category name"
              className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400"
              onKeyDown={e => e.key === "Enter" && saveCategory()} />
            <button onClick={saveCategory} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">
              {catEditId ? "Update" : "Add"}
            </button>
            {catEditId && <button onClick={() => { setCatEditId(null); setCatForm({ name: "" }); }} className="px-3 py-2 rounded-xl text-sm bg-gray-100 text-gray-600">Cancel</button>}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {categories.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">No categories yet</p>}
            {categories.map(c => (
              <div key={c.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm font-medium text-gray-900">{c.name}</span>
                <div className="flex gap-2">
                  <button onClick={() => { setCatEditId(c.id); setCatForm({ name: c.name }); }}
                    className="text-xs text-violet-600 hover:underline">Edit</button>
                  <button onClick={() => deleteCategory(c.id)}
                    className="text-xs text-red-500 hover:underline">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
    </div>
  );
}
