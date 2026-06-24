import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth, supabase } from "./AuthContext";
import jsQR from "jsqr";

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

const TABS = ["Incoming DOs", "Generate Labels", "Scan & Assign", "Confirm Received"];

export default function WarehousePage() {
  const { user } = useAuth();
  const companyId = user?.company_id;
  const [tab, setTab] = useState(0);

  const [dos, setDos] = useState([]);
  const [selectedDO, setSelectedDO] = useState(null);
  const [labels, setLabels] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(false);

  // Label generation
  const [labelItems, setLabelItems] = useState([]);
  const [labelWarehouse, setLabelWarehouse] = useState("");

  // Scan
  const [scanCode, setScanCode] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scanningRef = useRef(false);

  const loadDOs = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const res = await fetch(`${API}/supplier-deliveries?company_id=${companyId}&limit=50`);
    const d = await res.json();
    setDos(d || []);
    setLoading(false);
  }, [companyId]);

  const loadWarehouses = useCallback(async () => {
    if (!companyId) return;
    const res = await fetch(`${API}/warehouses?company_id=${companyId}`);
    const d = await res.json();
    setWarehouses(d.warehouses || []);
  }, [companyId]);

  useEffect(() => { loadDOs(); loadWarehouses(); }, [loadDOs, loadWarehouses]);

  const selectDO = async (d) => {
    setSelectedDO(d);
    const res = await fetch(`${API}/supplier-deliveries/${d.id}`);
    const data = await res.json();
    const items = (data.items || []).map(it => ({ ...it, carton_count: 1 }));
    setLabelItems(items);
    // Load existing labels for this DO
    const lRes = await fetch(`${API}/package-labels?supplier_delivery_id=${d.id}`);
    const lData = await lRes.json();
    setLabels(lData.labels || []);
  };

  const generateLabels = async () => {
    if (!selectedDO) return;
    const headers = await authHeaders();
    const payload = {
      supplier_delivery_id: selectedDO.id,
      items: labelItems.map(it => ({
        product_code: it.item_code || it.product_code,
        product_name: it.item_name || it.product_name,
        so_number: it.so_number,
        carton_count: Number(it.carton_count) || 1,
        warehouse_id: labelWarehouse || null,
      })),
    };
    const res = await fetch(`${API}/package-labels/generate`, { method: "POST", headers, body: JSON.stringify(payload) });
    const d = await res.json();
    if (!res.ok) { alert(d.error || "Failed"); return; }
    // Print
    printLabels(d.labels || [], selectedDO);
    alert(`${d.count} labels generated`);
    selectDO(selectedDO); // reload labels
  };

  const printLabels = (lbls, doInfo) => {
    const labelHtml = lbls.map(l => `
      <div class="label">
        <div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(l.qr_code)}" /></div>
        <div class="info">
          <div class="code">${l.qr_code}</div>
          <div class="prod"><b>${l.product_code || ""}</b> ${l.product_name || ""}</div>
          ${l.so_number ? `<div class="so">SO: ${l.so_number}</div>` : ""}
          <div class="do">DO: ${doInfo?.do_number || ""} · ${doInfo?.supplier || ""}</div>
          <div class="carton">Carton ${l.carton_number} of ${l.total_cartons}</div>
          ${l.location_code ? `<div class="loc">📍 ${l.location_code}</div>` : ""}
          <div class="date">${new Date().toLocaleDateString("en-MY")}</div>
        </div>
      </div>
    `).join("");
    const w = window.open("", "_blank");
    if (!w) { alert("Allow pop-ups"); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Package Labels</title>
    <style>
      @page { size: A4; margin: 10mm; }
      body { font-family: Arial, sans-serif; font-size: 11px; margin: 0; padding: 10px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .label { border: 1.5px solid #333; border-radius: 8px; padding: 12px; display: flex; gap: 12px; align-items: center; page-break-inside: avoid; }
      .qr img { width: 100px; height: 100px; }
      .info { flex: 1; }
      .code { font-family: monospace; font-size: 10px; color: #7C3AED; margin-bottom: 4px; }
      .prod { font-size: 12px; font-weight: 700; margin-bottom: 2px; }
      .so, .do { font-size: 10px; color: #555; }
      .carton { font-size: 13px; font-weight: 900; margin-top: 4px; color: #111; }
      .loc { font-size: 11px; font-weight: 700; color: #7C3AED; margin-top: 2px; }
      .date { font-size: 9px; color: #999; margin-top: 2px; }
    </style></head><body><div class="grid">${labelHtml}</div></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const doScan = async () => {
    if (!scanCode.trim()) return;
    const res = await fetch(`${API}/package-labels/validate/${encodeURIComponent(scanCode.trim())}`);
    const d = await res.json();
    if (!res.ok) { setScanResult({ error: d.error || "Not found" }); return; }
    setScanResult(d.label);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } }
      });
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream;
      video.muted = true;

      // iOS requires waiting for loadedmetadata before play()
      await new Promise((resolve) => {
        video.onloadedmetadata = () => { video.play().then(resolve).catch(resolve); };
        setTimeout(resolve, 3000); // fallback timeout
      });

      setCameraActive(true);
      scanningRef.current = true;

      const scanFrame = () => {
        if (!scanningRef.current) return;
        try {
          const canvas = canvasRef.current;
          if (!canvas || !video || video.paused || video.ended) { requestAnimationFrame(scanFrame); return; }
          // Use clientWidth as fallback for iOS where videoWidth can be 0
          const w = video.videoWidth || video.clientWidth || 320;
          const h = video.videoHeight || video.clientHeight || 240;
          if (w < 50 || h < 50) { requestAnimationFrame(scanFrame); return; }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const code = jsQR(imageData.data, w, h, { inversionAttempts: "dontInvert" });
          if (code && code.data) {
            scanningRef.current = false;
            setScanCode(code.data);
            stopCamera();
            fetch(`${API}/package-labels/validate/${encodeURIComponent(code.data)}`)
              .then(r => r.json()).then(d => setScanResult(d.label || { error: d.error || "Not found" }));
            return;
          }
        } catch (e) { /* skip frame */ }
        requestAnimationFrame(scanFrame);
      };
      requestAnimationFrame(scanFrame);
    } catch (err) {
      alert("Camera error: " + (err.message || "Allow camera in Settings > Safari > Camera."));
    }
  };

  const stopCamera = () => {
    scanningRef.current = false;
    try {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
    } catch (e) { /* ignore */ }
    setCameraActive(false);
  };

  // Cleanup on tab switch or unmount
  useEffect(() => {
    if (tab !== 2) stopCamera();
    return () => { scanningRef.current = false; stopCamera(); };
  }, [tab]); // eslint-disable-line

  const confirmAllReceived = async () => {
    if (!selectedDO) return;
    if (!labelWarehouse) { alert("Select a warehouse first"); return; }
    if (!window.confirm(`Confirm all items received for DO #${selectedDO.do_number}? This will add items to stock.`)) return;
    const headers = await authHeaders();
    const res = await fetch(`${API}/package-labels/confirm-all`, { method: "POST", headers, body: JSON.stringify({ supplier_delivery_id: selectedDO.id, warehouse_id: labelWarehouse }) });
    const d = await res.json();
    if (!res.ok) { alert(d.error || "Failed"); return; }
    alert(`${d.confirmed} labels confirmed, ${d.stocked} products stocked`);
    selectDO(selectedDO);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Warehouse</h1>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(i)}
            className={`px-4 py-2 text-sm font-medium rounded-t-xl transition-colors whitespace-nowrap ${tab === i ? "bg-violet-600 text-white" : "text-gray-500 hover:text-violet-700 hover:bg-violet-50"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Incoming DOs */}
      {tab === 0 && (
        <div className="space-y-2">
          {loading && <div className="text-center text-gray-400 py-8">Loading…</div>}
          {!loading && dos.length === 0 && <div className="text-center text-gray-400 py-8">No supplier DOs</div>}
          {!loading && dos.map(d => (
            <div key={d.id} onClick={() => { selectDO(d); setTab(1); }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:border-violet-200 cursor-pointer transition-colors">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-sm text-violet-700 font-medium">{d.do_number || "-"}</span>
                  <span className="ml-2 text-sm text-gray-700 font-medium">{d.supplier || ""}</span>
                </div>
                <span className="text-xs text-gray-400">{d.do_date || ""}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Generate Labels */}
      {tab === 1 && (
        <div className="space-y-4">
          {!selectedDO ? (
            <div className="text-center text-gray-400 py-8">Select a DO from "Incoming DOs" first</div>
          ) : (
            <>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-gray-900">DO #{selectedDO.do_number}</h3>
                    <p className="text-sm text-gray-500">{selectedDO.supplier}</p>
                  </div>
                  <select value={labelWarehouse} onChange={e => setLabelWarehouse(e.target.value)}
                    className="px-3 py-1.5 rounded-xl border border-gray-200 text-sm bg-white">
                    <option value="">Select warehouse</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  {labelItems.map((it, i) => (
                    <div key={i} className="flex items-center gap-2 border border-gray-100 rounded-xl p-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{it.item_name || "-"}</p>
                        <p className="text-xs text-gray-400">{it.item_code || ""} {it.so_number ? `· SO: ${it.so_number}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500">Cartons:</span>
                        <input type="number" min="1" value={it.carton_count} onChange={e => {
                          const items = [...labelItems];
                          items[i] = { ...items[i], carton_count: Number(e.target.value) || 1 };
                          setLabelItems(items);
                        }} className="w-14 px-2 py-1 text-sm text-center rounded-lg border border-gray-200" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-gray-500">Total labels: {labelItems.reduce((s, it) => s + (Number(it.carton_count) || 1), 0)}</span>
                  <button onClick={generateLabels} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">🏷 Generate & Print</button>
                </div>
              </div>

              {/* Existing labels */}
              {labels.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-bold text-gray-700">Generated Labels ({labels.length})</h4>
                    <button onClick={() => printLabels(labels, selectedDO)} className="text-xs px-3 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">🖨 Reprint All</button>
                  </div>
                  <div className="space-y-1">
                    {labels.map(l => (
                      <div key={l.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                        <span className="font-mono text-violet-600">{l.qr_code}</span>
                        <span className="text-gray-700">{l.product_code} {l.product_name}</span>
                        <span className="text-gray-400">Carton {l.carton_number}/{l.total_cartons}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${l.status === "received" ? "bg-emerald-100 text-emerald-700" : l.status === "stored" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{l.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Scan & Assign */}
      {tab === 2 && (
        <div className="max-w-lg space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
            <h3 className="text-sm font-bold text-gray-700">Scan QR Code</h3>

            {/* Camera viewfinder — video always in DOM so ref is available */}
            <div className="relative rounded-xl overflow-hidden bg-black" style={{ aspectRatio: "4/3", minHeight: 240, display: cameraActive ? "block" : "none" }}>
              <video ref={videoRef} autoPlay playsInline muted
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              <canvas ref={canvasRef} style={{ display: "none" }} />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 border-2 border-violet-400 rounded-2xl" />
              </div>
              <button type="button" onTouchEnd={(e) => { e.preventDefault(); stopCamera(); }} onClick={stopCamera}
                className="absolute top-3 right-3 bg-black/70 text-white rounded-full flex items-center justify-center"
                style={{ width: 44, height: 44, fontSize: 18, zIndex: 10 }}>✕</button>
            </div>

            <div className="flex gap-2">
              <input value={scanCode} onChange={e => setScanCode(e.target.value)} placeholder="QR code (e.g. PKG-260625-A3F2)"
                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 text-sm font-mono focus:outline-none focus:border-violet-400"
                onKeyDown={e => e.key === "Enter" && doScan()} />
              {!cameraActive && (
                <button onClick={startCamera} className="px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 hover:bg-violet-100 hover:text-violet-700">📷</button>
              )}
              <button onClick={doScan} className="px-4 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700">Search</button>
            </div>
          </div>

          {scanResult && !scanResult.error && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-700">Package Found</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  scanResult.status === "received" ? "bg-emerald-100 text-emerald-700" :
                  scanResult.status === "stored" ? "bg-blue-100 text-blue-700" :
                  scanResult.status === "picked" ? "bg-indigo-100 text-indigo-700" :
                  scanResult.status === "delivered" ? "bg-gray-100 text-gray-500" :
                  "bg-amber-100 text-amber-700"
                }`}>{scanResult.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-gray-400">Product:</span> <b>{scanResult.product_code} {scanResult.product_name}</b></div>
                <div><span className="text-gray-400">Carton:</span> <b>{scanResult.carton_number}/{scanResult.total_cartons}</b></div>
                {scanResult.so_number && <div><span className="text-gray-400">SO:</span> <b>{scanResult.so_number}</b></div>}
                {scanResult.location_code && <div><span className="text-gray-400">Location:</span> <b className="text-violet-700">{scanResult.location_code}</b></div>}
              </div>

              {/* Assign warehouse + location */}
              {scanResult.status === "pending" && (
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <p className="text-xs font-bold text-gray-600">Assign Location & Confirm Receive</p>
                  <select value={scanResult._wh || ""} onChange={e => setScanResult(prev => ({ ...prev, _wh: e.target.value }))}
                    className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-sm bg-white">
                    <option value="">Select warehouse</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.type})</option>)}
                  </select>
                  <input value={scanResult._loc || ""} onChange={e => setScanResult(prev => ({ ...prev, _loc: e.target.value }))}
                    placeholder="Location code (e.g. A-03-02)" className="w-full px-3 py-1.5 rounded-xl border border-gray-200 text-sm" />
                  <button onClick={async () => {
                    const headers = await authHeaders();
                    if (scanResult._loc) {
                      await fetch(`${API}/package-labels/${scanResult.id}/assign-location`, {
                        method: "PATCH", headers, body: JSON.stringify({ location_code: scanResult._loc }),
                      });
                    }
                    await fetch(`${API}/package-labels/${scanResult.id}/scan`, { method: "PATCH", headers, body: JSON.stringify({ status: "received" }) });
                    // Stock in if warehouse selected and product exists
                    if (scanResult._wh && scanResult.product_id) {
                      await fetch(`${API}/inventory/adjust`, {
                        method: "POST", headers,
                        body: JSON.stringify({ warehouse_id: scanResult._wh, product_id: scanResult.product_id, quantity: 1, notes: `Received: ${scanResult.qr_code}` }),
                      });
                    }
                    setScanResult({ ...scanResult, status: "received", location_code: scanResult._loc || scanResult.location_code });
                    setScanCode("");
                  }} className="w-full py-2 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700">
                    ✓ Confirm Received{scanResult._wh ? " & Stock In" : ""}
                  </button>
                </div>
              )}

              {/* Actions for already received items */}
              <div className="flex gap-2 pt-2">
                {(scanResult.status === "received" || scanResult.status === "stored") && (
                  <button onClick={async () => {
                    const headers = await authHeaders();
                    await fetch(`${API}/package-labels/${scanResult.id}/scan`, { method: "PATCH", headers, body: JSON.stringify({ status: "picked" }) });
                    setScanResult({ ...scanResult, status: "picked" });
                  }} className="px-4 py-2 rounded-xl text-sm bg-blue-600 text-white hover:bg-blue-700">📦 Mark Picked</button>
                )}
                {scanResult.status !== "pending" && (
                  <button onClick={() => { setScanResult(null); setScanCode(""); if (!cameraActive) startCamera(); }}
                    className="px-4 py-2 rounded-xl text-sm bg-gray-100 text-gray-600 hover:bg-gray-200">Scan Next</button>
                )}
              </div>
            </div>
          )}

          {scanResult?.error && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">{scanResult.error}</div>
          )}
        </div>
      )}

      {/* Confirm Received */}
      {tab === 3 && (
        <div className="space-y-4">
          {!selectedDO ? (
            <div className="text-center text-gray-400 py-8">Select a DO from "Incoming DOs" first</div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4 max-w-lg">
              <h3 className="font-bold text-gray-900">Confirm All Received — DO #{selectedDO.do_number}</h3>
              <p className="text-sm text-gray-500">{selectedDO.supplier} · {labels.length} labels generated</p>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Destination Warehouse</label>
                <select value={labelWarehouse} onChange={e => setLabelWarehouse(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white">
                  <option value="">Select warehouse</option>
                  {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div className="text-xs text-gray-400">
                This will mark all {labels.filter(l => l.status === "pending").length} pending labels as "received" and add items to inventory stock.
              </div>
              <button onClick={confirmAllReceived} disabled={!labelWarehouse}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                ✓ Confirm All Received & Stock In
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
