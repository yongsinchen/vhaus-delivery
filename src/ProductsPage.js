import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useDebounce } from "./UIComponents";

const API = "https://vhaus-bot-production.up.railway.app";

const getToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || "";
};

const authHeaders = async () => {
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return { "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}`, ...(cid && { "X-Company-ID": cid }) };
};

const EMPTY_PRODUCT = {
  code: "", name: "", description: "", color: "", size: "", supplier_id: "", category_id: "",
  unit_cost: "", unit_price: "", is_standard: true, is_customizable: false, reorder_point: 0,
};

export default function ProductsPage() {
  const { user, activeCompanyId } = useAuth();
  const companyId = activeCompanyId || user?.company_id;

  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  // isCatalogueGroup: true when the active company belongs to a catalogue group.
  // Derived from whether the fetched supplier rows have organization_supplier_id set.
  // Used to deduplicate supplier options by org master and show canonical names.
  const [isCatalogueGroup, setIsCatalogueGroup] = useState(false);
  const [categories, setCategories] = useState([]);
  const [orgProductMap, setOrgProductMap] = useState({}); // organization_product_id -> { companyCount, isShared, name }
  const [linksOpen, setLinksOpen] = useState(false);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksData, setLinksData] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterActive, setFilterActive] = useState("all");

  // Product Review Queue
  const [showReview, setShowReview] = useState(false);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [linkSearch, setLinkSearch] = useState({});
  const [linkResults, setLinkResults] = useState({});

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_PRODUCT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Catalogue import drawer
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState("upload"); // upload | processing | review | done | failed
  const [importFile, setImportFile] = useState(null);
  const [importSupplier, setImportSupplier] = useState("");
  const [importCategory, setImportCategory] = useState("");
  const [importRows, setImportRows] = useState([]);
  const [importCostMode, setImportCostMode] = useState("catalogue"); // catalogue | derive
  const [importCostDivisor, setImportCostDivisor] = useState("3");
  const [importJobId, setImportJobId] = useState(null);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [importProgress, setImportProgress] = useState(null); // { pages_processed, pages_total }

  // New supplier/category inline add
  const [newSupplier, setNewSupplier] = useState("");
  const [newCategory, setNewCategory] = useState("");

  // Search-first product creation (catalogue-group companies only)
  const [orgProdStep, setOrgProdStep] = useState("form"); // "pick" | "form"
  const [orgProdQuery, setOrgProdQuery] = useState("");
  const [orgProdResults, setOrgProdResults] = useState([]);
  const [orgProdSearching, setOrgProdSearching] = useState(false);
  const [selectedOrgProductId, setSelectedOrgProductId] = useState(null);
  const [selectedOrgProductLabel, setSelectedOrgProductLabel] = useState("");

  // Bulk edit
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ supplier: false, supplier_id: "", category: false, category_id: "", active: false, is_active: true, cost: false, cost_divisor: "3", setCost: false, unit_cost: "", setPrice: false, unit_price: "" });
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState("");

  const loadSuppliers = useCallback(async () => {
    if (!companyId) return;
    const headers = await authHeaders();
    const res = await fetch(`${API}/suppliers?company_id=${companyId}`, { headers });
    const d = await res.json();
    const rows = d.suppliers || [];
    setSuppliers(rows);
    // Infer catalogue-group status: if any row has an org master link, this company
    // is in a catalogue group and we should show canonical org master names.
    setIsCatalogueGroup(rows.some(s => !!s.organization_supplier_id));
  }, [companyId]);

  const loadCategories = useCallback(async () => {
    if (!companyId) return;
    const headers = await authHeaders();
    const res = await fetch(`${API}/categories?company_id=${companyId}`, { headers });
    const d = await res.json();
    setCategories(d.categories || []);
  }, [companyId]);

  const loadOrgProducts = useCallback(async () => {
    if (!companyId) return;
    const headers = await authHeaders();
    const res = await fetch(`${API}/organization-products`, { headers });
    const d = await res.json();
    const map = {};
    for (const o of (d.organizationProducts || [])) {
      map[o.id] = { companyCount: o.companyCount, isShared: o.isShared, name: o.name };
    }
    setOrgProductMap(map);
  }, [companyId]);

  const openLinks = async (orgProductId) => {
    setLinksOpen(true);
    setLinksLoading(true);
    setLinksData(null);
    const headers = await authHeaders();
    const res = await fetch(`${API}/organization-products/${orgProductId}/companies`, { headers });
    const d = await res.json();
    setLinksData(d);
    setLinksLoading(false);
  };

  const loadProducts = useCallback(async (p = 1) => {
    if (!companyId) return;
    setLoading(true);
    const headers = await authHeaders();
    const params = new URLSearchParams({ company_id: companyId, page: p, limit: 50 });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (filterSupplier) params.set("supplier_id", filterSupplier);
    if (filterCategory) params.set("category_id", filterCategory);
    if (filterActive !== "all") params.set("is_active", filterActive);
    const res = await fetch(`${API}/products?${params}`, { headers });
    const d = await res.json();
    setProducts(d.products || []);
    setTotal(d.total || 0);
    setPage(p);
    setLoading(false);
  }, [companyId, debouncedSearch, filterSupplier, filterCategory, filterActive]);

  useEffect(() => { loadSuppliers(); loadCategories(); loadOrgProducts(); }, [loadSuppliers, loadCategories, loadOrgProducts]);
  useEffect(() => { loadProducts(1); }, [loadProducts]);

  const loadReviewQueue = async () => {
    setReviewLoading(true);
    const headers = await authHeaders();
    const res = await fetch(`${API}/product-review-queue`, { headers });
    const d = await res.json();
    setReviewQueue(d.queue || []);
    setReviewTotal(d.total_items || 0);
    setReviewLoading(false);
  };

  const linkToProduct = async (itemIds, productId) => {
    const headers = await authHeaders();
    await fetch(`${API}/product-review-queue/link`, { method: "POST", headers, body: JSON.stringify({ item_ids: itemIds, product_id: productId }) });
    loadReviewQueue();
  };

  const createAndLink = async (group) => {
    const headers = await authHeaders();
    await fetch(`${API}/product-review-queue/create-and-link`, { method: "POST", headers, body: JSON.stringify({
      item_ids: group.item_ids, product_code: group.product_code, product_name: group.product_name,
      size: group.size, color: group.color, unit_price: group.sample_price,
    }) });
    loadReviewQueue(); loadProducts(1);
  };

  const dismissItems = async (itemIds) => {
    const headers = await authHeaders();
    await fetch(`${API}/product-review-queue/dismiss`, { method: "POST", headers, body: JSON.stringify({ item_ids: itemIds }) });
    loadReviewQueue();
  };

  const searchForLink = async (groupKey, q) => {
    setLinkSearch(prev => ({ ...prev, [groupKey]: q }));
    if (q.length < 2) { setLinkResults(prev => ({ ...prev, [groupKey]: [] })); return; }
    const headers = await authHeaders();
    const res = await fetch(`${API}/products?company_id=${companyId}&search=${encodeURIComponent(q)}&limit=8`, { headers });
    const d = await res.json();
    setLinkResults(prev => ({ ...prev, [groupKey]: d.products || [] }));
  };

  // Search org-level product masters (catalogue-group companies only)
  const searchOrgProducts = async (q) => {
    setOrgProdQuery(q);
    if (!q.trim()) { setOrgProdResults([]); return; }
    setOrgProdSearching(true);
    const headers = await authHeaders();
    const res = await fetch(`${API}/organization-products/search?q=${encodeURIComponent(q.trim())}`, { headers });
    const d = await res.json();
    setOrgProdResults(d.products || []);
    setOrgProdSearching(false);
  };

  const pickOrgProduct = (p) => {
    setSelectedOrgProductId(p.id);
    const label = [p.code, p.name, p.size, p.color].filter(Boolean).join(" · ");
    setSelectedOrgProductLabel(label);
    setForm(f => ({ ...f, code: p.code || "", name: p.name || "", size: p.size || "", color: p.color || "" }));
    setOrgProdStep("form");
  };

  const createAsNew = () => {
    setSelectedOrgProductId(null);
    setSelectedOrgProductLabel("");
    setOrgProdStep("form");
  };

  // ── Product drawer ────────────────────────────────────────────────
  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_PRODUCT);
    setFormError("");
    setSelectedOrgProductId(null);
    setSelectedOrgProductLabel("");
    setOrgProdQuery("");
    setOrgProdResults([]);
    // For catalogue-group companies, start on the search step; otherwise go direct to form
    setOrgProdStep(categoriesAreOrgLevel ? "pick" : "form");
    setDrawerOpen(true);
  };

  const openEdit = (p) => {
    setEditId(p.id);
    setForm({
      code: p.code || "", name: p.name || "", description: p.description || "", color: p.color || "", size: p.size || "",
      supplier_id: p.suppliers?.id || "", category_id: p.product_categories?.id || p.organization_categories?.id || "",
      unit_cost: p.unit_cost ?? "", unit_price: p.unit_price ?? "",
      is_standard: p.is_standard, is_customizable: p.is_customizable || false, reorder_point: p.reorder_point ?? 0,
    });
    setFormError("");
    setDrawerOpen(true);
  };

  // Categories collapse to org-level for companies in a catalogue group —
  // GET /categories returns isOrgLevel:true on every item in that case, and
  // products must then be saved with organization_category_id instead of
  // category_id (see server.js POST/PUT /products).
  const categoriesAreOrgLevel = categories.length > 0 && categories[0].isOrgLevel === true;

  // For catalogue-group companies: deduplicate suppliers by org master and show
  // the canonical org master name. Each option's value is still the company-level
  // supplier id (needed for GET /products?supplier_id filter and products.supplier_id FK).
  const supplierOptions = (() => {
    if (!isCatalogueGroup) return suppliers.map(s => ({ id: s.id, label: s.name }));
    const seen = new Set();
    return suppliers
      .filter(s => {
        const key = s.organization_supplier_id || s.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(s => ({ id: s.id, label: s.organization_suppliers?.name || s.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  })();

  const saveProduct = async () => {
    if (!form.code.trim() || !form.name.trim()) { setFormError("Code and name are required"); return; }
    setSaving(true);
    setFormError("");
    const headers = await authHeaders();
    const body = {
      code: form.code, name: form.name, description: form.description || null, color: form.color || null, size: form.size || null,
      supplier_id: form.supplier_id || null,
      category_id: categoriesAreOrgLevel ? null : (form.category_id || null),
      organization_category_id: categoriesAreOrgLevel ? (form.category_id || null) : null,
      unit_cost: form.unit_cost === "" ? null : Number(form.unit_cost),
      unit_price: form.unit_price === "" ? null : Number(form.unit_price),
      is_standard: form.is_standard, is_customizable: form.is_customizable, reorder_point: Number(form.reorder_point) || 0,
      // Pass explicit org master link when user picked one in the search-first flow
      ...(selectedOrgProductId && !editId ? { organization_product_id: selectedOrgProductId } : {}),
    };
    const url = editId ? `${API}/products/${editId}` : `${API}/products`;
    const method = editId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
    const d = await res.json();
    setSaving(false);
    if (!res.ok) { setFormError(d.error || "Failed to save"); return; }
    setDrawerOpen(false);
    loadProducts(page);
  };

  const toggleActive = async (p) => {
    const headers = await authHeaders();
    await fetch(`${API}/products/${p.id}/toggle`, { method: "PATCH", headers });
    loadProducts(page);
  };

  const deleteProduct = async (p) => {
    const label = `${p.code}${p.size ? " · " + p.size : ""}`;
    if (!window.confirm(`Delete "${p.name}" (${label})? This cannot be undone.`)) return;
    const headers = await authHeaders();
    const res = await fetch(`${API}/products/${p.id}`, { method: "DELETE", headers });
    if (res.ok) { setSelectedIds(prev => { const n = new Set(prev); n.delete(p.id); return n; }); loadProducts(page); }
    else { const d = await res.json().catch(() => ({})); alert(d.error || "Failed to delete"); }
  };

  const bulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedIds.size} selected product(s)? This cannot be undone.`)) return;
    const headers = await authHeaders();
    const res = await fetch(`${API}/products/bulk-delete`, { method: "POST", headers, body: JSON.stringify({ ids: Array.from(selectedIds) }) });
    if (res.ok) { clearSelection(); loadProducts(page); }
    else { const d = await res.json().catch(() => ({})); alert(d.error || "Failed to delete"); }
  };

  // ── Add supplier/category inline ──────────────────────────────────
  const addSupplier = async () => {
    if (!newSupplier.trim()) return;
    const headers = await authHeaders();
    const res = await fetch(`${API}/suppliers`, { method: "POST", headers, body: JSON.stringify({ name: newSupplier.trim() }) });
    if (res.ok) { setNewSupplier(""); loadSuppliers(); }
  };

  const addCategory = async () => {
    if (!newCategory.trim()) return;
    const headers = await authHeaders();
    const res = await fetch(`${API}/categories`, { method: "POST", headers, body: JSON.stringify({ name: newCategory.trim() }) });
    if (res.ok) { setNewCategory(""); loadCategories(); }
  };

  // ── Bulk edit ─────────────────────────────────────────────────────
  const toggleSelect = (id) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const allOnPageSelected = products.length > 0 && products.every(p => selectedIds.has(p.id));
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (products.every(p => n.has(p.id))) products.forEach(p => n.delete(p.id));
      else products.forEach(p => n.add(p.id));
      return n;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const openBulk = () => {
    setBulkForm({ supplier: false, supplier_id: "", category: false, category_id: "", active: false, is_active: true, cost: false, cost_divisor: "3" });
    setBulkError("");
    setBulkOpen(true);
  };

  const applyBulk = async () => {
    const set = {};
    if (bulkForm.supplier) set.supplier_id = bulkForm.supplier_id || null;
    if (bulkForm.category) {
      if (categoriesAreOrgLevel) set.organization_category_id = bulkForm.category_id || null;
      else set.category_id = bulkForm.category_id || null;
    }
    if (bulkForm.active) set.is_active = bulkForm.is_active;
    if (bulkForm.setCost && bulkForm.unit_cost !== "") set.unit_cost = Number(bulkForm.unit_cost);
    if (bulkForm.setPrice && bulkForm.unit_price !== "") set.unit_price = Number(bulkForm.unit_price);
    const cost_divisor = bulkForm.cost ? bulkForm.cost_divisor : undefined;
    if (Object.keys(set).length === 0 && !cost_divisor) { setBulkError("Pick at least one change to apply"); return; }
    setBulkSaving(true); setBulkError("");
    const headers = await authHeaders();
    const res = await fetch(`${API}/products/bulk`, {
      method: "PATCH", headers,
      body: JSON.stringify({ ids: Array.from(selectedIds), set, cost_divisor }),
    });
    const d = await res.json();
    setBulkSaving(false);
    if (!res.ok) { setBulkError(d.error || "Bulk update failed"); return; }
    setBulkOpen(false);
    clearSelection();
    loadProducts(page);
  };

  // ── Catalogue import ──────────────────────────────────────────────
  const openImport = () => {
    setImportOpen(true);
    setImportStep("upload");
    setImportFile(null);
    setImportSupplier("");
    setImportCategory("");
    setImportRows([]);
    setImportCostMode("catalogue");
    setImportCostDivisor("3");
    setImportJobId(null);
    setImportError("");
    setImportResult(null);
  };

  // When picking the import supplier, prefill its saved costing rule
  const onImportSupplierChange = (id) => {
    setImportSupplier(id);
    const sup = suppliers.find(s => String(s.id) === String(id));
    if (sup && sup.cost_divisor) {
      setImportCostMode("derive");
      setImportCostDivisor(String(sup.cost_divisor));
    } else {
      setImportCostMode("catalogue");
      setImportCostDivisor("3");
    }
  };

  // The divisor in effect for live cost calculation, or null when off
  const activeCostDivisor = importCostMode === "derive" && Number(importCostDivisor) > 0
    ? Number(importCostDivisor) : null;

  const pollJob = useCallback(async (jobId, supplierLabel) => {
    const headers = await authHeaders();
    const res = await fetch(`${API}/catalogue-import/${jobId}`, { headers });
    if (!res.ok) return;
    const { job } = await res.json();
    if (job.status === "processing") {
      setImportProgress({ pages_processed: job.pages_processed || 0, pages_total: job.pages_total || 0 });
      setTimeout(() => pollJob(jobId, supplierLabel), 3000);
    } else if (job.status === "review") {
      setImportProgress(null);
      setImportRows((job.catalogue_import_rows || []).map(r => ({ ...r, _action: r.action, supplier_name: r.supplier_name || supplierLabel || "" })));
      setImportStep("review");
    } else if (job.status === "failed") {
      setImportProgress(null);
      setImportError(job.error_message || "Processing failed");
      setImportStep("failed");
    }
  }, []);

  const uploadCatalogue = async () => {
    if (!importFile) return;
    setUploading(true);
    setImportError("");
    setImportProgress(null);
    setImportStep("processing");
    const token = await getToken();
    const fd = new FormData();
    fd.append("file", importFile);
    if (importSupplier) fd.append("supplier_id", importSupplier);
    if (importCategory) fd.append("category_id", importCategory);
    // "" tells the server to use the catalogue cost as-is (and clears any saved rule)
    fd.append("cost_divisor", importCostMode === "derive" ? importCostDivisor : "");
    const res = await fetch(`${API}/catalogue-import/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const d = await res.json();
    setUploading(false);
    if (!res.ok) { setImportError(d.error || "Upload failed"); setImportStep("upload"); return; }
    setImportJobId(d.job_id);
    const supplierLabel = importSupplier ? suppliers.find(s => s.id === importSupplier)?.name || "" : "";
    if (d.status === "review") {
      setImportRows((d.rows || []).map(r => ({ ...r, _action: r.action, supplier_name: r.supplier_name || supplierLabel })));
      setImportStep("review");
    } else if (d.status === "failed") {
      setImportError(d.error || "No products found in file");
      setImportStep("failed");
    } else {
      pollJob(d.job_id, supplierLabel);
    }
  };

  const updateImportRow = (idx, field, value) => {
    setImportRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const next = { ...r, [field]: value };
      // Keep cost in sync with price when costing is derived from the price
      if (field === "unit_price" && activeCostDivisor) {
        next.unit_cost = value == null ? null : Math.round((Number(value) / activeCostDivisor) * 100) / 100;
      }
      return next;
    }));
  };

  // Split a review row whose colour holds several options (e.g. "Natural / Walnut")
  // into one row per colour. Saves current edits first so nothing is lost.
  const splitReviewRow = async (row) => {
    const headers = await authHeaders();
    const rowEdits = importRows.map(r => ({
      id: r.id, product_code: r.product_code, product_name: r.product_name,
      color: r.color, size: r.size, is_customizable: r.is_customizable || false, supplier_name: r.supplier_name,
      unit_cost: r.unit_cost, unit_price: r.unit_price, action: r._action,
    }));
    await fetch(`${API}/catalogue-import/${importJobId}/rows`, { method: "PUT", headers, body: JSON.stringify({ rows: rowEdits }) });
    const res = await fetch(`${API}/catalogue-import/${importJobId}/rows/${row.id}/split`, { method: "POST", headers });
    const d = await res.json();
    if (res.ok && d.rows) setImportRows(d.rows.map(r => ({ ...r, _action: r.action })));
    else if (!res.ok) setImportError(d.error || "Failed to split row");
  };

  // Reload suppliers after upload so a newly-saved costing rule is reflected
  useEffect(() => { if (importStep === "review") loadSuppliers(); }, [importStep, loadSuppliers]);

  const commitImport = async () => {
    setCommitting(true);
    setImportError("");
    const headers = await authHeaders();
    // Save row edits first
    const rowEdits = importRows.map(r => ({
      id: r.id, product_code: r.product_code, product_name: r.product_name,
      color: r.color, size: r.size, is_customizable: r.is_customizable || false, supplier_name: r.supplier_name,
      unit_cost: r.unit_cost, unit_price: r.unit_price, action: r._action,
    }));
    await fetch(`${API}/catalogue-import/${importJobId}/rows`, {
      method: "PUT", headers, body: JSON.stringify({ rows: rowEdits }),
    });
    // Commit
    const res = await fetch(`${API}/catalogue-import/${importJobId}/commit`, { method: "POST", headers });
    const d = await res.json();
    setCommitting(false);
    if (!res.ok) { setImportError(d.error || "Commit failed"); return; }
    setImportResult(d);
    setImportStep("done");
    loadProducts(1);
  };

  // ── Pagination ────────────────────────────────────────────────────
  const totalPages = Math.ceil(total / 50);

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500">{total} product{total !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowReview(!showReview); if (!showReview) loadReviewQueue(); }}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${showReview ? "bg-amber-600 text-white" : "bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100"}`}>
            📋 Review Queue {reviewTotal > 0 ? `(${reviewTotal})` : ""}
          </button>
          <button onClick={openImport} className="px-4 py-2 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:border-violet-300 hover:text-violet-700 transition-colors">
            📄 Import Catalogue
          </button>
          <button onClick={openAdd} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors">
            + Add Product
          </button>
        </div>
      </div>

      {/* Product Review Queue */}
      {showReview && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-amber-800">Unmatched Legacy Products</h3>
              <p className="text-xs text-amber-600">{reviewQueue.length} unique products across {reviewTotal} order items need review</p>
            </div>
            <button onClick={() => setShowReview(false)} className="text-xs text-amber-600 hover:underline">Close</button>
          </div>
          {reviewLoading && <div className="py-4 text-center text-amber-600 text-xs">Loading...</div>}
          {!reviewLoading && reviewQueue.length === 0 && <p className="text-center text-amber-600 text-xs py-4">All products reviewed!</p>}
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {reviewQueue.map((g, gi) => {
              const key = `${g.product_code}|${g.product_name}`;
              return (
                <div key={gi} className="bg-white rounded-xl border border-gray-100 p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {g.product_code && <span className="text-xs font-mono text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">{g.product_code}</span>}
                        <span className="text-sm font-medium text-gray-900">{g.product_name || "Unnamed"}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {g.supplier_name && <span className="text-violet-600">{g.supplier_name} · </span>}
                        {g.size && `Size: ${g.size} · `}{g.color && `Color: ${g.color} · `}
                        {g.order_count} order{g.order_count !== 1 ? "s" : ""} · {g.total_qty} units
                        {g.sample_price > 0 && ` · RM ${g.sample_price}`}
                      </p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => createAndLink(g)} className="text-xs px-2 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700" title="Create product in master + link all items">+ Create</button>
                      <button onClick={() => dismissItems(g.item_ids)} className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200" title="Keep as custom, stop showing">Skip</button>
                    </div>
                  </div>
                  {/* Link to existing */}
                  <div className="flex gap-2">
                    <input value={linkSearch[key] || ""} onChange={e => searchForLink(key, e.target.value)}
                      placeholder="Search existing product to link..." className="flex-1 text-xs px-2 py-1 rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400" />
                  </div>
                  {(linkResults[key] || []).length > 0 && (
                    <div className="border border-gray-200 rounded-lg mt-1 max-h-24 overflow-y-auto">
                      {linkResults[key].map(p => (
                        <button key={p.id} onClick={() => { linkToProduct(g.item_ids, p.id); setLinkResults(prev => ({ ...prev, [key]: [] })); setLinkSearch(prev => ({ ...prev, [key]: "" })); }}
                          className="w-full text-left px-2 py-1 text-xs hover:bg-violet-50 flex items-center justify-between">
                          <span><span className="font-mono text-violet-700">{p.code}</span> {p.name} {p.size ? `· ${p.size}` : ""}</span>
                          <span className="text-emerald-600 font-medium">Link →</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search code or name…"
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm w-56 focus:outline-none focus:border-violet-400"
        />
        <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
          <option value="">All Suppliers</option>
          {supplierOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value)}
          className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
          <option value="all">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 bg-violet-50 border border-violet-200 rounded-xl px-4 py-2.5">
          <span className="text-sm font-medium text-violet-800">{selectedIds.size} selected</span>
          <div className="flex gap-2">
            <button onClick={openBulk} className="px-4 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors">
              Bulk Edit
            </button>
            <button onClick={bulkDelete} className="px-4 py-1.5 rounded-lg text-sm font-medium bg-white border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
              Delete
            </button>
            <button onClick={clearSelection} className="px-4 py-1.5 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3 w-10">
                <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAll}
                  title="Select all on this page" />
              </th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3 hidden lg:table-cell">Size</th>
              <th className="px-4 py-3 hidden md:table-cell">Supplier</th>
              <th className="px-4 py-3 hidden md:table-cell">Category</th>
              <th className="px-4 py-3 hidden lg:table-cell">Color</th>
              <th className="px-4 py-3 text-right">Cost</th>
              <th className="px-4 py-3 text-right">Price</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 hidden lg:table-cell">Scope</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && [1,2,3,4,5].map(i=><tr key={i} className="animate-pulse"><td className="px-4 py-3"><div className="h-3 bg-gray-200 rounded w-16" /></td><td className="px-4 py-3"><div className="h-3 bg-gray-200 rounded w-32" /></td><td className="px-4 py-3"><div className="h-3 bg-gray-100 rounded w-12" /></td><td className="px-4 py-3"><div className="h-3 bg-gray-100 rounded w-12" /></td><td className="px-4 py-3"><div className="h-3 bg-gray-200 rounded w-16" /></td><td className="px-4 py-3"><div className="h-3 bg-gray-100 rounded w-16" /></td><td colSpan={5} className="px-4 py-3"><div className="h-3 bg-gray-100 rounded w-20" /></td></tr>)}
            {!loading && products.length === 0 && <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400">No products found</td></tr>}
            {!loading && products.map(p => {
              const orgInfo = p.organization_product_id ? orgProductMap[p.organization_product_id] : null;
              const isShared = orgInfo?.isShared;
              return (
              <tr key={p.id} className={`border-b border-gray-50 hover:bg-violet-50/30 transition-colors cursor-pointer ${selectedIds.has(p.id) ? "bg-violet-50/50" : ""}`} onClick={() => openEdit(p)}>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-violet-700 font-medium">{p.code}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">{p.size || "—"}</td>
                <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{p.suppliers?.name || "—"}</td>
                <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{p.product_categories?.name || p.organization_categories?.name || "—"}</td>
                <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{p.color || "—"}</td>
                <td className="px-4 py-3 text-right text-gray-600">{p.unit_cost != null ? p.unit_cost.toFixed(2) : "—"}</td>
                <td className="px-4 py-3 text-right text-gray-900 font-medium">{p.unit_price != null ? p.unit_price.toFixed(2) : "—"}</td>
                <td className="px-4 py-3 text-center space-x-1">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${p.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                    {p.is_active ? "Active" : "Inactive"}
                  </span>
                  {p.is_customizable && <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Custom</span>}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell" onClick={e => e.stopPropagation()}>
                  {isShared ? (
                    <button onClick={() => openLinks(p.organization_product_id)}
                      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors">
                      Shared · {orgInfo.companyCount} companies
                    </button>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Single company</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={e => { e.stopPropagation(); toggleActive(p); }}
                    className="text-xs text-gray-400 hover:text-violet-600 transition-colors mr-3">
                    {p.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={e => { e.stopPropagation(); deleteProduct(p); }}
                    className="text-xs text-gray-400 hover:text-red-600 transition-colors">
                    Delete
                  </button>
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => loadProducts(page - 1)}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 disabled:opacity-40 hover:border-violet-300">← Prev</button>
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => loadProducts(page + 1)}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 disabled:opacity-40 hover:border-violet-300">Next →</button>
        </div>
      )}

      {/* ── Product Drawer (Add/Edit) ──────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl animate-slide-in">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-gray-900">{editId ? "Edit Product" : "Add Product"}</h2>
              <button onClick={() => setDrawerOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {formError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-xl">{formError}</div>}

              {/* Search-first step: only for catalogue-group companies when adding new products */}
              {!editId && orgProdStep === "pick" && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">Search the shared product catalogue to avoid creating duplicates. Pick an existing product or create a new one.</p>
                  <input
                    autoFocus
                    value={orgProdQuery}
                    onChange={e => searchOrgProducts(e.target.value)}
                    placeholder="Search by code or name…"
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400"
                  />
                  {orgProdSearching && <p className="text-xs text-gray-400">Searching…</p>}
                  {!orgProdSearching && orgProdQuery.trim() && orgProdResults.length === 0 && (
                    <p className="text-xs text-gray-400">No matching products found.</p>
                  )}
                  {orgProdResults.length > 0 && (
                    <div className="border border-gray-100 rounded-xl overflow-hidden divide-y divide-gray-50">
                      {orgProdResults.map(p => (
                        <button key={p.id} onClick={() => pickOrgProduct(p)}
                          className="w-full text-left px-4 py-3 hover:bg-violet-50 transition-colors">
                          <div className="text-sm font-medium text-gray-800">{p.name}</div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {[p.code, p.size, p.color].filter(Boolean).join(" · ")}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={createAsNew}
                    className="w-full py-2.5 rounded-xl text-sm font-medium border border-violet-300 text-violet-700 hover:bg-violet-50 transition-colors">
                    + Create as New Product
                  </button>
                </div>
              )}

              {/* Form step: normal fields, shown for edit or after search-pick */}
              {(editId || orgProdStep === "form") && (
                <div className="space-y-4">
                  {!editId && (
                    <button onClick={() => setOrgProdStep("pick")} className="text-xs text-violet-600 hover:underline flex items-center gap-1">
                      ← Back to search
                    </button>
                  )}
                  {selectedOrgProductId && (
                    <div className="bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 text-xs text-violet-700">
                      Linked to master: <span className="font-medium">{selectedOrgProductLabel}</span>
                    </div>
                  )}

              <Field label="Code *" value={form.code} onChange={v => setForm(f => ({ ...f, code: v }))} placeholder="e.g. SF-001" />
              <Field label="Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Product name" />
              <Field label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Optional" />
              <Field label="Color" value={form.color} onChange={v => setForm(f => ({ ...f, color: v }))} placeholder="e.g. Walnut Brown" />
              <Field label="Size / Variant" value={form.size} onChange={v => setForm(f => ({ ...f, size: v }))} placeholder="e.g. W1200 x D600 x H750mm (2 Drawers)" />

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Supplier</label>
                <select value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                  <option value="">None</option>
                  {supplierOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <div className="flex gap-1 mt-1">
                  <input value={newSupplier} onChange={e => setNewSupplier(e.target.value)} placeholder="New supplier…"
                    className="flex-1 px-2 py-1 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400" />
                  <button onClick={addSupplier} className="text-xs px-2 py-1 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200">Add</button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                  <option value="">None</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div className="flex gap-1 mt-1">
                  <input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="New category…"
                    className="flex-1 px-2 py-1 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400" />
                  <button onClick={addCategory} className="text-xs px-2 py-1 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200">Add</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Unit Cost" value={form.unit_cost} onChange={v => setForm(f => ({ ...f, unit_cost: v }))} type="number" placeholder="0.00" />
                <Field label="Unit Price" value={form.unit_price} onChange={v => setForm(f => ({ ...f, unit_price: v }))} type="number" placeholder="0.00" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Reorder Point" value={form.reorder_point} onChange={v => setForm(f => ({ ...f, reorder_point: v }))} type="number" placeholder="0" />
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Standard Item</label>
                  <button onClick={() => setForm(f => ({ ...f, is_standard: !f.is_standard }))}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${form.is_standard ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500"}`}>
                    {form.is_standard ? "Yes" : "No"}
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Customizable</label>
                  <button onClick={() => setForm(f => ({ ...f, is_customizable: !f.is_customizable }))}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${form.is_customizable ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-500"}`}>
                    {form.is_customizable ? "Yes" : "No"}
                  </button>
                </div>
              </div>

              <button onClick={saveProduct} disabled={saving}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editId ? "Update Product" : "Create Product"}
              </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Catalogue Import Drawer ────────────────────────────────── */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => !uploading && !committing && setImportOpen(false)} />
          <div className="relative w-full max-w-5xl bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-gray-900">Import Catalogue</h2>
              <button onClick={() => !uploading && !committing && setImportOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {importError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-xl">{importError}</div>}

              {/* Step: Upload */}
              {importStep === "upload" && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">Upload a supplier catalogue (PDF, image, or Excel file). We'll extract the products automatically.</p>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Supplier (optional)</label>
                    <select value={importSupplier} onChange={e => onImportSupplierChange(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                      <option value="">None</option>
                      {supplierOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Category (optional)</label>
                    <select value={importCategory} onChange={e => setImportCategory(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                      <option value="">None</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  {/* Costing rule */}
                  <div className="rounded-xl border border-gray-200 p-3 space-y-2 bg-gray-50/50">
                    <label className="block text-xs font-medium text-gray-500">Cost</label>
                    <select value={importCostMode} onChange={e => setImportCostMode(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                      <option value="catalogue">Use cost from catalogue</option>
                      <option value="derive">Calculate from price</option>
                    </select>
                    {importCostMode === "derive" && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <span>Cost = Price ÷</span>
                          <input type="number" min="0" step="any" value={importCostDivisor}
                            onChange={e => setImportCostDivisor(e.target.value)}
                            className="w-20 px-2 py-1 text-sm rounded-lg border border-gray-200 text-right focus:outline-none focus:border-violet-400" />
                        </div>
                        {activeCostDivisor && (
                          <p className="text-xs text-gray-400">e.g. price 2000 → cost {(2000 / activeCostDivisor).toFixed(2)}</p>
                        )}
                        {importSupplier && (
                          <p className="text-xs text-gray-400">Saved on this supplier for future imports.</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center hover:border-violet-300 transition-colors">
                    <input type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv" onChange={e => setImportFile(e.target.files[0])}
                      className="hidden" id="catalogue-file" />
                    <label htmlFor="catalogue-file" className="cursor-pointer">
                      <div className="text-3xl mb-2">📁</div>
                      <p className="text-sm font-medium text-gray-700">{importFile ? importFile.name : "Click to select file"}</p>
                      <p className="text-xs text-gray-400 mt-1">PDF, PNG, JPG, XLSX, CSV (max 20MB)</p>
                    </label>
                  </div>

                  <button onClick={uploadCatalogue} disabled={!importFile}
                    className="w-full py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
                    Upload & Parse
                  </button>
                </div>
              )}

              {/* Step: Processing */}
              {importStep === "processing" && (
                <div className="py-12 text-center">
                  <div className="animate-spin w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full mx-auto mb-4" />
                  <p className="text-sm text-gray-600">Parsing catalogue… This may take a moment for PDF/images.</p>
                  {importProgress && importProgress.pages_total > 0 && (
                    <div className="mt-4 max-w-xs mx-auto">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Batch {importProgress.pages_processed} of {importProgress.pages_total}</span>
                        <span>{Math.round((importProgress.pages_processed / importProgress.pages_total) * 100)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className="bg-violet-600 h-2 rounded-full transition-all" style={{ width: `${(importProgress.pages_processed / importProgress.pages_total) * 100}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step: Failed */}
              {importStep === "failed" && (
                <div className="py-8 text-center space-y-3">
                  <div className="text-4xl">⚠️</div>
                  <p className="text-lg font-bold text-gray-900">Processing Failed</p>
                  <p className="text-sm text-red-600">{importError}</p>
                  <p className="text-xs text-gray-400">For Excel/CSV: make sure the first row is column headers including at least a <strong>Code</strong> or <strong>Name</strong> (also recognised: Price, Cost, Color, Size, Supplier). For photos/PDFs: use a clear image that shows the product code, name and price.</p>
                  <button onClick={() => { setImportStep("upload"); setImportFile(null); setImportError(""); }}
                    className="mt-4 px-6 py-2.5 rounded-xl text-sm font-medium text-white hover:opacity-90 transition-opacity" style={{ background: "#7C3AED" }}>
                    Try Again
                  </button>
                </div>
              )}

              {/* Step: Review */}
              {importStep === "review" && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">{importRows.length} product{importRows.length !== 1 ? "s" : ""} found. Review and edit before committing.</p>
                  {activeCostDivisor && (
                    <div className="bg-violet-50 text-violet-700 text-xs px-3 py-2 rounded-xl">
                      Cost calculated as price ÷ {activeCostDivisor}. Editing a price updates its cost; you can still override any cost manually.
                    </div>
                  )}
                  <div className="overflow-x-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-left text-gray-500 uppercase tracking-wider">
                          <th className="px-3 py-2">Action</th>
                          <th className="px-3 py-2">Code</th>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Size / Variant</th>
                          <th className="px-3 py-2">Color</th>
                          <th className="px-3 py-2">Supplier</th>
                          <th className="px-3 py-2 text-center">
                            <label className="flex items-center justify-center gap-1 cursor-pointer">
                              <input type="checkbox"
                                checked={importRows.length > 0 && importRows.every(r => r.is_customizable)}
                                onChange={e => setImportRows(prev => prev.map(r => ({ ...r, is_customizable: e.target.checked })))}
                                className="rounded border-gray-300 text-amber-500 focus:ring-amber-400" />
                              <span>Custom</span>
                            </label>
                          </th>
                          <th className="px-3 py-2 text-right">Cost</th>
                          <th className="px-3 py-2 text-right">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.map((r, i) => (
                          <tr key={r.id || i} className={`border-t border-gray-50 ${r._action === "skip" ? "opacity-40" : ""}`}>
                            <td className="px-3 py-2">
                              <select value={r._action} onChange={e => updateImportRow(i, "_action", e.target.value)}
                                className={`text-xs px-2 py-1 rounded-lg border ${r._action === "import" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : r._action === "duplicate" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-gray-200 bg-gray-50 text-gray-500"}`}>
                                <option value="import">Import</option>
                                <option value="skip">Skip</option>
                                <option value="duplicate">Duplicate</option>
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input value={r.product_code || ""} onChange={e => updateImportRow(i, "product_code", e.target.value)}
                                className="w-24 px-2 py-1 text-xs rounded-lg border border-gray-200 font-mono focus:outline-none focus:border-violet-400" />
                            </td>
                            <td className="px-3 py-2">
                              <input value={r.product_name || ""} onChange={e => updateImportRow(i, "product_name", e.target.value)}
                                className="w-full min-w-[140px] px-2 py-1 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400" />
                            </td>
                            <td className="px-3 py-2">
                              <input value={r.size || ""} onChange={e => updateImportRow(i, "size", e.target.value)}
                                className="w-36 px-2 py-1 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400" />
                            </td>
                            <td className="px-3 py-2">
                              <input value={r.color || ""} onChange={e => updateImportRow(i, "color", e.target.value)}
                                className="w-24 px-2 py-1 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400" />
                              {r.id && (r.color || "").includes("/") && (
                                <button type="button" onClick={() => splitReviewRow(r)}
                                  title="Split this colour into separate product variants"
                                  className="block mt-1 text-[11px] text-violet-600 hover:text-violet-800">
                                  Split colours →
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <input value={r.supplier_name || ""} onChange={e => updateImportRow(i, "supplier_name", e.target.value)}
                                className="w-28 px-2 py-1 text-xs rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400" />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input type="checkbox" checked={r.is_customizable || false} onChange={e => updateImportRow(i, "is_customizable", e.target.checked)}
                                className="rounded border-gray-300 text-amber-500 focus:ring-amber-400" />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input value={r.unit_cost ?? ""} onChange={e => updateImportRow(i, "unit_cost", e.target.value === "" ? null : Number(e.target.value))}
                                type="number" className="w-20 px-2 py-1 text-xs rounded-lg border border-gray-200 text-right focus:outline-none focus:border-violet-400" />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input value={r.unit_price ?? ""} onChange={e => updateImportRow(i, "unit_price", e.target.value === "" ? null : Number(e.target.value))}
                                type="number" className="w-20 px-2 py-1 text-xs rounded-lg border border-gray-200 text-right focus:outline-none focus:border-violet-400" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => { setImportStep("upload"); setImportRows([]); }}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors">
                      ← Back
                    </button>
                    <button onClick={commitImport} disabled={committing || importRows.filter(r => r._action === "import").length === 0}
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
                      {committing ? "Committing…" : `Commit ${importRows.filter(r => r._action === "import").length} Products`}
                    </button>
                  </div>
                </div>
              )}

              {/* Step: Done */}
              {importStep === "done" && importResult && (
                <div className="py-8 text-center space-y-3">
                  <div className="text-4xl">✅</div>
                  <p className="text-lg font-bold text-gray-900">Import Complete</p>
                  <p className="text-sm text-gray-500">
                    {importResult.imported} imported, {importResult.skipped} skipped out of {importResult.total} total.
                  </p>
                  {importResult.errors?.length > 0 && (
                    <div className="mt-2 bg-red-50 rounded-xl p-3 text-left">
                      <p className="text-xs font-medium text-red-700 mb-1">Skip reasons:</p>
                      {importResult.errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
                    </div>
                  )}
                  <button onClick={() => setImportOpen(false)}
                    className="mt-4 px-6 py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 transition-colors">
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Edit Drawer ───────────────────────────────────────── */}
      {bulkOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => !bulkSaving && setBulkOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-gray-900">Bulk Edit</h2>
              <button onClick={() => !bulkSaving && setBulkOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {bulkError && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-xl">{bulkError}</div>}
              <p className="text-sm text-gray-500">Apply changes to <strong>{selectedIds.size}</strong> selected product{selectedIds.size !== 1 ? "s" : ""}. Only ticked fields are changed.</p>

              {/* Supplier */}
              <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={bulkForm.supplier} onChange={e => setBulkForm(f => ({ ...f, supplier: e.target.checked }))} />
                  Set supplier
                </label>
                {bulkForm.supplier && (
                  <select value={bulkForm.supplier_id} onChange={e => setBulkForm(f => ({ ...f, supplier_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                    <option value="">None</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </div>

              {/* Category */}
              <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={bulkForm.category} onChange={e => setBulkForm(f => ({ ...f, category: e.target.checked }))} />
                  Set category
                </label>
                {bulkForm.category && (
                  <select value={bulkForm.category_id} onChange={e => setBulkForm(f => ({ ...f, category_id: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                    <option value="">None</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>

              {/* Active status */}
              <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={bulkForm.active} onChange={e => setBulkForm(f => ({ ...f, active: e.target.checked }))} />
                  Set status
                </label>
                {bulkForm.active && (
                  <select value={bulkForm.is_active ? "true" : "false"} onChange={e => setBulkForm(f => ({ ...f, is_active: e.target.value === "true" }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:border-violet-400">
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                )}
              </div>

              {/* Set unit cost */}
              <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={bulkForm.setCost} onChange={e => setBulkForm(f => ({ ...f, setCost: e.target.checked }))} />
                  Set unit cost
                </label>
                {bulkForm.setCost && (
                  <input type="number" min="0" step="any" value={bulkForm.unit_cost} placeholder="Enter cost"
                    onChange={e => setBulkForm(f => ({ ...f, unit_cost: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                )}
              </div>

              {/* Set unit price */}
              <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={bulkForm.setPrice} onChange={e => setBulkForm(f => ({ ...f, setPrice: e.target.checked }))} />
                  Set unit price
                </label>
                {bulkForm.setPrice && (
                  <input type="number" min="0" step="any" value={bulkForm.unit_price} placeholder="Enter price"
                    onChange={e => setBulkForm(f => ({ ...f, unit_price: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
                )}
              </div>

              {/* Recalculate cost from price */}
              <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={bulkForm.cost} onChange={e => setBulkForm(f => ({ ...f, cost: e.target.checked }))} />
                  Recalculate cost from price
                </label>
                {bulkForm.cost && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span>Cost = Price ÷</span>
                      <input type="number" min="0" step="any" value={bulkForm.cost_divisor}
                        onChange={e => setBulkForm(f => ({ ...f, cost_divisor: e.target.value }))}
                        className="w-20 px-2 py-1 text-sm rounded-lg border border-gray-200 text-right focus:outline-none focus:border-violet-400" />
                    </div>
                    <p className="text-xs text-gray-400">Products without a price are left unchanged.</p>
                  </div>
                )}
              </div>

              <button onClick={applyBulk} disabled={bulkSaving}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
                {bulkSaving ? "Applying…" : `Apply to ${selectedIds.size} product${selectedIds.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Linked Companies Drawer — read-only organization product visibility */}
      {linksOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setLinksOpen(false)} />
          <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{linksData?.organizationProduct?.name || "Linked Companies"}</h2>
                <p className="text-xs text-gray-400">Organization product — read-only view</p>
              </div>
              <button onClick={() => setLinksOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-4 space-y-3">
              {linksLoading && <p className="text-sm text-gray-400 text-center py-8">Loading…</p>}
              {!linksLoading && (linksData?.companies || []).map(c => (
                <div key={c.productId} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 text-sm">{c.companyName || "Unknown company"}</span>
                    {c.isActive
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Active</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Product row: <span className="font-mono">{c.name}</span>{c.code ? ` (${c.code})` : ""}</p>
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

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
    </div>
  );
}
