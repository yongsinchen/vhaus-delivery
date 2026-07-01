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

function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <button type="button" disabled={disabled} onClick={() => !disabled && onChange()}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? "bg-violet-600" : "bg-gray-200"} ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-1"}`} />
    </button>
  );
}

function OField({ label, value, onChange, placeholder, type = "text", multiline }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400 resize-none" />
        : <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />}
    </div>
  );
}

const TABS = [
  { id: "companies", label: "Companies" },
  { id: "suppliers", label: "Suppliers" },
  { id: "products", label: "Products" },
];

const EMPTY_SUP = { name: "", notes: "", contact: "", phone: "", email: "", address: "", is_active: true };
const EMPTY_PROD = { name: "", brand: "", description: "", dimensions: "", specification: "", image_url: "", barcode: "", unit_cost: "", unit_price: "", is_customizable: false, is_active: true };

export default function OrganizationPage() {
  const { user, activeCompanyId } = useAuth();
  const companyId = activeCompanyId || user?.company_id;

  const [tab, setTab] = useState("companies");
  const [companies, setCompanies] = useState([]);
  const [orgSuppliers, setOrgSuppliers] = useState([]);
  const [orgProducts, setOrgProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Linked-companies drill-down drawer
  const [linksOpen, setLinksOpen] = useState(false);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksData, setLinksData] = useState(null);
  const [linksKind, setLinksKind] = useState(null);

  // Org supplier edit drawer
  const [supDrawer, setSupDrawer] = useState(false);
  const [editingSup, setEditingSup] = useState(null);
  const [supForm, setSupForm] = useState(EMPTY_SUP);
  const [supSaving, setSupSaving] = useState(false);
  const [supError, setSupError] = useState("");

  // Org product edit drawer
  const [prodDrawer, setProdDrawer] = useState(false);
  const [editingProd, setEditingProd] = useState(null);
  const [prodForm, setProdForm] = useState(EMPTY_PROD);
  const [prodSaving, setProdSaving] = useState(false);
  const [prodError, setProdError] = useState("");

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const headers = await authHeaders();
    const [compRes, supRes, prodRes] = await Promise.all([
      fetch(`${API}/organization-companies`, { headers }),
      fetch(`${API}/organization-suppliers`, { headers }),
      fetch(`${API}/organization-products`, { headers }),
    ]);
    const compData = await compRes.json();
    const supData = await supRes.json();
    const prodData = await prodRes.json();
    setCompanies(compData.companies || []);
    setOrgSuppliers(supData.organizationSuppliers || []);
    setOrgProducts(prodData.organizationProducts || []);
    setLoading(false);
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const openSupplierLinks = async (id) => {
    setLinksKind("supplier");
    setLinksOpen(true);
    setLinksLoading(true);
    setLinksData(null);
    const headers = await authHeaders();
    const res = await fetch(`${API}/organization-suppliers/${id}/companies`, { headers });
    setLinksData(await res.json());
    setLinksLoading(false);
  };

  const openProductLinks = async (id) => {
    setLinksKind("product");
    setLinksOpen(true);
    setLinksLoading(true);
    setLinksData(null);
    const headers = await authHeaders();
    const res = await fetch(`${API}/organization-products/${id}/companies`, { headers });
    setLinksData(await res.json());
    setLinksLoading(false);
  };

  const toggleSupplierShare = async (s) => {
    const next = !s.share_enabled;
    setOrgSuppliers(prev => prev.map(x => x.id === s.id ? { ...x, share_enabled: next } : x));
    const headers = await authHeaders();
    const res = await fetch(`${API}/organization-suppliers/${s.id}`, { method: "PATCH", headers, body: JSON.stringify({ share_enabled: next }) });
    if (!res.ok) { setOrgSuppliers(prev => prev.map(x => x.id === s.id ? { ...x, share_enabled: s.share_enabled } : x)); const d = await res.json().catch(() => ({})); alert(d.error || "Failed to update"); }
  };

  const toggleProductShare = async (p) => {
    const next = !p.share_enabled;
    setOrgProducts(prev => prev.map(x => x.id === p.id ? { ...x, share_enabled: next } : x));
    const headers = await authHeaders();
    const res = await fetch(`${API}/organization-products/${p.id}`, { method: "PATCH", headers, body: JSON.stringify({ share_enabled: next }) });
    if (!res.ok) { setOrgProducts(prev => prev.map(x => x.id === p.id ? { ...x, share_enabled: p.share_enabled } : x)); const d = await res.json().catch(() => ({})); alert(d.error || "Failed to update"); }
  };

  const toggleCompanySharing = async (c) => {
    const next = !c.org_sharing_enabled;
    setCompanies(prev => prev.map(x => x.id === c.id ? { ...x, org_sharing_enabled: next } : x));
    const headers = await authHeaders();
    const res = await fetch(`${API}/organization-companies/${c.id}`, { method: "PATCH", headers, body: JSON.stringify({ org_sharing_enabled: next }) });
    if (!res.ok) { setCompanies(prev => prev.map(x => x.id === c.id ? { ...x, org_sharing_enabled: c.org_sharing_enabled } : x)); const d = await res.json().catch(() => ({})); alert(d.error || "Failed to update"); }
  };

  // ── Org supplier edit ──────────────────────────────────────────
  const openEditSupplier = (s) => {
    setEditingSup(s);
    setSupForm({
      name: s.name || "",
      notes: s.notes || "",
      contact: s.contact || "",
      phone: s.phone || "",
      email: s.email || "",
      address: s.address || "",
      is_active: s.is_active !== false,
    });
    setSupError("");
    setSupDrawer(true);
  };

  const saveSupplier = async () => {
    if (!supForm.name.trim()) { setSupError("Name is required"); return; }
    setSupSaving(true); setSupError("");
    const headers = await authHeaders();
    const body = {
      name: supForm.name.trim(),
      notes: supForm.notes.trim() || null,
      contact: supForm.contact.trim() || null,
      phone: supForm.phone.trim() || null,
      email: supForm.email.trim() || null,
      address: supForm.address.trim() || null,
      is_active: supForm.is_active,
    };
    const res = await fetch(`${API}/organization-suppliers/${editingSup.id}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    const d = await res.json();
    setSupSaving(false);
    if (!res.ok) { setSupError(d.error || "Failed to save"); return; }
    setSupDrawer(false);
    setOrgSuppliers(prev => prev.map(x => x.id === editingSup.id ? { ...x, ...d.organizationSupplier } : x));
  };

  // ── Org product edit ───────────────────────────────────────────
  const openEditProduct = (p) => {
    setEditingProd(p);
    setProdForm({
      name: p.name || "",
      brand: p.brand || "",
      description: p.description || "",
      dimensions: p.dimensions || "",
      specification: p.specification || "",
      image_url: p.image_url || "",
      barcode: p.barcode || "",
      unit_cost: p.unit_cost != null ? String(p.unit_cost) : "",
      unit_price: p.unit_price != null ? String(p.unit_price) : "",
      is_customizable: !!p.is_customizable,
      is_active: p.is_active !== false,
    });
    setProdError("");
    setProdDrawer(true);
  };

  const saveProduct = async () => {
    if (!prodForm.name.trim()) { setProdError("Name is required"); return; }
    setProdSaving(true); setProdError("");
    const headers = await authHeaders();
    const body = {
      name: prodForm.name.trim(),
      brand: prodForm.brand.trim() || null,
      description: prodForm.description.trim() || null,
      dimensions: prodForm.dimensions.trim() || null,
      specification: prodForm.specification.trim() || null,
      image_url: prodForm.image_url.trim() || null,
      barcode: prodForm.barcode.trim() || null,
      unit_cost: prodForm.unit_cost === "" ? null : Number(prodForm.unit_cost),
      unit_price: prodForm.unit_price === "" ? null : Number(prodForm.unit_price),
      is_customizable: prodForm.is_customizable,
      is_active: prodForm.is_active,
    };
    const res = await fetch(`${API}/organization-products/${editingProd.id}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    const d = await res.json();
    setProdSaving(false);
    if (!res.ok) { setProdError(d.error || "Failed to save"); return; }
    setProdDrawer(false);
    setOrgProducts(prev => prev.map(x => x.id === editingProd.id ? { ...x, ...d.organizationProduct } : x));
  };

  const canManageCompanySharing = user?.role === "master";

  const filteredSuppliers = orgSuppliers.filter(s =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.code?.toLowerCase().includes(search.toLowerCase()));
  const filteredProducts = orgProducts.filter(p =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.code?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Organization</h1>
        <p className="text-sm text-gray-500">Companies, suppliers, and products shared across your organization</p>
      </div>

      <div className="flex gap-2 border-b border-gray-100">
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setSearch(""); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? "border-violet-600 text-violet-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab !== "companies" && (
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or code…"
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm w-64 focus:outline-none focus:border-violet-400" />
      )}

      {/* ── Companies tab ── */}
      {tab === "companies" && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 hidden sm:table-cell">Code</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Open for sharing</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>}
              {!loading && companies.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No companies found</td></tr>}
              {!loading && companies.map(c => (
                <tr key={c.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs hidden sm:table-cell">{c.code || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${c.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ToggleSwitch checked={c.org_sharing_enabled !== false} disabled={!canManageCompanySharing} onChange={() => toggleCompanySharing(c)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Suppliers tab ── */}
      {tab === "suppliers" && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 hidden sm:table-cell">Code</th>
                <th className="px-4 py-3 hidden md:table-cell">Contact</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Shared</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>}
              {!loading && filteredSuppliers.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No suppliers found</td></tr>}
              {!loading && filteredSuppliers.map(s => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-violet-50/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs hidden sm:table-cell">{s.code || "—"}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">{s.contact || "—"}</td>
                  <td className="px-4 py-3">
                    {s.isShared ? (
                      <button onClick={() => openSupplierLinks(s.id)}
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors">
                        {s.companyCount} companies
                      </button>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">{s.companyCount} company</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ToggleSwitch checked={s.share_enabled !== false} onChange={() => toggleSupplierShare(s)} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEditSupplier(s)} className="text-xs text-gray-500 hover:text-violet-600 transition-colors">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Products tab ── */}
      {tab === "products" && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 hidden sm:table-cell">Brand</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Shared</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>}
              {!loading && filteredProducts.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No products found</td></tr>}
              {!loading && filteredProducts.map(p => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-violet-50/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-violet-700 font-medium">{p.code}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{p.name}{p.size ? <span className="text-gray-400 ml-1 text-xs">{p.size}</span> : null}{p.color ? <span className="text-gray-400 ml-1 text-xs">{p.color}</span> : null}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs hidden sm:table-cell">{p.brand || "—"}</td>
                  <td className="px-4 py-3">
                    {p.isShared ? (
                      <button onClick={() => openProductLinks(p.id)}
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors">
                        {p.companyCount} companies
                      </button>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">{p.companyCount} company</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ToggleSwitch checked={p.share_enabled !== false} onChange={() => toggleProductShare(p)} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEditProduct(p)} className="text-xs text-gray-500 hover:text-violet-600 transition-colors">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Org supplier edit drawer ── */}
      {supDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSupDrawer(false)} />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Edit Supplier Master</h2>
                <p className="text-xs text-gray-400">Changes apply to all linked companies</p>
              </div>
              <button onClick={() => setSupDrawer(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {supError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-xl">{supError}</div>}

              <div className="bg-violet-50 rounded-xl px-3 py-2 text-xs text-violet-700">
                Master version <span className="font-mono font-medium">v{editingSup?.version ?? "?"}</span> · {editingSup?.companyCount ?? 0} companies linked
              </div>

              <OField label="Name *" value={supForm.name} onChange={v => setSupForm(f => ({ ...f, name: v }))} placeholder="Supplier name" />
              <OField label="Contact person" value={supForm.contact} onChange={v => setSupForm(f => ({ ...f, contact: v }))} placeholder="e.g. John Lim" />
              <OField label="Phone" value={supForm.phone} onChange={v => setSupForm(f => ({ ...f, phone: v }))} placeholder="+60 12 345 6789" />
              <OField label="Email" value={supForm.email} onChange={v => setSupForm(f => ({ ...f, email: v }))} placeholder="supplier@example.com" type="email" />
              <OField label="Address" value={supForm.address} onChange={v => setSupForm(f => ({ ...f, address: v }))} placeholder="Full address" multiline />
              <OField label="Notes" value={supForm.notes} onChange={v => setSupForm(f => ({ ...f, notes: v }))} placeholder="Internal notes" multiline />

              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-700">Active</span>
                <ToggleSwitch checked={supForm.is_active} onChange={() => setSupForm(f => ({ ...f, is_active: !f.is_active }))} />
              </div>

              <button onClick={saveSupplier} disabled={supSaving}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {supSaving ? "Saving…" : "Update Supplier Master"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Org product edit drawer ── */}
      {prodDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setProdDrawer(false)} />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Edit Product Master</h2>
                <p className="text-xs text-gray-400">Changes propagate to all linked company products</p>
              </div>
              <button onClick={() => setProdDrawer(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {prodError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-xl">{prodError}</div>}

              <div className="bg-violet-50 rounded-xl px-3 py-2 text-xs text-violet-700">
                <span className="font-mono font-medium">{editingProd?.code}</span>
                {editingProd?.size && <span className="ml-2">{editingProd.size}</span>}
                {editingProd?.color && <span className="ml-2">{editingProd.color}</span>}
                <span className="ml-2">· v{editingProd?.version ?? "?"} · {editingProd?.companyCount ?? 0} companies</span>
              </div>

              <OField label="Name *" value={prodForm.name} onChange={v => setProdForm(f => ({ ...f, name: v }))} placeholder="Product name" />
              <OField label="Brand" value={prodForm.brand} onChange={v => setProdForm(f => ({ ...f, brand: v }))} placeholder="e.g. Windsor" />
              <OField label="Description" value={prodForm.description} onChange={v => setProdForm(f => ({ ...f, description: v }))} placeholder="Product description" multiline />
              <OField label="Dimensions" value={prodForm.dimensions} onChange={v => setProdForm(f => ({ ...f, dimensions: v }))} placeholder="e.g. W80 × D60 × H45 cm" />
              <OField label="Specification" value={prodForm.specification} onChange={v => setProdForm(f => ({ ...f, specification: v }))} placeholder="Material, finish, etc." multiline />
              <OField label="Image URL" value={prodForm.image_url} onChange={v => setProdForm(f => ({ ...f, image_url: v }))} placeholder="https://…" />
              <OField label="Barcode" value={prodForm.barcode} onChange={v => setProdForm(f => ({ ...f, barcode: v }))} placeholder="EAN / SKU barcode" />

              <div className="grid grid-cols-2 gap-3">
                <OField label="Base cost (RM)" value={prodForm.unit_cost} onChange={v => setProdForm(f => ({ ...f, unit_cost: v }))} placeholder="0.00" type="number" />
                <OField label="Base price (RM)" value={prodForm.unit_price} onChange={v => setProdForm(f => ({ ...f, unit_price: v }))} placeholder="0.00" type="number" />
              </div>
              <p className="text-xs text-gray-400 -mt-2">Base cost/price are the org master defaults. Individual companies can override these on their own product row.</p>

              <div className="flex items-center justify-between py-1">
                <div>
                  <span className="text-sm text-gray-700">Customizable</span>
                  <p className="text-xs text-gray-400">Can be made to order with custom spec</p>
                </div>
                <ToggleSwitch checked={prodForm.is_customizable} onChange={() => setProdForm(f => ({ ...f, is_customizable: !f.is_customizable }))} />
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-700">Active</span>
                <ToggleSwitch checked={prodForm.is_active} onChange={() => setProdForm(f => ({ ...f, is_active: !f.is_active }))} />
              </div>

              <button onClick={saveProduct} disabled={prodSaving}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {prodSaving ? "Saving…" : "Update Product Master"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Linked companies drill-down drawer ── */}
      {linksOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setLinksOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {(linksKind === "supplier" ? linksData?.organizationSupplier?.name : linksData?.organizationProduct?.name) || "Linked Companies"}
                </h2>
                <p className="text-xs text-gray-400">Organization {linksKind} — read-only view</p>
              </div>
              <button onClick={() => setLinksOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3">
              {linksLoading && <p className="text-sm text-gray-400 text-center py-8">Loading…</p>}
              {!linksLoading && (linksData?.companies || []).map(c => (
                <div key={c.supplierId || c.productId} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 text-sm">{c.companyName || "Unknown company"}</span>
                    {c.isActive
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Active</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Row: <span className="font-mono">{c.name}</span>{c.code ? ` (${c.code})` : ""}</p>
                  {c.contact && <p className="text-xs text-gray-500 mt-0.5">Contact: {c.contact}</p>}
                  {c.unitPrice != null && <p className="text-xs text-gray-500 mt-0.5">Price: {Number(c.unitPrice).toFixed(2)}</p>}
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
