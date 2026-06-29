import React, { useState, useEffect, useCallback } from "react";
import { useAuth, supabase } from "./AuthContext";
import { useToast } from "./UIComponents";

const API = "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); const cid = localStorage.getItem("pulseActiveCompanyId"); return fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } }); };

const STATUS_STYLE = {
  scheduled: { bg: "bg-gray-100", text: "text-gray-600", label: "Scheduled" },
  Confirmed: { bg: "bg-blue-100", text: "text-blue-700", label: "Confirmed" },
  "Out for Delivery": { bg: "bg-indigo-100", text: "text-indigo-700", label: "On the Way" },
  arrived: { bg: "bg-amber-100", text: "text-amber-700", label: "Arrived" },
  delivered: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Delivered" },
};

const PAYMENT_METHODS = ["Cash", "Bank Transfer", "QR Pay", "Credit Card", "Touch n Go"];

export default function DriverPage() {
  useAuth();
  const toast = useToast();
  const [date] = useState(new Date().toISOString().slice(0, 10));
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedStop, setExpandedStop] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  // Payment modal
  const [payModal, setPayModal] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payRef, setPayRef] = useState("");

  const loadRoute = useCallback(async () => {
    setLoading(true);
    try {
      const res = await af(`${API}/driver/my-route?date=${date}`);
      const d = await res.json();
      setTeams(d.teams || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [date]);

  useEffect(() => { loadRoute(); }, [loadRoute]);

  const updateStatus = async (scheduleId, status) => {
    setActionLoading(scheduleId);
    const res = await af(`${API}/driver/schedule/${scheduleId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const d = await res.json();
    if (d.schedule) {
      toast.success(status === "delivered" ? "Delivery completed!" : `Status: ${status}`);
      loadRoute();
    } else { toast.error(d.error || "Failed"); }
    setActionLoading(null);
  };

  const uploadPhoto = async (scheduleId, file) => {
    setActionLoading(scheduleId);
    const fd = new FormData();
    fd.append("photo", file);
    const token = await getToken();
    const res = await fetch(`${API}/driver/schedule/${scheduleId}/photo`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    const d = await res.json();
    if (d.url) { toast.success("Photo uploaded"); loadRoute(); }
    else toast.error(d.error || "Upload failed");
    setActionLoading(null);
  };

  const submitPayment = async () => {
    if (!payModal || !payAmount) return;
    setActionLoading(payModal);
    const res = await af(`${API}/driver/schedule/${payModal}/payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: Number(payAmount), method: payMethod, reference_no: payRef || null }) });
    const d = await res.json();
    if (d.ok) { toast.success(`RM ${payAmount} recorded. Balance: RM ${d.new_balance}`); setPayModal(null); setPayAmount(""); setPayRef(""); loadRoute(); }
    else toast.error(d.error || "Failed");
    setActionLoading(null);
  };

  const allSchedules = teams.flatMap(t => (t.schedules || []).map(s => ({ ...s, _vehicle: t.vehicle_plate, _driver: t.driver_name })));
  const delivered = allSchedules.filter(s => s.status === "delivered").length;
  const total = allSchedules.length;
  const parseItems = items => { try { return typeof items === "string" ? JSON.parse(items || "[]") : (items || []); } catch { return []; } };

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Header */}
      <div className="bg-violet-600 text-white px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Today's Route</h1>
            <p className="text-xs text-violet-200">{new Date(date).toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{delivered}/{total}</p>
            <p className="text-xs text-violet-200">delivered</p>
          </div>
        </div>
        {total > 0 && (
          <div className="w-full bg-violet-800 rounded-full h-2 mt-3">
            <div className="bg-white h-2 rounded-full transition-all" style={{ width: `${total > 0 ? (delivered / total) * 100 : 0}%` }} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 py-4 space-y-3 pb-24">
        {loading && <div className="text-center text-gray-400 py-12">Loading route...</div>}

        {!loading && total === 0 && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🚛</div>
            <p className="text-lg font-bold text-gray-700">No deliveries today</p>
            <p className="text-sm text-gray-400 mt-1">Check back later or contact your manager</p>
          </div>
        )}

        {!loading && allSchedules.map((sc, i) => {
          const o = sc.orders || {};
          const items = parseItems(o.items);
          const st = STATUS_STYLE[sc.status] || STATUS_STYLE.scheduled;
          const isExpanded = expandedStop === sc.id;
          const hasBalance = parseFloat(o.balance) > 0;
          const isDone = sc.status === "delivered";

          return (
            <div key={sc.id} className={`bg-white rounded-2xl shadow-sm border overflow-hidden transition-all ${isDone ? "opacity-50 border-emerald-200" : "border-gray-100"}`}>
              {/* Stop header */}
              <div className="p-4 cursor-pointer" onClick={() => setExpandedStop(isExpanded ? null : sc.id)}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0 ${isDone ? "bg-emerald-100 text-emerald-600" : "bg-violet-100 text-violet-700"}`}>
                    {isDone ? "✓" : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900">{o.so_number || "-"}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>{st.label}</span>
                    </div>
                    <p className="text-sm text-gray-700 font-medium">{o.customer_name || "-"}</p>
                    {o.contact && <p className="text-xs text-gray-500">{o.contact}</p>}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {hasBalance && <p className="text-sm font-bold text-red-600">RM {o.balance}</p>}
                    {sc.slot && <p className="text-xs text-violet-600 font-medium">{sc.slot}</p>}
                    <span className="text-gray-300">{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-gray-100 p-4 space-y-3">
                  {/* Address */}
                  {o.address && (
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}`} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700 font-medium">
                      <span className="text-lg">📍</span>
                      <span className="flex-1">{o.address}</span>
                      <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg flex-shrink-0">Navigate</span>
                    </a>
                  )}

                  {/* Contact */}
                  {o.contact && (
                    <a href={`tel:${o.contact}`} className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700 font-medium">
                      <span className="text-lg">📞</span>
                      <span>{o.contact}</span>
                      <span className="text-xs bg-emerald-600 text-white px-2 py-1 rounded-lg flex-shrink-0 ml-auto">Call</span>
                    </a>
                  )}

                  {/* Items */}
                  {items.length > 0 && (
                    <div className="bg-gray-50 rounded-xl p-3">
                      <p className="text-xs font-bold text-gray-500 mb-2">ITEMS ({items.length})</p>
                      {items.map((item, j) => (
                        <div key={j} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                          <span className="text-gray-800">{item.itemCode ? `[${item.itemCode}] ` : ""}{item.itemName || "-"}</span>
                          <span className="text-gray-400 text-xs">x{item.unit || 1}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Remark */}
                  {o.remark && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                      <span className="font-bold">Note: </span>{o.remark}
                    </div>
                  )}

                  {/* Delivery photo */}
                  {o.photo_url && (
                    <div className="rounded-xl overflow-hidden border border-gray-200">
                      <img src={o.photo_url} alt="Delivery proof" className="w-full max-h-48 object-cover" />
                    </div>
                  )}

                  {/* Action buttons */}
                  {!isDone && (
                    <div className="space-y-2">
                      {sc.status === "Confirmed" && (
                        <button onClick={() => updateStatus(sc.id, "Out for Delivery")} disabled={actionLoading === sc.id}
                          className="w-full py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                          {actionLoading === sc.id ? "Updating..." : "🚛 Start Delivery"}
                        </button>
                      )}
                      {sc.status === "Out for Delivery" && (
                        <button onClick={() => updateStatus(sc.id, "arrived")} disabled={actionLoading === sc.id}
                          className="w-full py-3 rounded-xl text-sm font-bold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">
                          {actionLoading === sc.id ? "Updating..." : "📍 Arrived at Location"}
                        </button>
                      )}
                      {sc.status === "arrived" && (
                        <>
                          {/* Photo */}
                          <label className="w-full py-3 rounded-xl text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 flex items-center justify-center gap-2 cursor-pointer">
                            📷 Take Delivery Photo
                            <input type="file" accept="image/*" capture="environment" className="hidden"
                              onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(sc.id, f); e.target.value = ""; }} />
                          </label>
                          {/* Payment */}
                          {hasBalance && (
                            <button onClick={() => { setPayModal(sc.id); setPayAmount(String(o.balance)); }}
                              className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700">
                              💰 Collect Payment (RM {o.balance})
                            </button>
                          )}
                          {/* Complete */}
                          <button onClick={() => updateStatus(sc.id, "delivered")} disabled={actionLoading === sc.id}
                            className="w-full py-3 rounded-xl text-sm font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                            {actionLoading === sc.id ? "Completing..." : "✅ Mark as Delivered"}
                          </button>
                        </>
                      )}
                      {sc.status === "scheduled" && (
                        <button onClick={() => updateStatus(sc.id, "Confirmed")} disabled={actionLoading === sc.id}
                          className="w-full py-3 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                          {actionLoading === sc.id ? "Updating..." : "✓ Confirm Stop"}
                        </button>
                      )}
                    </div>
                  )}

                  {isDone && (
                    <div className="text-center py-2">
                      <span className="text-emerald-600 font-bold text-sm">✅ Delivery completed</span>
                      {sc.delivered_at && <p className="text-xs text-gray-400">{new Date(sc.delivered_at).toLocaleString("en-MY")}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Payment Modal */}
      {payModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center">
          <div className="bg-white rounded-t-3xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-lg">Collect Payment</h3>
              <button onClick={() => setPayModal(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500">×</button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Amount (RM)</label>
              <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} autoFocus
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-lg font-bold text-center focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Payment Method</label>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_METHODS.map(m => (
                  <button key={m} onClick={() => setPayMethod(m)}
                    className={`py-2 rounded-xl text-xs font-medium border transition-colors ${payMethod === m ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-700 border-gray-200"}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {payMethod === "Bank Transfer" && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Reference No.</label>
                <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Transfer reference"
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              </div>
            )}
            <button onClick={submitPayment} disabled={!payAmount || Number(payAmount) <= 0 || actionLoading}
              className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
              {actionLoading ? "Recording..." : `Record RM ${payAmount || "0"} Payment`}
            </button>
          </div>
        </div>
      )}

      {/* Bottom: completed summary */}
      {total > 0 && delivered === total && (
        <div className="fixed bottom-0 left-0 right-0 bg-emerald-600 text-white text-center py-4 px-4 z-10">
          <p className="text-lg font-bold">🎉 All deliveries completed!</p>
          <p className="text-sm text-emerald-200">{total} stops · {new Date().toLocaleDateString("en-MY")}</p>
        </div>
      )}
    </div>
  );
}
