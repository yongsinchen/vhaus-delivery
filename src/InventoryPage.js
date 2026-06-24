import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";

const API = "https://vhaus-bot-production.up.railway.app";

const getToken = async () => {
  let { data } = await supabase.auth.getSession();
  let s = data?.session;
  if (s?.expires_at && s.expires_at * 1000 < Date.now() + 60000) {
    const { data: r } = await supabase.auth.refreshSession();
    s = r?.session || s;
  }
  return s?.access_token || "";
};
const authHeaders = async () => ({ "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}` });

const TABS = ["Stock Levels", "Movements", "Adjust", "Transfer", "Import"];

export default function InventoryPage() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const [tab, setTab] = useState(0);

  const [inventory, setInventory] = useState([]);
  const [movements, setMovements] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [search, setSearch] = useState("");

  // Adjust form
  const [adjWarehouse, setAdjWarehouse] = useState("");
  const [adjProduct, setAdjProduct] = useState("");
  const [adjQty, setAdjQty] = useState("");
  const [adjNotes, setAdjNotes] = useState("");

  // Transfer form
  const [txFrom, setTxFrom] = useState("");
  const [txTo, setTxTo] = useState("");
  const [txProduct, setTxProduct] = useState("");
  const [txQty, setTxQty] = useState("");
  const [txNotes, setTxNotes] = useState("");

  const [adjProductSearch, setAdjProductSearch] = useState("");
  const [txProductSearch, setTxProductSearch] = useState("");

  const loadWarehouses = useCallback(async () => {
    if (!companyId) return;
    const res = await fetch(`${API}/warehouses?company_id=${companyId}`);
    const d = await res.json();
    setWarehouses(d.warehouses || []);
  }, [companyId]);

  const loadInventory = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const params = new URLSearchParams({ company_id: companyId });
    if (filterWarehouse) params.set("warehouse_id", filterWarehouse);
    if (filterLowStock) params.set("low_stock", "true");
    const res = await fetch(`${API}/inventory?${params}`);
    const d = await res.json();
    setInventory(d.inventory || []);
    setLoading(false);
  }, [companyId, filterWarehouse, filterLowStock]);

  const loadMovements = useCallback(async () => {
    if (!companyId) return;
    const params = new URLSearchParams({ company_id: companyId, limit: "200" });
    if (filterWarehouse) params.set("warehouse_id", filterWarehouse);
    const res = await fetch(`${API}/stock-movements?${params}`);
    const d = await res.json();
    setMovements(d.movements || []);
  }, [companyId, filterWarehouse]);

  const loadProducts = useCallback(async () => {
    if (!companyId) return;
    const res = await fetch(`${API}/products?company_id=${companyId}&limit=999&is_active=true`);
    const d = await res.json();
    setProducts(d.products || []);
  }, [companyId]);

  useEffect(() => { loadWarehouses(); loadProducts(); }, [loadWarehouses, loadProducts]);
  useEffect(() => { if (tab === 0) loadInventory(); if (tab === 1) loadMovements(); }, [tab, loadInventory, loadMovements]);

  const filteredInv = search
    ? inventory.filter(i => {
        const p = i.products;
        const q = search.toLowerCase();
        return (p?.code || "").toLowerCase().includes(q) || (p?.name || "").toLowerCase().includes(q);
      })
    : inventory;

  const getFilteredProducts = (q) => q
    ? products.filter(p => (p.code + " " + p.name).toLowerCase().includes(q.toLowerCase())).slice(0, 20)
    : products.slice(0, 20);

  const doAdjust = async () => {
    if (!adjWarehouse || !adjProduct || adjQty === "") return;
    const headers = await authHeaders();
    const res = await fetch(`${API}/inventory/adjust`, {
      method: "POST", headers, body: JSON.stringify({ warehouse_id: adjWarehouse, product_id: adjProduct, quantity: Number(adjQty), notes: adjNotes }),
    });
    const d = await res.json();
    if (!res.ok) { alert(d.error || "Failed"); return; }
    alert(`Stock adjusted to ${d.new_quantity}`);
    setAdjQty(""); setAdjNotes("");
    loadInventory();
  };

  const doTransfer = async () => {
    if (!txFrom || !txTo || !txProduct || !txQty) return;
    if (txFrom === txTo) { alert("From and To must be different"); return; }
    const headers = await authHeaders();
    const res = await fetch(`${API}/inventory/transfer`, {
      method: "POST", headers, body: JSON.stringify({ from_warehouse_id: txFrom, to_warehouse_id: txTo, product_id: txProduct, quantity: Number(txQty), notes: txNotes }),
    });
    const d = await res.json();
    if (!res.ok) { alert(d.error || "Failed"); return; }
    alert("Transfer complete");
    setTxQty(""); setTxNotes("");
    loadInventory();
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Inventory</h1>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2 text-sm font-medium rounded-t-xl transition-colors ${tab === i ? "bg-violet-600 text-white" : "text-gray-500 hover:text-violet-700 hover:bg-violet-50"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Stock Levels */}
      {tab === 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product…"
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm w-48 focus:outline-none focus:border-violet-400" />
            <select value={filterWarehouse} onChange={e => setFilterWarehouse(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
              <option value="">All Locations</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.type})</option>)}
            </select>
            <label className="flex items-center gap-1 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={filterLowStock} onChange={e => setFilterLowStock(e.target.checked)}
                className="rounded border-gray-300 text-violet-600" />
              Low stock only
            </label>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Reserved</th>
                  <th className="px-4 py-3 text-right">Available</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>}
                {!loading && filteredInv.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No stock records</td></tr>}
                {!loading && filteredInv.map(i => {
                  const p = i.products || {};
                  const avail = (i.quantity || 0) - (i.reserved_qty || 0);
                  const reorder = p.reorder_point || 0;
                  const isLow = i.quantity <= reorder && reorder > 0;
                  const isOut = i.quantity <= 0;
                  return (
                    <tr key={i.id} className="border-b border-gray-50">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-violet-700">{p.code}</span>
                        <span className="ml-1 text-gray-900">{p.name}</span>
                        {p.color && <span className="text-xs text-gray-400 ml-1">· {p.color}</span>}
                        {p.size && <span className="text-xs text-gray-400 ml-1">· {p.size}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{i.warehouses?.name || "—"}</td>
                      <td className="px-4 py-3 text-right font-medium">{i.quantity}</td>
                      <td className="px-4 py-3 text-right text-gray-400">{i.reserved_qty || 0}</td>
                      <td className="px-4 py-3 text-right font-medium">{avail}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isOut ? "bg-red-100 text-red-700" : isLow ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                          {isOut ? "Out" : isLow ? "Low" : "OK"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Movements */}
      {tab === 1 && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <select value={filterWarehouse} onChange={e => setFilterWarehouse(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
              <option value="">All Locations</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button onClick={loadMovements} className="text-xs px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50">Refresh</button>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No movements yet</td></tr>}
                {movements.map(m => (
                  <tr key={m.id} className="border-b border-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-500">{new Date(m.created_at).toLocaleString("en-MY", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.type === "in" ? "bg-emerald-100 text-emerald-700" : m.type === "out" ? "bg-red-100 text-red-700" : m.type === "transfer" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                        {m.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-900">{m.products?.code} {m.products?.name}</td>
                    <td className="px-4 py-2 text-gray-500">{m.warehouses?.name || "—"}</td>
                    <td className={`px-4 py-2 text-right font-medium ${m.quantity > 0 ? "text-emerald-700" : "text-red-600"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">{m.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Adjust */}
      {tab === 2 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4 max-w-lg">
          <p className="text-sm text-gray-500">Set the absolute stock count for a product at a location. Use for physical count corrections.</p>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Warehouse / Showroom</label>
            <select value={adjWarehouse} onChange={e => setAdjWarehouse(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
              <option value="">Select location</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.type})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Product</label>
            <input value={adjProductSearch} onChange={e => setAdjProductSearch(e.target.value)} placeholder="Search product…"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm mb-1" />
            {adjProductSearch && (
              <div className="border border-gray-200 rounded-xl max-h-40 overflow-y-auto">
                {getFilteredProducts(adjProductSearch).map(p => (
                  <button key={p.id} onClick={() => { setAdjProduct(p.id); setAdjProductSearch(`${p.code} ${p.name}`); }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-violet-50 ${adjProduct === p.id ? "bg-violet-50 font-medium" : ""}`}>
                    <span className="font-mono text-violet-700">{p.code}</span> {p.name} {p.size ? <span className="text-gray-400">· {p.size}</span> : ""} {p.color ? <span className="text-gray-400">· {p.color}</span> : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">New Quantity</label>
              <input type="number" value={adjQty} onChange={e => setAdjQty(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Reason</label>
              <input value={adjNotes} onChange={e => setAdjNotes(e.target.value)} placeholder="e.g. Physical count"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            </div>
          </div>
          <button onClick={doAdjust} className="px-6 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">Set Stock</button>
        </div>
      )}

      {/* Transfer */}
      {tab === 3 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4 max-w-lg">
          <p className="text-sm text-gray-500">Move stock between locations.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <select value={txFrom} onChange={e => setTxFrom(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                <option value="">Select</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <select value={txTo} onChange={e => setTxTo(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                <option value="">Select</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Product</label>
            <input value={txProductSearch} onChange={e => setTxProductSearch(e.target.value)} placeholder="Search product…"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm mb-1" />
            {txProductSearch && (
              <div className="border border-gray-200 rounded-xl max-h-40 overflow-y-auto">
                {getFilteredProducts(txProductSearch).map(p => (
                  <button key={p.id} onClick={() => { setTxProduct(p.id); setTxProductSearch(`${p.code} ${p.name}`); }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-violet-50 ${txProduct === p.id ? "bg-violet-50 font-medium" : ""}`}>
                    <span className="font-mono text-violet-700">{p.code}</span> {p.name} {p.size ? <span className="text-gray-400">· {p.size}</span> : ""} {p.color ? <span className="text-gray-400">· {p.color}</span> : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Quantity</label>
              <input type="number" value={txQty} onChange={e => setTxQty(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <input value={txNotes} onChange={e => setTxNotes(e.target.value)} placeholder="Optional"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            </div>
          </div>
          <button onClick={doTransfer} className="px-6 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">Transfer</button>
        </div>
      )}

      {/* Import */}
      {tab === 4 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4 max-w-lg">
          <p className="text-sm text-gray-500">Upload an Excel/CSV with columns: <b>code</b> (product code), <b>quantity</b>. Products are matched by code against your master list.</p>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Destination Warehouse</label>
            <select id="import-wh" className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
              <option value="">Select location</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.type})</option>)}
            </select>
          </div>
          <div className="border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center hover:border-violet-300 transition-colors">
            <input type="file" accept=".xlsx,.xls,.csv" id="import-file" className="hidden" onChange={async e => {
              const file = e.target.files?.[0];
              const wh = document.getElementById("import-wh").value;
              if (!file || !wh) { alert("Select a warehouse and file"); return; }
              const token = await getToken();
              const fd = new FormData();
              fd.append("file", file);
              fd.append("warehouse_id", wh);
              const btn = document.getElementById("import-btn");
              if (btn) btn.textContent = "Importing…";
              const res = await fetch(`${API}/inventory/import`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
              const d = await res.json();
              if (btn) btn.textContent = "Upload & Import";
              if (!res.ok) { alert(d.error || "Failed"); return; }
              let msg = `Imported: ${d.imported}, Skipped: ${d.skipped}`;
              if (d.errors?.length) msg += "\n\nErrors:\n" + d.errors.join("\n");
              alert(msg);
              loadInventory();
              e.target.value = "";
            }} />
            <label htmlFor="import-file" className="cursor-pointer">
              <div className="text-3xl mb-2">📁</div>
              <p id="import-btn" className="text-sm font-medium text-gray-700">Upload & Import</p>
              <p className="text-xs text-gray-400 mt-1">XLSX, XLS, or CSV</p>
            </label>
          </div>
          <div className="text-xs text-gray-400">
            <p className="font-medium mb-1">Expected columns:</p>
            <code className="bg-gray-50 px-2 py-1 rounded text-xs">code, quantity</code>
            <p className="mt-1">Product code must match your master product list. Unmatched codes will be skipped and reported.</p>
          </div>
        </div>
      )}
    </div>
  );
}
