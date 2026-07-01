import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";

const API = "https://vhaus-bot-production.up.railway.app";

const getToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || "";
};

const authHeaders = async () => {
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return { "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}`, ...(cid && { "X-Company-ID": cid }) };
};

const EMPTY = { name: "", code: "", contact: "", cost_divisor: "", color_mode: "combined" };

export default function SuppliersPage() {
  const { user, activeCompanyId } = useAuth();
  const companyId = activeCompanyId || user?.company_id;

  // Company-level rows — kept for cross-referencing cost_divisor / color_mode
  const [suppliers, setSuppliers] = useState([]);
  // Org master rows — used as the display list for catalogue-group companies
  const [orgSuppliers, setOrgSuppliers] = useState([]);
  const [isCatalogueGroup, setIsCatalogueGroup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState(null);          // company suppliers row id being edited
  const [editOrgId, setEditOrgId] = useState(null);    // org supplier id the edit is linked to
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  // Linked-companies drawer
  const [linksOpen, setLinksOpen] = useState(false);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksData, setLinksData] = useState(null);

  // Search-first creation (catalogue-group companies only)
  const [orgSupStep, setOrgSupStep] = useState("form");
  const [orgSupQuery, setOrgSupQuery] = useState("");
  const [orgSupResults, setOrgSupResults] = useState([]);
  const [orgSupSearching, setOrgSupSearching] = useState(false);
  const [selectedOrgSupplierId, setSelectedOrgSupplierId] = useState(null);
  const [selectedOrgSupplierLabel, setSelectedOrgSupplierLabel] = useState("");

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}` };
    const cid = localStorage.getItem("pulseActiveCompanyId");
    if (cid) headers["X-Company-ID"] = cid;
    const [supRes, orgRes] = await Promise.all([
      fetch(`${API}/suppliers?company_id=${companyId}`, { headers }),
      fetch(`${API}/organization-suppliers`, { headers }),
    ]);
    const supData = await supRes.json();
    const orgData = await orgRes.json();
    setSuppliers(supData.suppliers || []);
    setOrgSuppliers(orgData.organizationSuppliers || []);
    setIsCatalogueGroup(!!orgData.isCatalogueGroup);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  // Build a map: organization_supplier_id → company suppliers row
  // Used to pull cost_divisor / color_mode for the merged list edit flow
  const companyRowByOrgId = {};
  for (const s of suppliers) {
    if (s.organization_supplier_id) companyRowByOrgId[s.organization_supplier_id] = s;
  }

  const openLinks = async (orgSupplierId) => {
    setLinksOpen(true);
    setLinksLoading(true);
    setLinksData(null);
    const headers = await authHeaders();
    const res = await fetch(`${API}/organization-suppliers/${orgSupplierId}/companies`, { headers });
    const d = await res.json();
    setLinksData(d);
    setLinksLoading(false);
  };

  const searchOrgSuppliers = async (q) => {
    setOrgSupQuery(q);
    if (!q.trim()) { setOrgSupResults([]); return; }
    setOrgSupSearching(true);
    const headers = await authHeaders();
    const res = await fetch(`${API}/organization-suppliers/search?q=${encodeURIComponent(q.trim())}`, { headers });
    const d = await res.json();
    setOrgSupResults(d.suppliers || []);
    setOrgSupSearching(false);
  };

  const pickOrgSupplier = (s) => {
    setSelectedOrgSupplierId(s.id);
    setSelectedOrgSupplierLabel(s.name);
    setForm(f => ({ ...f, name: s.name || "" }));
    setOrgSupStep("form");
  };

  const createSupplierAsNew = () => {
    setSelectedOrgSupplierId(null);
    setSelectedOrgSupplierLabel("");
    setOrgSupStep("form");
  };

  const openAdd = () => {
    setEditId(null);
    setEditOrgId(null);
    setForm(EMPTY);
    setError("");
    setSelectedOrgSupplierId(null);
    setSelectedOrgSupplierLabel("");
    setOrgSupQuery("");
    setOrgSupResults([]);
    setOrgSupStep(isCatalogueGroup ? "pick" : "form");
    setDrawerOpen(true);
  };

  // openEdit accepts either a company suppliers row (legacy list)
  // or an org master row (merged catalogue-group list).
  const openEdit = (s, orgSup = null) => {
    if (orgSup) {
      // Editing from merged list: s is the company row (may be null if not yet in this company)
      const compRow = s || {};
      setEditId(compRow.id || null);
      setEditOrgId(orgSup.id);
      setForm({
        name: orgSup.name || "",
        code: orgSup.code || "",
        contact: orgSup.contact || compRow.contact || "",
        cost_divisor: compRow.cost_divisor != null ? String(compRow.cost_divisor) : "",
        color_mode: compRow.color_mode === "split" ? "split" : "combined",
      });
    } else {
      setEditId(s.id);
      setEditOrgId(s.organization_supplier_id || null);
      setForm({
        name: s.name || "", code: s.code || "", contact: s.contact || "",
        cost_divisor: s.cost_divisor != null ? String(s.cost_divisor) : "",
        color_mode: s.color_mode === "split" ? "split" : "combined",
      });
    }
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
      ...(selectedOrgSupplierId && !editId ? { organization_supplier_id: selectedOrgSupplierId } : {}),
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

  // For catalogue-group companies: show org masters as the merged list
  const filteredOrg = orgSuppliers.filter(s =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.code?.toLowerCase().includes(search.toLowerCase()));
  // For non-catalogue-group companies: show company-specific rows
  const filteredCompany = suppliers.filter(s =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.code?.toLowerCase().includes(search.toLowerCase()));

  const displayList = isCatalogueGroup ? filteredOrg : filteredCompany;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500">
            {isCatalogueGroup
              ? `${orgSuppliers.length} supplier${orgSuppliers.length !== 1 ? "s" : ""} · shared catalogue`
              : `${suppliers.length} supplier${suppliers.length !== 1 ? "s" : ""}`}
          </p>
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
              {!isCatalogueGroup && <th className="px-4 py-3 hidden lg:table-cell">Scope</th>}
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && [1,2,3,4].map(i=><tr key={i} className="animate-pulse"><td className="px-4 py-3"><div className="h-3 bg-gray-200 rounded w-24" /></td><td className="px-4 py-3"><div className="h-3 bg-gray-200 rounded w-16" /></td><td className="px-4 py-3"><div className="h-3 bg-gray-100 rounded w-20" /></td><td className="px-4 py-3"><div className="h-3 bg-gray-100 rounded w-12" /></td><td className="px-4 py-3"><div className="h-3 bg-gray-100 rounded w-16" /></td></tr>)}
            {!loading && displayList.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No suppliers found</td></tr>}

            {!loading && isCatalogueGroup && filteredOrg.map(os => {
              // Find this company's own row for the cost rule / color mode
              const compRow = companyRowByOrgId[os.id] || null;
              return (
                <tr key={os.id} className="border-b border-gray-50 hover:bg-violet-50/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 cursor-pointer" onClick={() => openEdit(compRow, os)}>{os.name}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs hidden sm:table-cell">{os.code || "—"}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{os.contact || "—"}</td>
                  <td className="px-4 py-3">
                    {compRow?.cost_divisor > 0
                      ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">Price ÷ {compRow.cost_divisor}</span>
                      : <span className="text-gray-400 text-xs">Catalogue cost</span>}
                    {compRow?.color_mode === "split" && <span className="inline-block ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Split colours</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openLinks(os.id)} className="text-xs text-gray-400 hover:text-violet-600 transition-colors mr-3">
                      {os.companyCount ?? 0} co.
                    </button>
                    <button onClick={() => openEdit(compRow, os)} className="text-xs text-gray-500 hover:text-violet-600 transition-colors mr-3">Edit</button>
                    {compRow && (
                      <button onClick={() => remove(compRow)} disabled={deletingId === compRow.id}
                        className="text-xs text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50">
                        {deletingId === compRow.id ? "Deleting…" : "Delete"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}

            {!loading && !isCatalogueGroup && filteredCompany.map(s => {
              const isShared = s.organization_supplier_id && suppliers.some(r => r.id !== s.id && r.organization_supplier_id === s.organization_supplier_id);
              return (
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
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {isShared
                      ? <button onClick={() => openLinks(s.organization_supplier_id)} className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors">Shared</button>
                      : <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Single company</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(s)} className="text-xs text-gray-500 hover:text-violet-600 transition-colors mr-3">Edit</button>
                    <button onClick={() => remove(s)} disabled={deletingId === s.id}
                      className="text-xs text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50">
                      {deletingId === s.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add / Edit drawer */}
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

              {/* Search-first step */}
              {!editId && orgSupStep === "pick" && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">Search the shared supplier catalogue to avoid creating duplicates.</p>
                  <input autoFocus value={orgSupQuery} onChange={e => searchOrgSuppliers(e.target.value)}
                    placeholder="Search by name…"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                  {orgSupSearching && <p className="text-xs text-gray-400">Searching…</p>}
                  {!orgSupSearching && orgSupQuery.trim() && orgSupResults.length === 0 && (
                    <p className="text-xs text-gray-400">No matching suppliers found.</p>
                  )}
                  {orgSupResults.length > 0 && (
                    <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
                      {orgSupResults.map(s => (
                        <button key={s.id} onClick={() => pickOrgSupplier(s)}
                          className="w-full text-left px-4 py-3 hover:bg-violet-50 transition-colors">
                          <div className="text-sm font-medium text-gray-800">{s.name}</div>
                          {s.code && <div className="text-xs text-gray-400 mt-0.5">{s.code}</div>}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={createSupplierAsNew}
                    className="w-full py-2.5 rounded-xl text-sm font-medium border border-violet-300 text-violet-700 hover:bg-violet-50 transition-colors">
                    + Create as New Supplier
                  </button>
                </div>
              )}

              {/* Form step */}
              {(editId || orgSupStep === "form") && (
                <div className="space-y-4">
                  {!editId && isCatalogueGroup && (
                    <button onClick={() => setOrgSupStep("pick")} className="text-xs text-violet-600 hover:underline">
                      ← Back to search
                    </button>
                  )}
                  {(selectedOrgSupplierId || editOrgId) && (
                    <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-xs text-violet-700">
                      {selectedOrgSupplierId
                        ? <>Linked to master: <span className="font-medium">{selectedOrgSupplierLabel}</span></>
                        : <>Editing company settings for shared supplier <span className="font-medium">{form.name}</span></>
                      }
                    </div>
                  )}

                  <SField label="Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Supplier name"
                    disabled={!!editOrgId} />
                  <SField label="Code" value={form.code} onChange={v => setForm(f => ({ ...f, code: v }))} placeholder="Optional"
                    disabled={!!editOrgId} />
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

                  {editOrgId && (
                    <p className="text-xs text-gray-400 bg-gray-50 rounded-xl px-3 py-2">
                      Name and code are shared across all companies — edit them in <strong>Organization → Suppliers</strong>.
                    </p>
                  )}

                  <button onClick={save} disabled={saving}
                    className="w-full py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
                    {saving ? "Saving…" : editId ? "Update Supplier" : "Create Supplier"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Linked Companies Drawer */}
      {linksOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setLinksOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{linksData?.organizationSupplier?.name || "Linked Companies"}</h2>
                <p className="text-xs text-gray-400">Organization supplier — read-only view</p>
              </div>
              <button onClick={() => setLinksOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3">
              {linksLoading && <p className="text-sm text-gray-400 text-center py-8">Loading…</p>}
              {!linksLoading && (linksData?.companies || []).map(c => (
                <div key={c.supplierId} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 text-sm">{c.companyName || "Unknown company"}</span>
                    {c.isActive
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Active</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Row: <span className="font-mono">{c.name}</span>{c.code ? ` (${c.code})` : ""}</p>
                  {c.contact && <p className="text-xs text-gray-500 mt-0.5">Contact: {c.contact}</p>}
                </div>
              ))}
              {!linksLoading && (linksData?.companies || []).length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">No linked companies found</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SField({ label, value, onChange, placeholder, disabled }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
        className={`w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400 ${disabled ? "bg-gray-50 text-gray-400" : ""}`} />
    </div>
  );
}
