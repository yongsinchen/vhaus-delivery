// Record Payment modal — shared by the Customers page (all of a customer's
// outstanding orders) and the Orders page SO view (that one SO). Posts to
// /payments/record; the backend recomputes paid/balance from the ledger and
// the payment stays pending Finance verification. Prints the Official Receipt.
//
// Props:
//   customer  { id?, name, phone } — id may be null (payment still links via order)
//   orders    [{ id (legacy orders.id), so_number, balance, order_amount, order_date }]
//   initiatingOrderId  optional — the order Record Payment was opened FROM
//                       (e.g. the Orders SO view); shown/allocated first,
//                       ahead of the oldest-first suggestion for the rest.
//   company   receipt header ({ name, reg, address, hotline, email, website, logo })
//   onClose   () => void
//   onRecorded () => void — called after a successful record (inside the loading overlay)
import React, { useState, useRef } from "react";
import { supabase } from "./AuthContext";
import { useToast, useLoading } from "./UIComponents";
import { printOfficialReceipt } from "./officialReceipt";
import { allocsFor, tagOutstanding, defaultKind, autoAllocateInto, round2 } from "./paymentAllocation";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const getToken = async () => { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ""; };
const af = async (url, opts = {}) => { const token = await getToken(); const cid = localStorage.getItem("pulseActiveCompanyId"); return fetch(url, { ...opts, headers: { ...opts.headers, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(cid && { "X-Company-ID": cid }) } }); };
const money = v => `RM ${(Number(v) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
const dmy = v => { if (!v) return ""; const d = new Date(String(v).length <= 10 ? v + "T00:00:00" : v); return isNaN(d) ? "" : d.toLocaleDateString("en-MY"); };

export const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Credit Card / Debit Card", "Touch n Go", "Instalment", "Cash Rebate", "2C2P", "eZbeli"];
export { allocsFor, tagOutstanding, defaultKind } from "./paymentAllocation";

// reloadOrders (optional) — async () => fresh orders array; used to rebuild the
// allocation preview when the server rejects a payment as stale_balance.
export default function RecordPaymentModal({ customer, orders, initiatingOrderId, company, onClose, onRecorded, reloadOrders }) {
  const toast = useToast();
  const { withLoading } = useLoading();

  const [withBalance, setWithBalance] = useState(() => tagOutstanding(orders));
  const initialKind = defaultKind(withBalance);

  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payKind, setPayKind] = useState(initialKind); // "deposit" | "balance" — descriptive label on the payment
  const [payRef, setPayRef] = useState("");
  const [payAdmin, setPayAdmin] = useState(""); // instalment admin charges
  const [payAllocations, setPayAllocations] = useState(() => allocsFor(withBalance, initialKind, initiatingOrderId));
  const [payProofs, setPayProofs] = useState([]); // uploaded proof URLs
  const [payUploading, setPayUploading] = useState(false);
  const [paySaving, setPaySaving] = useState(false); // drives button label/disabled
  const paySavingRef = useRef(false); // synchronous guard — blocks a double-click before re-render
  // One stable key for this Record Payment ATTEMPT — generated once when the
  // modal mounts (i.e. once per "open Record Payment" action) and reused
  // across every retry of the SAME attempt (a double-click, or the browser
  // retrying a timed-out request). Closing and reopening the modal — a
  // genuinely NEW attempt — remounts the component and mints a new key.
  const idempotencyKeyRef = useRef(typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const switchPayKind = (kind) => {
    setPayKind(kind);
    setPayAllocations(allocsFor(withBalance, kind, initiatingOrderId));
    setPayAmount("");
  };

  // Fills orders oldest-first, each capped at its own outstanding balance —
  // a starting suggestion only. Finance can edit any row; Confirm stays
  // disabled until Total Allocated exactly equals Payment Received (never
  // silently discarding a remainder, never overflowing onto one order).
  const autoAllocate = (total) => {
    setPayAllocations(prev => autoAllocateInto(prev, total));
  };

  const payTotalAllocated = round2(payAllocations.reduce((s, a) => s + (Number(a.amount) || 0), 0));
  const payUnallocated = round2((Number(payAmount) || 0) - payTotalAllocated);

  // Every allocation row must be a valid non-negative number (an empty row
  // means "not allocating to this order" — 0 or blank, never negative).
  const hasInvalidAllocation = payAllocations.some(a => a.amount !== "" && (!Number.isFinite(Number(a.amount)) || Number(a.amount) < 0));

  const submitPayment = async () => {
    if (paySavingRef.current) return; // ignore rapid re-clicks while a request is in flight
    const total = Number(payAmount);
    if (!total || total <= 0) { toast.warning("Enter payment amount"); return; }
    if (payUnallocated !== 0) { toast.warning("Total Allocated must equal Payment Received before you can confirm."); return; } // defense in depth — Confirm is already disabled for this
    if (hasInvalidAllocation) { toast.warning("Every allocation amount must be zero or positive."); return; } // defense in depth — Confirm is already disabled for this
    if (payMethod === "Cash Rebate" && !payRef.trim()) { toast.warning("Please enter a reason for the cash rebate"); return; }
    if ((payMethod === "Credit Card / Debit Card" || payMethod === "Instalment") && !payRef.trim()) { toast.warning("Please enter the approval code"); return; }
    const allocations = payAllocations.filter(a => Number(a.amount) > 0).map(a => ({ order_id: a.order_id, amount: Number(a.amount) }));
    paySavingRef.current = true;
    setPaySaving(true);
    try {
      await withLoading("Recording payment…", async () => {
        const res = await af(`${API}/payments/record`, { method: "POST", body: JSON.stringify({ customer_id: customer?.id || null, amount: total, payment_method: payMethod, reference_no: payRef || null, proof_url: payProofs.join(", ") || null, allocations, admin_charges: payMethod === "Instalment" && payAdmin !== "" ? Number(payAdmin) : null, kind: payKind, idempotency_key: idempotencyKeyRef.current }) });
        const d = await res.json();
        if (!d.payment) {
          if (d.code === "idempotency_conflict") {
            // Should not happen from a normal double-click (paySavingRef
            // already blocks that) or a same-payload retry (the backend
            // replays it) — only from a genuinely different payment somehow
            // reusing this attempt's key. Fail closed, exactly like the
            // backend: never silently treat it as a success.
            throw new Error(d.error || "This payment attempt could not be verified as a retry of itself — please close and reopen to try again.");
          }
          if (d.code === "stale_balance") {
            // Server rejected as stale — never silently reapply old numbers.
            // Reload current orders/balances and rebuild the allocation
            // preview before Finance tries again. Without a reloader, clear
            // the suggested amounts so the stale figures can't be resubmitted.
            if (reloadOrders) {
              const fresh = tagOutstanding(await reloadOrders());
              const kind = defaultKind(fresh);
              setWithBalance(fresh); setPayKind(kind); setPayAllocations(allocsFor(fresh, kind, initiatingOrderId)); setPayAmount("");
              throw new Error(`${d.error} Balances reloaded — please review the allocation again.`);
            }
            setPayAllocations(prev => prev.map(a => ({ ...a, amount: "" }))); setPayAmount("");
            throw new Error(`${d.error} Please close and reopen to load the current balance.`);
          }
          throw new Error(d.error || "Failed");
        }
        // Payment is PENDING Finance approval, but the OR is assigned at
        // collection so the salesman can print it now for the customer.
        toast.success(`${money(total)} recorded — pending Finance verification`);
        const rows = payAllocations.filter(a => Number(a.amount) > 0).map(a => {
          const ord = withBalance.find(o => o.id === a.order_id) || {};
          const oldBal = Number(a.balance) || 0, paid = Number(a.amount) || 0;
          return { so_number: a.so_number, date: dmy(ord.order_date) || new Date().toLocaleDateString("en-MY"), payment_method: payMethod, amount: ord.order_amount != null ? Number(ord.order_amount) : null, paid, balance: Math.max(0, oldBal - paid) };
        });
        printOfficialReceipt({
          company: company || {},
          receiptNo: d.payment.or_number != null ? String(d.payment.or_number) : "",
          customer: { name: customer?.name, phone: customer?.phone },
          date: new Date().toLocaleDateString("en-MY"), rows,
          totalReceived: total, creditBalance: 0, kindLabel: payKind === "deposit" ? "Deposit" : "Balance",
        });
        await onRecorded?.();
      });
    } catch (err) {
      toast.error(err.message || "Failed to record payment");
    } finally {
      paySavingRef.current = false;
      setPaySaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900">Record Payment</h3>
            <p className="text-xs text-gray-500">{customer?.name} · {withBalance.length} order(s) with balance</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500">×</button>
        </div>
        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Collecting</label>
            <div className="grid grid-cols-2 gap-2">
              {[{ k: "deposit", label: "Collect Deposit" }, { k: "balance", label: "Collect Balance" }].map(({ k, label }) => {
                // Deposit only when there's an order without a deposit yet;
                // balance only when there's an order that already has one.
                const available = k === "deposit"
                  ? withBalance.some(o => !o._hasDeposit)
                  : withBalance.some(o => o._hasDeposit);
                return (
                  <button key={k} type="button" disabled={!available} onClick={() => switchPayKind(k)}
                    title={!available ? (k === "deposit" ? "No new orders awaiting a deposit" : "No orders with an outstanding balance") : ""}
                    className={`py-2 rounded-xl text-xs font-semibold border transition-colors ${payKind === k ? (k === "deposit" ? "bg-violet-600 text-white border-violet-600" : "bg-emerald-600 text-white border-emerald-600") : "bg-white text-gray-700 border-gray-200"} disabled:opacity-40 disabled:cursor-not-allowed`}>
                    {label}
                  </button>
                );
              })}
            </div>
            {payKind === "deposit"
              ? <p className="text-[11px] text-violet-600 mt-1">Deposit — for new orders with no deposit yet. Recording it turns the order into a confirmed sale.</p>
              : <p className="text-[11px] text-emerald-600 mt-1">Balance — for orders that already have a deposit.</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Total Amount (RM)</label>
            <input type="number" value={payAmount} onChange={e => { setPayAmount(e.target.value); autoAllocate(e.target.value); }} autoFocus
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-lg font-bold text-center focus:outline-none focus:ring-2 focus:ring-violet-300" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map(m => (
                <button key={m} onClick={() => { setPayMethod(m); if (!["Bank Transfer", "Cash Rebate", "Credit Card / Debit Card", "Instalment"].includes(m)) setPayRef(""); }}
                  className={`py-2 rounded-xl text-xs font-medium border ${payMethod === m ? "bg-violet-600 text-white border-violet-600" : "bg-white text-gray-700 border-gray-200"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          {payMethod === "Bank Transfer" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Reference</label>
              <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Transfer reference"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
          )}
          {payMethod === "Cash Rebate" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Reason <span className="text-red-500">*</span></label>
              <textarea value={payRef} onChange={e => setPayRef(e.target.value)} rows={2} placeholder="Why is this cash rebate being given?"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
          )}
          {payMethod === "Instalment" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Admin Charges (RM)</label>
              <input type="number" value={payAdmin} onChange={e => setPayAdmin(e.target.value)} placeholder="0.00"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-right focus:outline-none focus:border-violet-400" />
            </div>
          )}
          {(payMethod === "Credit Card / Debit Card" || payMethod === "Instalment") && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Approval Code <span className="text-red-500">*</span></label>
              <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Card / instalment approval code"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-violet-400" />
            </div>
          )}
          {/* Payment Proof upload */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Payment Proof</label>
            <div className="space-y-1">
              {payProofs.map((url, i) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-2 py-1">
                  <a href={url} target="_blank" rel="noreferrer" className="flex-1 text-violet-600 underline truncate">{url.split("/").pop()}</a>
                  <button type="button" onClick={() => setPayProofs(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">✕</button>
                </div>
              ))}
            </div>
            <label className={`mt-1 flex items-center gap-2 text-xs cursor-pointer ${payUploading ? "text-gray-400" : "text-violet-600 hover:text-violet-800"}`}>
              <span>{payUploading ? "Uploading…" : "+ Upload receipt / screenshot"}</span>
              <input type="file" accept="image/*,application/pdf" className="hidden" disabled={payUploading} onChange={async e => {
                const file = e.target.files?.[0]; if (!file) return;
                setPayUploading(true);
                try {
                  const token = await getToken();
                  const fd = new FormData(); fd.append("file", file);
                  const res = await fetch(`${API}/sales-orders/upload-attachment`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
                  const d = await res.json();
                  if (d.url) setPayProofs(prev => [...prev, d.url]);
                  else toast.error(d.error || "Upload failed");
                } catch (err) { toast.error("Upload failed"); }
                finally { setPayUploading(false); e.target.value = ""; }
              }} />
            </label>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Allocate to Orders</label>
            <p className="text-xs text-gray-400 mb-2">{initiatingOrderId != null ? "Amount auto-distributed to this order first, then oldest orders first. Adjust manually if needed." : "Amount auto-distributed to oldest orders first. Adjust manually if needed."}</p>
            <div className="space-y-2">
              {payAllocations.map((a, i) => (
                <div key={a.order_id} className="flex items-center gap-2 bg-gray-50 rounded-xl p-2">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-violet-700">{a.so_number}</span>
                    <span className="text-xs text-red-500 ml-2">Bal: {money(a.balance)}</span>
                  </div>
                  <input type="number" min="0" value={a.amount} onChange={e => {
                    const v = e.target.value;
                    const clamped = v === "" ? "" : String(Math.max(0, Number(v) || 0));
                    const next = [...payAllocations]; next[i] = { ...next[i], amount: clamped }; setPayAllocations(next);
                  }} placeholder="0" className="w-24 px-2 py-1 text-sm text-right rounded-lg border border-gray-200 focus:outline-none focus:border-violet-400" />
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 mt-3 pt-2 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Payment Received</span><span className="font-semibold">{money(payAmount || 0)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Total Allocated</span><span className="font-semibold">{money(payTotalAllocated)}</span></div>
              <div className="flex justify-between"><span className={payUnallocated !== 0 ? "text-red-600 font-semibold" : "text-gray-500"}>Unallocated</span><span className={`font-semibold ${payUnallocated !== 0 ? "text-red-600" : ""}`}>{money(payUnallocated)}</span></div>
            </div>
            {payUnallocated !== 0 && Number(payAmount) > 0 && (
              <p className="text-xs text-red-600 mt-2">Total Allocated must equal Payment Received before you can confirm. Adjust the allocation above.</p>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t">
          <button onClick={submitPayment} disabled={paySaving || payUploading || !payAmount || Number(payAmount) <= 0 || payUnallocated !== 0 || hasInvalidAllocation}
            className="w-full py-3 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {paySaving ? "Recording…" : `Confirm ${money(payAmount || 0)} ${payKind === "deposit" ? "Deposit" : "Balance"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
