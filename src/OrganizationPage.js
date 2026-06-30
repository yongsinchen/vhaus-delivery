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

const TABS = [
  { id: "companies", label: "Companies" },
  { id: "suppliers", label: "Suppliers" },
  { id: "products", label: "Products" },
];

export default function OrganizationPage() {
  const { user, activeCompanyId } = useAuth();
  const companyId = activeCompanyId || user?.company_id;

  const [tab, setTab] = useState("companies");
  const [companies, setCompanies] = useState([]);
  const [orgSuppliers, setOrgSuppliers] = useState([]);
  const [orgProducts, setOrgProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const [linksOpen, setLinksOpen] = useState(false);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksData, setLinksData] = useState(null);
  const [linksKind, setLinksKind] = useState(null); // "supplier" | "product"

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

      {tab === "companies" && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 hidden sm:table-cell">Code</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>}
              {!loading && companies.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">No companies found</td></tr>}
              {!loading && companies.map(c => (
                <tr key={c.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs hidden sm:table-cell">{c.code || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${c.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {c.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "suppliers" && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 hidden sm:table-cell">Code</th>
                <th className="px-4 py-3">Scope</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>}
              {!loading && filteredSuppliers.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">No suppliers found</td></tr>}
              {!loading && filteredSuppliers.map(s => (
                <tr key={s.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs hidden sm:table-cell">{s.code || "—"}</td>
                  <td className="px-4 py-3">
                    {s.isShared ? (
                      <button onClick={() => openSupplierLinks(s.id)}
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors">
                        Shared · {s.companyCount} companies
                      </button>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">{s.companyCount} company</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "products" && (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Scope</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>}
              {!loading && filteredProducts.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400">No products found</td></tr>}
              {!loading && filteredProducts.map(p => (
                <tr key={p.id} className="border-b border-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-violet-700 font-medium">{p.code}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                  <td className="px-4 py-3">
                    {p.isShared ? (
                      <button onClick={() => openProductLinks(p.id)}
                        className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors">
                        Shared · {p.companyCount} companies
                      </button>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">{p.companyCount} company</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
