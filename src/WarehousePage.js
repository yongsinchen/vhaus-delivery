import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast } from "./UIComponents";
let jsQR = null;

const API = "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { let { data } = await supabase.auth.getSession(); let s = data?.session; if (s?.expires_at && s.expires_at * 1000 < Date.now() + 60000) { const { data: r } = await supabase.auth.refreshSession(); s = r?.session || s; } return s?.access_token || ""; };
const authHeaders = async () => ({ "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}` });

const TABS = ["Receive DOs", "Scan & Store", "Pick List", "Loading"];
const DO_STATUS_STYLE = { Processed: "bg-gray-100 text-gray-600", Reviewed: "bg-blue-100 text-blue-700", Labeled: "bg-violet-100 text-violet-700", Completed: "bg-emerald-100 text-emerald-700" };
const PKG_STATUS = { pending: "bg-gray-100 text-gray-600", stored: "bg-blue-100 text-blue-700", picked: "bg-amber-100 text-amber-700", loaded: "bg-violet-100 text-violet-700", delivered: "bg-emerald-100 text-emerald-700" };

export default function WarehousePage() {
  const { user } = useAuth();
  const toast = useToast();
  const companyId = user?.company_id;
  const [tab, setTab] = useState(0);

  // Shared
  const [dos, setDos] = useState([]);
  const [selectedDO, setSelectedDO] = useState(null);
  const [labels, setLabels] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [labelItems, setLabelItems] = useState([]);
  const [labelWarehouse, setLabelWarehouse] = useState("");

  // Scan & Store — two-scan mode
  const [scanMode, setScanMode] = useState("item"); // "item" or "rack"
  const [pendingItem, setPendingItem] = useState(null); // item waiting for rack scan
  const pendingItemRef = useRef(null);
  const [scanMsg, setScanMsg] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scanningRef = useRef(false);
  const lastScannedRef = useRef(new Set());

  // Pick list
  const [pickItems, setPickItems] = useState([]);
  const [pickDays, setPickDays] = useState(3);
  const [pickLoading, setPickLoading] = useState(false);

  // Loading
  const [loadingItems, setLoadingItems] = useState([]);
  const [loadDate, setLoadDate] = useState(new Date().toISOString().slice(0, 10));
  const [loadRoute, setLoadRoute] = useState("");
  const [routes, setRoutes] = useState([]);

  // ── Data loading ──────────────────────────────────────────
  const loadDOs = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const token = await getToken();
    const res = await fetch(`${API}/supplier-deliveries?company_id=${companyId}&limit=50`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json();
    setDos(d || []);
    setLoading(false);
  }, [companyId]);

  const loadWarehouses = useCallback(async () => {
    if (!companyId) return;
    const token = await getToken();
    const res = await fetch(`${API}/warehouses?company_id=${companyId}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json();
    setWarehouses(d.warehouses || []);
  }, [companyId]);

  useEffect(() => { loadDOs(); loadWarehouses(); }, [loadDOs, loadWarehouses]);

  const selectDO = async (d) => {
    setSelectedDO(d);
    const headers = await authHeaders();
    const res = await fetch(`${API}/supplier-deliveries/${d.id}`, { headers });
    const data = await res.json();
    const items = (data.items || []).map(it => ({ ...it, carton_count: 1 }));
    setLabelItems(items);
    const lRes = await fetch(`${API}/package-labels?supplier_delivery_id=${d.id}`, { headers });
    const lData = await lRes.json();
    setLabels(lData.labels || []);
  };

  // ── Label generation ──────────────────────────────────────
  const generateLabels = async () => {
    if (!selectedDO) return;
    const headers = await authHeaders();
    const payload = { supplier_delivery_id: selectedDO.id, items: labelItems.map(it => ({ product_code: it.item_code || it.product_code, product_name: it.item_name || it.product_name, so_number: it.so_number, carton_count: Number(it.carton_count) || 1, warehouse_id: labelWarehouse || null })) };
    const res = await fetch(`${API}/packings/generate`, { method: "POST", headers, body: JSON.stringify(payload) });
    const d = await res.json();
    if (!res.ok) {
      if (d.error?.includes("already generated")) { toast.warning("Labels already generated — reprinting"); if (labels.length > 0) printLabels(labels, selectedDO); }
      else toast.error(d.error || "Failed");
      return;
    }
    printLabels(d.labels || [], selectedDO);
    toast.success(`${d.count} labels generated`);
    selectDO(selectedDO);
  };

  const printLabels = (lbls, doInfo) => {
    const html = lbls.map(l => `<div class="label"><div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(l.qr_code)}" /></div><div class="info"><div class="code">${l.qr_code}</div><div class="prod"><b>${l.product_code || ""}</b> ${l.product_name || ""}</div>${l.so_number ? `<div class="so">SO: ${l.so_number}</div>` : ""}<div class="do">DO: ${doInfo?.do_number || ""} · ${doInfo?.supplier || ""}</div><div class="carton">Carton ${l.carton_number} of ${l.total_cartons}</div>${l.location_code ? `<div class="loc">📍 ${l.location_code}</div>` : ""}<div class="date">${new Date().toLocaleDateString("en-MY")}</div></div></div>`).join("");
    const w = window.open("", "_blank");
    if (!w) { toast.warning("Allow pop-ups to print"); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Labels</title><style>@page{size:A4;margin:10mm}body{font-family:Arial,sans-serif;font-size:11px;margin:0;padding:10px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.label{border:1.5px solid #333;border-radius:8px;padding:12px;display:flex;gap:12px;align-items:center;page-break-inside:avoid}.qr img{width:100px;height:100px}.info{flex:1}.code{font-family:monospace;font-size:10px;color:#7C3AED;margin-bottom:4px}.prod{font-size:12px;font-weight:700;margin-bottom:2px}.so,.do{font-size:10px;color:#555}.carton{font-size:13px;font-weight:900;margin-top:4px;color:#111}.loc{font-size:11px;font-weight:700;color:#7C3AED;margin-top:2px}.date{font-size:9px;color:#999;margin-top:2px}</style></head><body><div class="grid">${html}</div></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
  };

  // ── Camera scanner ────────────────────────────────────────
  const startCamera = async () => {
    try {
      // Lazy load jsQR only when camera is needed
      if (!jsQR) { const mod = await import("jsqr"); jsQR = mod.default; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } } });
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream; video.muted = true;
      await new Promise(resolve => { video.onloadedmetadata = () => { video.play().then(resolve).catch(resolve); }; setTimeout(resolve, 3000); });
      setCameraActive(true); scanningRef.current = true;
      const scanFrame = () => {
        if (!scanningRef.current) return;
        try {
          const canvas = canvasRef.current;
          if (!canvas || !video || video.paused) { requestAnimationFrame(scanFrame); return; }
          const w = video.videoWidth || video.clientWidth || 320;
          const h = video.videoHeight || video.clientHeight || 240;
          if (w < 50) { requestAnimationFrame(scanFrame); return; }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, w, h);
          const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
          if (code?.data) {
            const qr = code.data;
            if (!lastScannedRef.current.has(qr)) {
              lastScannedRef.current.add(qr);
              handleQRScan(qr);
              setTimeout(() => lastScannedRef.current.delete(qr), 3000);
            }
          }
        } catch {}
        requestAnimationFrame(scanFrame);
      };
      requestAnimationFrame(scanFrame);
    } catch (err) { toast.error("Camera error: " + err.message); }
  };

  const stopCamera = () => { scanningRef.current = false; try { if (videoRef.current?.srcObject) { videoRef.current.srcObject.getTracks().forEach(t => t.stop()); videoRef.current.srcObject = null; } } catch {} setCameraActive(false); };
  useEffect(() => { if (tab !== 1 && tab !== 2 && tab !== 3) stopCamera(); return () => { scanningRef.current = false; stopCamera(); }; }, [tab]); // eslint-disable-line

  // ── Two-scan handler: item QR → rack QR ───────────────────
  const handleQRScan = async (qr) => {
    const headers = await authHeaders();
    if (tab === 1) {
      // Scan & Store — two-scan flow
      const pending = pendingItemRef.current;
      if (qr.startsWith("RACK-")) {
        if (!pending) { setScanMsg("⚠️ Scan an ITEM first, then the rack"); setTimeout(() => setScanMsg(""), 2000); return; }
        const res = await fetch(`${API}/packings/${pending.id}/put-away`, { method: "PATCH", headers, body: JSON.stringify({ rack_qr_code: qr }) });
        const d = await res.json();
        if (!res.ok) { setScanMsg(`❌ ${d.error || "Failed"}`); setTimeout(() => setScanMsg(""), 3000); return; }
        setScanMsg(`✅ ${pending._product_name || pending._product_code || "Item"} → ${d.location_code || qr}`);
        setTimeout(() => setScanMsg(""), 3000);
        pendingItemRef.current = null; setPendingItem(null); setScanMode("item");
      } else {
        const res = await fetch(`${API}/packings/validate/${encodeURIComponent(qr)}`, { headers });
        const d = await res.json();
        if (!d.packing) { setScanMsg(`❌ Not found: ${qr}`); setTimeout(() => setScanMsg(""), 2000); return; }
        const p = d.packing;
        if (p.status === "put_away" || p.status === "stored") { setScanMsg(`⏭ Already stored at ${p.location_code || "unknown"}`); setTimeout(() => setScanMsg(""), 2000); return; }
        pendingItemRef.current = p; setPendingItem(p); setScanMode("rack");
        setScanMsg(`📦 ${p._product_name || p._product_code || qr} — Now scan the RACK`);
      }
    } else if (tab === 2) {
      // Pick — scan to pick
      const res = await fetch(`${API}/packings/validate/${encodeURIComponent(qr)}`, { headers });
      const d = await res.json();
      if (!d.packing) { setScanMsg(`❌ Not found: ${qr}`); setTimeout(() => setScanMsg(""), 2000); return; }
      const p = d.packing;
      if (p.status === "picked" || p.status === "loaded") { setScanMsg(`⏭ Already ${p.status}`); setTimeout(() => setScanMsg(""), 2000); return; }
      if (p.status !== "put_away" && p.status !== "stored") { setScanMsg(`⚠️ Not stored yet (${p.status})`); setTimeout(() => setScanMsg(""), 2000); return; }
      await fetch(`${API}/packings/${p.id}/pick`, { method: "PATCH", headers });
      setScanMsg(`✅ Picked: ${p._product_name || qr} from ${p.location_code || ""}`);
      setTimeout(() => setScanMsg(""), 3000);
      setPickItems(prev => prev.map(i => i.id === p.id || i.qr_code === p.qr_code ? { ...i, status: "picked" } : i));
    } else if (tab === 3) {
      // Load — scan to load + validate team
      const res = await fetch(`${API}/packings/validate/${encodeURIComponent(qr)}`, { headers });
      const d = await res.json();
      if (!d.packing) { setScanMsg(`❌ Not found: ${qr}`); setTimeout(() => setScanMsg(""), 2000); return; }
      const p = d.packing;
      if (p.status === "loaded") { setScanMsg(`⏭ Already loaded`); setTimeout(() => setScanMsg(""), 2000); return; }
      if (p.status !== "picked") { setScanMsg(`⚠️ Not picked yet (${p.status})`); setTimeout(() => setScanMsg(""), 2000); return; }
      const lRes = await fetch(`${API}/packings/${p.id}/load`, { method: "PATCH", headers, body: JSON.stringify({ team_id: loadRoute || null }) });
      const lData = await lRes.json();
      if (lData.warning) { setScanMsg(`⚠️ ${lData.warning}`); setTimeout(() => setScanMsg(""), 4000); }
      else { setScanMsg(`✅ Loaded: ${p._product_name || qr}`); setTimeout(() => setScanMsg(""), 3000); }
      setLoadingItems(prev => prev.map(i => i.id === p.id || i.qr_code === p.qr_code ? { ...i, status: "loaded" } : i));
    }
  };

  // ── Pick list loader ──────────────────────────────────────
  const printPickList = () => {
    // Group by date → then by SO within each date
    const byDate = {};
    for (const item of pickItems) {
      const date = item._delivery_date || "No Date";
      const so = item._so_number || item.so_number || "Unknown";
      if (!byDate[date]) byDate[date] = {};
      if (!byDate[date][so]) byDate[date][so] = { customer: item._customer || item.customer_name || "", items: [] };
      byDate[date][so].items.push(item);
    }
    const sortedDates = Object.keys(byDate).sort();
    let html = "";
    for (const date of sortedDates) {
      const dayLabel = date !== "No Date" ? new Date(date + "T00:00").toLocaleDateString("en-MY", { weekday: "long", year: "numeric", month: "short", day: "numeric" }) : "No Date";
      const soEntries = Object.entries(byDate[date]);
      const dayItemCount = soEntries.reduce((s, [, g]) => s + g.items.length, 0);
      html += `<tr><td colspan="6" style="background:#7C3AED;color:#fff;padding:8px 10px;font-weight:700;font-size:13px">${dayLabel} — ${soEntries.length} orders · ${dayItemCount} items</td></tr>`;
      for (const [so, g] of soEntries) {
        html += g.items.map((item, i) =>
          `<tr style="${i % 2 ? "background:#f9f9f9" : ""}">
            ${i === 0 ? `<td rowspan="${g.items.length}" style="border:1px solid #ddd;padding:6px 8px;vertical-align:top;font-weight:700;background:#FAFAFE">${so}<br><span style="font-weight:400;font-size:11px;color:#666">${g.customer}</span></td>` : ""}
            <td style="border:1px solid #ddd;padding:6px 8px">${item._product_code || item.product_code || ""}</td>
            <td style="border:1px solid #ddd;padding:6px 8px">${item._product_name || item.product_name || ""}</td>
            <td style="border:1px solid #ddd;padding:6px 8px;text-align:center;font-family:monospace;font-weight:700;color:#7C3AED">${item.location_code || "-"}</td>
            <td style="border:1px solid #ddd;padding:6px 8px;text-align:center;font-size:9px;color:#999">${item.qr_code || "-"}</td>
            <td style="border:1px solid #ddd;padding:6px 8px;text-align:center;width:36px;font-size:16px">☐</td>
          </tr>`
        ).join("");
      }
    }
    const w = window.open("", "_blank");
    if (!w) { toast.warning("Allow pop-ups to print"); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pick List</title>
    <style>@page{size:A4 landscape;margin:8mm}body{font-family:Arial,sans-serif;font-size:12px;margin:0;padding:12px}
    h1{font-size:18px;margin:0 0 3px}h2{font-size:12px;color:#666;margin:0 0 10px;font-weight:400}
    table{border-collapse:collapse;width:100%}th{background:#4C1D95;color:#fff;padding:7px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px}
    td{font-size:11px}</style></head>
    <body><h1>🏭 Pick List</h1><h2>Printed ${new Date().toLocaleDateString("en-MY")} · ${pickItems.length} total items · Next ${pickDays} day${pickDays > 1 ? "s" : ""}</h2>
    <table><thead><tr><th>SO / Customer</th><th>Code</th><th>Product</th><th>Location</th><th>QR</th><th style="text-align:center">✓</th></tr></thead><tbody>${html}</tbody></table></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 500);
  };

  const loadPickList = async () => {
    if (!companyId) return;
    setPickLoading(true);
    const headers = await authHeaders();
    const res = await fetch(`${API}/unified-pick-list?company_id=${companyId}&days=${pickDays}`, { headers });
    const d = await res.json();
    setPickItems(d.items || []);
    setPickLoading(false);
  };

  // ── Loading list loader ───────────────────────────────────
  const loadLoadingList = async () => {
    if (!companyId) return;
    const headers = await authHeaders();
    // Load teams for the date
    const rRes = await fetch(`${API}/delivery-teams?company_id=${companyId}&date=${loadDate}`, { headers });
    const rData = await rRes.json();
    setRoutes(rData.teams || []);
    // Load items
    const params = new URLSearchParams({ date: loadDate });
    if (loadRoute) params.set("team_id", loadRoute);
    const res = await fetch(`${API}/unified-loading-list?${params}`, { headers });
    const d = await res.json();
    setLoadingItems(d.items || []);
  };

  useEffect(() => { if (tab === 2) loadPickList(); }, [tab, pickDays]); // eslint-disable-line
  useEffect(() => { if (tab === 3) loadLoadingList(); }, [tab, loadDate, loadRoute]); // eslint-disable-line

  // ── Camera UI (rendered inline, not as component, to keep ref stable) ──
  const cameraUI = (
    <>
      <div className="relative rounded-xl overflow-hidden bg-black" style={{ aspectRatio: "4/3", minHeight: 200, display: cameraActive ? "block" : "none" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className={`w-48 h-48 border-2 rounded-2xl ${scanMode === "rack" ? "border-amber-400" : "border-violet-400"}`} />
        </div>
        {scanMode === "rack" && <div className="absolute top-3 left-3 bg-amber-500 text-white px-3 py-1 rounded-full text-xs font-bold">Scan RACK QR now</div>}
        <button type="button" onTouchEnd={e => { e.preventDefault(); stopCamera(); }} onClick={stopCamera}
          className="absolute top-3 right-3 bg-black/70 text-white rounded-full flex items-center justify-center" style={{ width: 44, height: 44, fontSize: 18, zIndex: 10 }}>✕</button>
        {scanMsg && <div className="absolute bottom-3 left-3 right-3 bg-black/80 text-white text-sm px-3 py-2 rounded-xl text-center">{scanMsg}</div>}
      </div>
      {!cameraActive && scanMsg && (
        <div className={`text-sm px-3 py-2 rounded-xl text-center ${scanMsg.startsWith("✅") ? "bg-emerald-50 text-emerald-700" : scanMsg.startsWith("⚠️") || scanMsg.startsWith("⏭") || scanMsg.startsWith("📦") ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{scanMsg}</div>
      )}
      {!cameraActive && <button onClick={startCamera} className="w-full py-3 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">📷 Open Camera</button>}
    </>
  );

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Warehouse</h1>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)} className={`px-4 py-2 text-sm font-medium rounded-t-xl transition-colors whitespace-nowrap ${tab === i ? "bg-violet-600 text-white" : "text-gray-500 hover:text-violet-700 hover:bg-violet-50"}`}>{t}</button>
        ))}
      </div>

      {/* ═══ TAB 0: Receive DOs ═══ */}
      {tab === 0 && (
        <div className="space-y-3">
          {loading && <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />)}</div>}
          {!loading && dos.filter(d => ["Reviewed", "Labeled"].includes(d.status)).length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <div className="text-3xl mb-2">📦</div>
              <p className="font-medium">No DOs ready for receiving</p>
              <p className="text-xs mt-1">DOs appear here after office admin finishes reviewing</p>
              {dos.filter(d => d.status === "Processed").length > 0 && <p className="text-xs text-amber-600 mt-2">{dos.filter(d => d.status === "Processed").length} DO(s) still being reviewed by office</p>}
            </div>
          )}
          {!loading && dos.filter(d => ["Reviewed", "Labeled", "Completed"].includes(d.status)).map(d => (
            <div key={d.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${selectedDO?.id === d.id ? "border-violet-300 ring-2 ring-violet-100" : "border-gray-100"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-violet-700 font-medium">{d.do_number || "-"}</span>
                  <span className="text-sm text-gray-700">{d.supplier || ""}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${DO_STATUS_STYLE[d.status] || "bg-gray-100"}`}>{d.status}</span>
                </div>
                <span className="text-xs text-gray-400">{d.do_date || ""}</span>
              </div>
              {d.status === "Reviewed" && <button onClick={() => selectDO(d)} className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700">🏷 Generate Labels</button>}
              {d.status === "Labeled" && (
                <div className="flex gap-2">
                  <button onClick={() => selectDO(d)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">View Labels</button>
                  <button onClick={() => { selectDO(d); setTab(1); }} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">📷 Scan & Store</button>
                </div>
              )}
              {d.status === "Completed" && <div className="text-xs text-emerald-600 font-medium">✓ All items received & stored</div>}

              {/* Expanded: label generation */}
              {selectedDO?.id === d.id && d.status === "Reviewed" && (
                <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                  <select value={labelWarehouse} onChange={e => setLabelWarehouse(e.target.value)} className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-sm bg-white">
                    <option value="">Select warehouse</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  {labelItems.map((it, i) => (
                    <div key={i} className="flex items-center gap-2 border border-gray-50 rounded-lg p-2">
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-900 truncate">{it.item_name || "-"}</p></div>
                      <span className="text-xs text-gray-500">Cartons:</span>
                      <input type="number" min="1" value={it.carton_count} onChange={e => { const items = [...labelItems]; items[i] = { ...items[i], carton_count: Number(e.target.value) || 1 }; setLabelItems(items); }} className="w-14 px-2 py-1 text-sm text-center rounded-lg border border-gray-200" />
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Total: {labelItems.reduce((s, it) => s + (Number(it.carton_count) || 1), 0)} labels</span>
                    <button onClick={generateLabels} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">🏷 Generate & Print</button>
                  </div>
                </div>
              )}

              {/* Existing labels */}
              {selectedDO?.id === d.id && labels.length > 0 && d.status !== "Reviewed" && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-gray-600">{labels.length} Labels</span>
                    <button onClick={() => printLabels(labels, selectedDO)} className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">🖨 Reprint</button>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {labels.map(l => (
                      <div key={l.id} className="flex items-center justify-between text-xs py-1">
                        <span className="font-mono text-violet-600">{l.qr_code}</span>
                        <span className="text-gray-600 truncate mx-2">{l.product_name}</span>
                        <span className={`px-1.5 py-0.5 rounded-full ${PKG_STATUS[l.status] || "bg-gray-100"}`}>{l.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ═══ TAB 1: Scan & Store (two-scan: item → rack) ═══ */}
      {tab === 1 && (
        <div className="max-w-lg space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-700">Scan & Store</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${scanMode === "rack" ? "bg-amber-100 text-amber-700" : "bg-violet-100 text-violet-700"}`}>
                {scanMode === "rack" ? "Waiting for RACK QR" : "Scan ITEM QR"}
              </span>
            </div>
            <p className="text-xs text-gray-500">Scan item QR → then scan rack QR → item stored at that location. Repeat.</p>
            {pendingItem && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs text-amber-700 font-bold">Pending: scan the RACK where you're placing this item</p>
                <p className="text-sm font-medium text-gray-900">{pendingItem.product_code} {pendingItem.product_name}</p>
                <p className="text-xs text-gray-500">Carton {pendingItem.carton_number}/{pendingItem.total_cartons}</p>
                <button onClick={() => { pendingItemRef.current = null; setPendingItem(null); setScanMode("item"); setScanMsg(""); }} className="text-xs text-gray-500 underline mt-1">Cancel</button>
              </div>
            )}
            {cameraUI}
          </div>
        </div>
      )}

      {/* ═══ TAB 2: Pick List ═══ */}
      {tab === 2 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <select value={pickDays} onChange={e => setPickDays(Number(e.target.value))} className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
              <option value={1}>Tomorrow</option>
              <option value={2}>Next 2 days</option>
              <option value={3}>Next 3 days</option>
              <option value={7}>Next 7 days</option>
            </select>
            <button onClick={loadPickList} className="px-4 py-2 rounded-xl text-sm bg-violet-600 text-white hover:bg-violet-700">Refresh</button>
            {pickItems.length > 0 && <button onClick={() => printPickList()} className="px-4 py-2 rounded-xl text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">🖨 Print Pick List</button>}
            <span className="text-xs text-gray-500">{pickItems.filter(p => p.status === "put_away" || p.status === "stored" || p.status === "no_package").length} to pick · {pickItems.filter(p => p.status === "picked").length} picked</span>
          </div>

          {/* Camera for pick scanning */}
          <div className="max-w-lg">
            {cameraUI}
          </div>

          {pickLoading && <div className="text-center text-gray-400 py-8">Loading pick list…</div>}
          {!pickLoading && pickItems.length === 0 && <div className="text-center py-8 text-gray-400"><div className="text-3xl mb-2">📋</div><p>No items to pick for upcoming deliveries</p></div>}
          {!pickLoading && pickItems.length > 0 && (() => {
            // Group by date → SO
            const byDate = {};
            for (const item of pickItems) {
              const d = item._delivery_date || "No Date";
              if (!byDate[d]) byDate[d] = {};
              const so = item._so_number || item.so_number || "?";
              if (!byDate[d][so]) byDate[d][so] = { customer: item._customer || item.customer_name || "", items: [] };
              byDate[d][so].items.push(item);
            }
            return Object.keys(byDate).sort().map(date => (
              <div key={date} className="space-y-2">
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs font-bold text-white bg-violet-600 px-3 py-1 rounded-full">{date !== "No Date" ? new Date(date + "T00:00").toLocaleDateString("en-MY", { weekday: "short", month: "short", day: "numeric" }) : "No Date"}</span>
                  <span className="text-xs text-gray-400">{Object.keys(byDate[date]).length} orders</span>
                </div>
                {Object.entries(byDate[date]).map(([so, g]) => (
                  <div key={so} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                      <div><span className="text-sm font-bold text-violet-700">{so}</span><span className="text-sm text-gray-600 ml-2">{g.customer}</span></div>
                      <span className="text-xs text-gray-400">{g.items.length} item{g.items.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {g.items.map(item => (
                        <div key={item.id} className={`flex items-center justify-between px-4 py-2.5 ${item.status === "picked" ? "opacity-40" : item.status === "no_package" ? "bg-amber-50/50" : ""}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">{item._product_code || item.product_code || ""} {item._product_name || item.product_name || ""}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {item.location_code && <span className="text-xs font-mono font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-lg">{item.location_code}</span>}
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.status === "no_package" ? "bg-amber-100 text-amber-700" : PKG_STATUS[item.status] || "bg-gray-100"}`}>{item.status === "no_package" ? "No QR" : item.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ));
          })()}
        </div>
      )}

      {/* ═══ TAB 3: Loading ═══ */}
      {tab === 3 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" value={loadDate} onChange={e => setLoadDate(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm" />
            <select value={loadRoute} onChange={e => setLoadRoute(e.target.value)} className="px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
              <option value="">All routes</option>
              {routes.map(r => <option key={r.id} value={r.id}>{r.delivery_vehicles?.vehicle_plate || r.driver_name || `Team ${String(r.id).slice(0,6)}`}</option>)}
            </select>
            <button onClick={loadLoadingList} className="px-4 py-2 rounded-xl text-sm bg-violet-600 text-white hover:bg-violet-700">Refresh</button>
          </div>

          {/* Progress */}
          {loadingItems.length > 0 && (() => {
            const loaded = loadingItems.filter(i => i.status === "loaded").length;
            const total = loadingItems.length;
            return (
              <div className={`rounded-2xl p-4 text-center ${loaded === total ? "bg-emerald-50 border-2 border-emerald-200" : "bg-white border border-gray-100"}`}>
                {loaded === total ? (
                  <><div className="text-3xl mb-1">✅</div><p className="font-bold text-emerald-700">Fully loaded — ready to go!</p></>
                ) : (
                  <><p className="text-sm text-gray-700 font-medium">{loaded}/{total} items loaded</p>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-2"><div className="bg-violet-600 h-2 rounded-full transition-all" style={{ width: `${(loaded/total)*100}%` }} /></div></>
                )}
              </div>
            );
          })()}

          {/* Camera for load scanning */}
          <div className="max-w-lg">
            {cameraUI}
          </div>

          {loadingItems.length === 0 && <div className="text-center py-8 text-gray-400"><div className="text-3xl mb-2">🚛</div><p>No items to load for this date/route</p></div>}
          {loadingItems.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
              {loadingItems.map(item => (
                <div key={item.id} className={`flex items-center justify-between px-4 py-3 ${item.status === "loaded" ? "opacity-50" : ""}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{item._product_code || item.product_code || ""} {item._product_name || item.product_name || ""}</p>
                    <p className="text-xs text-gray-500">
                      {(item._customer || item.customer_name) && <span className="text-violet-600">{item._customer || item.customer_name} · </span>}
                      SO: {item._so_number || item.so_number || ""} {item.carton_number ? `· Carton ${item.carton_number}/${item.total_cartons}` : ""}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${PKG_STATUS[item.status] || "bg-gray-100"}`}>{item.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
