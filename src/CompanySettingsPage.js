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

const TABS = ["Company Info", "Branches", "Warehouses", "Operations", "Categories", "Options Library"];

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const [tab, setTab] = useState(0);

  // Company settings
  const [settings, setSettings] = useState({
    company_name: "", registration_no: "", address: "", hotline: "", bank_account: "", branches_display: "",
    work_start: "09:00", work_end: "18:00", base_address: "",
    countries: "[]",
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");

  // Branches
  const [branches, setBranches] = useState([]);
  const [branchForm, setBranchForm] = useState({ name: "" });
  const [branchEditId, setBranchEditId] = useState(null);

  // Warehouses
  const [whouses, setWhouses] = useState([]);
  const [whForm, setWhForm] = useState({ name: "", type: "warehouse", address: "", pic: "", contact: "" });
  const [whEditId, setWhEditId] = useState(null);

  // Categories
  const [categories, setCategories] = useState([]);
  const [catForm, setCatForm] = useState({ name: "" });
  const [catEditId, setCatEditId] = useState(null);

  // Options Library
  const [specOptions, setSpecOptions] = useState([]);
  const [pendingOptions, setPendingOptions] = useState([]);
  const [newOptLabel, setNewOptLabel] = useState("");
  const [newOptValue, setNewOptValue] = useState("");

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

  const loadWarehouses = useCallback(async () => {
    if (!companyId) return;
    const res = await fetch(`${API}/warehouses?company_id=${companyId}`);
    const d = await res.json();
    setWhouses(d.warehouses || []);
  }, [companyId]);

  const loadSpecOptions = useCallback(async () => {
    if (!companyId) return;
    const [allRes, pendRes] = await Promise.all([
      fetch(`${API}/spec-options?company_id=${companyId}`),
      fetch(`${API}/spec-options/pending?company_id=${companyId}`),
    ]);
    const allD = await allRes.json();
    const pendD = await pendRes.json();
    setSpecOptions((allD.options || []).filter(o => o.is_approved));
    setPendingOptions(pendD.options || []);
  }, [companyId]);

  useEffect(() => { loadSettings(); loadBranches(); loadWarehouses(); loadCategories(); loadSpecOptions(); }, [loadSettings, loadBranches, loadWarehouses, loadCategories, loadSpecOptions]);

  const saveWarehouse = async () => {
    if (!whForm.name.trim()) return;
    const headers = await authHeaders();
    const url = whEditId ? `${API}/warehouses/${whEditId}` : `${API}/warehouses`;
    const method = whEditId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers, body: JSON.stringify(whForm) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || "Failed"); return; }
    setWhForm({ name: "", type: "warehouse", address: "" }); setWhEditId(null); loadWarehouses();
  };

  const deleteWarehouse = async (id) => {
    if (!window.confirm("Deactivate this location?")) return;
    const headers = await authHeaders();
    await fetch(`${API}/warehouses/${id}`, { method: "DELETE", headers });
    loadWarehouses();
  };

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

      {/* Tab: Warehouses */}
      {tab === 2 && (
        <div className="space-y-4 max-w-lg">
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={whForm.name} onChange={e => setWhForm(f => ({ ...f, name: e.target.value }))} placeholder="Location name"
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              <select value={whForm.type} onChange={e => setWhForm(f => ({ ...f, type: e.target.value }))}
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                <option value="warehouse">Warehouse</option>
                <option value="showroom">Showroom</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={whForm.pic} onChange={e => setWhForm(f => ({ ...f, pic: e.target.value }))} placeholder="Person In Charge"
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
              <input value={whForm.contact} onChange={e => setWhForm(f => ({ ...f, contact: e.target.value }))} placeholder="Contact number"
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
            <input value={whForm.address} onChange={e => setWhForm(f => ({ ...f, address: e.target.value }))} placeholder="Address"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            <div className="flex gap-2">
              <button onClick={saveWarehouse} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">
                {whEditId ? "Update" : "Add"}
              </button>
              {whEditId && <button onClick={() => { setWhEditId(null); setWhForm({ name: "", type: "warehouse", address: "", pic: "", contact: "" }); }} className="px-3 py-2 rounded-xl text-sm bg-gray-100 text-gray-600">Cancel</button>}
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {whouses.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">No locations yet</p>}
            {whouses.map(w => (
              <div key={w.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm font-medium text-gray-900">{w.name}</span>
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${w.type === "showroom" ? "bg-violet-100 text-violet-700" : "bg-gray-100 text-gray-600"}`}>{w.type}</span>
                  {w.pic && <p className="text-xs text-gray-500 mt-0.5">PIC: {w.pic} {w.contact ? `· ${w.contact}` : ""}</p>}
                  {w.address && <p className="text-xs text-gray-400">{w.address}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setWhEditId(w.id); setWhForm({ name: w.name, type: w.type, address: w.address || "", pic: w.pic || "", contact: w.contact || "" }); }}
                    className="text-xs text-violet-600 hover:underline">Edit</button>
                  <button onClick={() => deleteWarehouse(w.id)}
                    className="text-xs text-red-500 hover:underline">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Operations */}
      {tab === 3 && (
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

          {/* Countries & GST */}
          <div className="border-t border-gray-100 pt-4 mt-4">
            <h4 className="text-sm font-bold text-gray-700 mb-2">Countries & GST Rates</h4>
            <p className="text-xs text-gray-400 mb-3">Configure countries your salesmen sell to. GST is auto-calculated on sales orders.</p>
            <div className="space-y-2">
              {(() => {
                let list = [];
                try { list = JSON.parse(settings.countries || "[]"); } catch {}
                if (!Array.isArray(list)) list = [];
                const update = (newList) => setSettings(s => ({ ...s, countries: JSON.stringify(newList) }));
                return (
                  <>
                    {list.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={c.code || ""} onChange={e => { const n = [...list]; n[i] = { ...n[i], code: e.target.value.toUpperCase() }; update(n); }}
                          placeholder="MY" className="w-16 px-2 py-1.5 rounded-lg border border-gray-200 text-xs text-center focus:outline-none focus:border-violet-400" />
                        <input value={c.name || ""} onChange={e => { const n = [...list]; n[i] = { ...n[i], name: e.target.value }; update(n); }}
                          placeholder="Malaysia" className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:border-violet-400" />
                        <div className="flex items-center gap-1">
                          <input type="number" value={c.gst_rate ?? ""} onChange={e => { const n = [...list]; n[i] = { ...n[i], gst_rate: e.target.value === "" ? 0 : Number(e.target.value) }; update(n); }}
                            placeholder="0" className="w-16 px-2 py-1.5 rounded-lg border border-gray-200 text-xs text-right focus:outline-none focus:border-violet-400" />
                          <span className="text-xs text-gray-400">%</span>
                        </div>
                        <button type="button" onClick={() => update(list.filter((_, j) => j !== i))} className="text-xs text-red-400 hover:text-red-600">×</button>
                      </div>
                    ))}
                    <button type="button" onClick={() => update([...list, { code: "", name: "", gst_rate: 0 }])}
                      className="text-xs px-3 py-1.5 rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200">+ Add Country</button>
                  </>
                );
              })()}
            </div>
          </div>

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
      {tab === 4 && (
        <div className="space-y-4 max-w-2xl">
          <div className="flex gap-2">
            <input value={catForm.name} onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))} placeholder="Category name"
              className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400"
              onKeyDown={e => e.key === "Enter" && saveCategory()} />
            <button onClick={saveCategory} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">
              {catEditId ? "Update" : "Add"}
            </button>
            {catEditId && <button onClick={() => { setCatEditId(null); setCatForm({ name: "" }); }} className="px-3 py-2 rounded-xl text-sm bg-gray-100 text-gray-600">Cancel</button>}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {categories.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">No categories yet</p>}
            {categories.map(c => {
              let specs = [];
              try { specs = JSON.parse(c.spec_labels || "[]"); } catch {}
              if (!Array.isArray(specs)) specs = [];
              return (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{c.name}</span>
                    <div className="flex gap-2">
                      <button onClick={() => { setCatEditId(c.id); setCatForm({ name: c.name }); }}
                        className="text-xs text-violet-600 hover:underline">Edit Name</button>
                      <button onClick={() => deleteCategory(c.id)}
                        className="text-xs text-red-500 hover:underline">Delete</button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <p className="text-xs text-gray-400 mb-1">Customization Specs (shown when ordering customizable products in this category)</p>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {specs.map((s, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs">
                          {s}
                          <button type="button" onClick={async () => {
                            const next = specs.filter((_, j) => j !== i);
                            const headers = await authHeaders();
                            await fetch(`${API}/categories/${c.id}`, { method: "PUT", headers, body: JSON.stringify({ name: c.name, spec_labels: JSON.stringify(next) }) });
                            loadCategories();
                          }} className="text-amber-400 hover:text-amber-700">×</button>
                        </span>
                      ))}
                    </div>
                    <form onSubmit={async e => {
                      e.preventDefault();
                      const input = e.target.elements.newspec;
                      const val = input.value.trim();
                      if (!val) return;
                      const next = [...specs, val];
                      const headers = await authHeaders();
                      await fetch(`${API}/categories/${c.id}`, { method: "PUT", headers, body: JSON.stringify({ name: c.name, spec_labels: JSON.stringify(next) }) });
                      input.value = "";
                      loadCategories();
                    }} className="flex gap-1">
                      <input name="newspec" placeholder="+ Add spec label (e.g. Fabric Color)" className="flex-1 px-2 py-1 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400" />
                      <button type="submit" className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">Add</button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab: Options Library */}
      {tab === 5 && (
        <div className="space-y-4 max-w-2xl">
          {/* Pending review */}
          {pendingOptions.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
              <h3 className="text-sm font-bold text-amber-800">Pending Review ({pendingOptions.length})</h3>
              <p className="text-xs text-amber-600">These values were added by salesmen and need approval.</p>
              {pendingOptions.map(o => (
                <div key={o.id} className="flex items-center justify-between bg-white rounded-xl px-3 py-2 border border-amber-100">
                  <div>
                    <span className="text-xs text-gray-500">{o.label}:</span>
                    <span className="text-sm font-medium text-gray-900 ml-1">{o.value}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={async () => {
                      const headers = await authHeaders();
                      await fetch(`${API}/spec-options/${o.id}/approve`, { method: "PATCH", headers });
                      loadSpecOptions();
                    }} className="text-xs px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200">Approve</button>
                    <button onClick={async () => {
                      const headers = await authHeaders();
                      await fetch(`${API}/spec-options/${o.id}`, { method: "DELETE", headers });
                      loadSpecOptions();
                    }} className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add new option */}
          <div className="flex gap-2">
            <input value={newOptLabel} onChange={e => setNewOptLabel(e.target.value)} placeholder="Label (e.g. Fabric Color)"
              className="w-40 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            <input value={newOptValue} onChange={e => setNewOptValue(e.target.value)} placeholder="Value (e.g. Lamboo 03)"
              className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400"
              onKeyDown={async e => {
                if (e.key !== "Enter" || !newOptLabel.trim() || !newOptValue.trim()) return;
                const headers = await authHeaders();
                await fetch(`${API}/spec-options`, { method: "POST", headers, body: JSON.stringify({ label: newOptLabel.trim(), value: newOptValue.trim(), is_approved: true }) });
                setNewOptValue("");
                loadSpecOptions();
              }} />
            <button onClick={async () => {
              if (!newOptLabel.trim() || !newOptValue.trim()) return;
              const headers = await authHeaders();
              await fetch(`${API}/spec-options`, { method: "POST", headers, body: JSON.stringify({ label: newOptLabel.trim(), value: newOptValue.trim(), is_approved: true }) });
              setNewOptValue("");
              loadSpecOptions();
            }} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">Add</button>
          </div>

          {/* Grouped options */}
          {(() => {
            const grouped = {};
            specOptions.forEach(o => { if (!grouped[o.label]) grouped[o.label] = []; grouped[o.label].push(o); });
            return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([label, opts]) => (
              <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <h4 className="text-sm font-bold text-gray-700 mb-2">{label} <span className="text-xs font-normal text-gray-400">({opts.length})</span></h4>
                <div className="flex flex-wrap gap-1">
                  {opts.map(o => (
                    <span key={o.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full text-xs">
                      {o.value}
                      <button type="button" onClick={async () => {
                        const headers = await authHeaders();
                        await fetch(`${API}/spec-options/${o.id}`, { method: "DELETE", headers });
                        loadSpecOptions();
                      }} className="text-violet-300 hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
              </div>
            ));
          })()}
          {specOptions.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No options yet. Add labels and values above.</p>}
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
