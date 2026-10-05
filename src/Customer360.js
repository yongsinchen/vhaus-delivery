// Global Search + Customer / Order 360 (Phase 3B).
//
// The top-right Search: type → server-side results (GET /global-search,
// company + permission scoped) → click → the story of that order / service /
// customer (GET /customer-360/...). Search first, story after selection.
// Everything shown comes from canonical records; "other orders" are the same
// customer_id only — never matched by name, phone or address. Sections the
// user may not read are simply not returned by the backend.
import { useEffect, useState } from "react";
import { supabase } from "./AuthContext";
import { SERVICE_TYPES } from "./ServiceCaseFormModal";
import { serviceItemQty } from "./serviceItemQty";
import { fmtYmd } from "./paymentDate";

const API = process.env.REACT_APP_BOT_API || "https://vhaus-bot-production.up.railway.app";
const af = async (url) => {
  const { data } = await supabase.auth.getSession();
  const cid = localStorage.getItem("pulseActiveCompanyId");
  return fetch(url, { headers: { Authorization: `Bearer ${data?.session?.access_token || ""}`, ...(cid && { "X-Company-ID": cid }) } });
};
const getJson = async (url) => { const r = await af(url); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Failed to load"); return d; };

export const money = v => (v == null ? "—" : `RM ${Number(v).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = ymd => fmtYmd(ymd) || "—";
const STATUS_CLS = {
  confirmed: "bg-blue-100 text-blue-700", delivered: "bg-green-100 text-green-700", completed: "bg-green-100 text-green-700", resolved: "bg-green-100 text-green-700", closed: "bg-gray-200 text-gray-600",
  cancelled: "bg-gray-200 text-gray-500", draft: "bg-gray-100 text-gray-600", pending_deposit: "bg-amber-100 text-amber-700", pending: "bg-amber-100 text-amber-700",
  scheduled: "bg-blue-100 text-blue-700", open: "bg-gray-100 text-gray-700", in_progress: "bg-amber-100 text-amber-700", superseded: "bg-gray-200 text-gray-500",
  approved: "bg-green-100 text-green-700", rejected: "bg-red-100 text-red-600", failed: "bg-red-100 text-red-600", out_for_delivery: "bg-amber-100 text-amber-700",
};
const LABEL = { pending_deposit: "Awaiting deposit", in_progress: "In progress", out_for_delivery: "Out for delivery", customer_detail: "Customer details", critical: "Order change" };
const human = s => LABEL[s] || (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, " ") : "—");
export const Badge = ({ s }) => <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_CLS[s] || "bg-gray-100 text-gray-600"}`}>{human(s)}</span>;
const TYPE_TAG = {
  sales_order: ["ORDER", "bg-violet-100 text-violet-800"], delivery_order: ["DELIVERY", "bg-blue-100 text-blue-800"],
  service: ["SERVICE", "bg-purple-200 text-purple-800"], customer: ["CUSTOMER", "bg-teal-100 text-teal-800"],
};
const TypeTag = ({ t }) => <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TYPE_TAG[t][1]}`} data-testid={`tag-${t}`}>{TYPE_TAG[t][0]}</span>;
const KIND = { order: ["📋", "Order"], payment: ["💰", "Payment"], amendment: ["✏️", "Amendment"], delivery: ["🚚", "Delivery"], service: ["🔧", "Service"] };

// ── Search results ───────────────────────────────────────────────
function ResultRow({ r, onPick }) {
  const line = (...xs) => xs.filter(Boolean).join(" · ");
  return (
    <button type="button" onClick={() => onPick(r)} data-testid="global-result"
      className="w-full text-left px-4 py-2.5 hover:bg-violet-50 border-b border-gray-50 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0">
          <TypeTag t={r.type} />
          <span className="font-bold text-sm text-gray-900 truncate">
            {r.type === "sales_order" ? `SO ${r.order_number}` : r.type === "delivery_order" ? r.do_number : r.type === "service" ? (r.sv_number || "Service") : r.name}
          </span>
          {r.exact && <span className="text-[10px] text-emerald-700 font-semibold">exact match</span>}
        </span>
        {r.status && <Badge s={r.status} />}
      </div>
      <p className="text-xs text-gray-500 mt-0.5 truncate">
        {r.type === "sales_order" && line(r.customer_name, r.customer_contact, r.total != null && money(r.total), r.archived && "archived")}
        {r.type === "delivery_order" && line(r.so_number && `SO ${r.so_number}`, r.customer_name, r.delivery_date ? day(r.delivery_date) : "date TBC")}
        {r.type === "service" && line(r.so_number ? `SO ${r.so_number}` : "no Sales Order", r.customer_name, SERVICE_TYPES[r.service_type], r.operational_date ? day(r.operational_date) : "date TBC")}
        {r.type === "customer" && line(r.phone, r.address, `${r.order_count} order${r.order_count === 1 ? "" : "s"}`)}
      </p>
    </button>
  );
}

export function GlobalSearchResults({ data, onPick }) {
  const all = [...data.sales_orders, ...data.delivery_orders, ...data.services, ...data.customers];
  if (!all.length) return <div className="text-center py-8 text-gray-400 text-sm" data-testid="global-empty">No results for “{data.query}”</div>;
  const exact = all.filter(r => r.exact);
  const groups = [["Best match", exact], ["Orders", data.sales_orders.filter(r => !r.exact)], ["Deliveries", data.delivery_orders.filter(r => !r.exact)],
    ["Service", data.services.filter(r => !r.exact)], ["Customers", data.customers]].filter(([, rows]) => rows.length);
  return groups.map(([title, rows]) => (
    <div key={title}>
      <p className="px-4 pt-2 pb-1 text-[11px] font-bold text-gray-400 uppercase tracking-wide">{title}</p>
      {rows.map(r => <ResultRow key={`${r.type}-${r.id}`} r={r} onPick={onPick} />)}
    </div>
  ));
}

// ── Story ────────────────────────────────────────────────────────
const Section = ({ title, count, children }) => (
  <section className="space-y-1.5">
    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">{title}{count != null ? ` (${count})` : ""}</h4>
    {children}
  </section>
);
const Card = ({ highlight, children, testid }) => (
  <div data-testid={testid} className={`rounded-xl border px-3 py-2 text-xs ${highlight ? "border-violet-400 ring-2 ring-violet-200 bg-violet-50" : "border-gray-200 bg-white"}`}>{children}</div>
);

export function StoryView({ story, onOpenOrder, onNavigate, can = {} }) {
  const { customer, order, payments, deliveries, services, amendments, other_orders, timeline, highlight = {} } = story;
  return (
    <div className="space-y-4" data-testid="story">
      <div className="rounded-xl bg-gray-50 px-4 py-3" data-testid="story-customer">
        <p className="text-[11px] font-bold text-gray-400 uppercase">Customer</p>
        <p className="font-bold text-gray-900">{customer.name || "—"}</p>
        <p className="text-xs text-gray-600">{[customer.phone, customer.address].filter(Boolean).join(" · ") || "—"}</p>
        {order && !customer.linked && <p className="text-[11px] text-amber-700 mt-1">This order is not linked to a customer record, so other orders can't be shown.</p>}
      </div>

      {order && (
        <div className="rounded-xl border border-violet-200 px-4 py-3" data-testid="story-order">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2"><TypeTag t="sales_order" /><span className="font-bold text-violet-800">SO {order.order_number}</span><Badge s={order.status} />{order.archived && <Badge s="archived" />}</span>
            {onNavigate && <button type="button" onClick={() => onNavigate({ to: "order", salesOrderId: order.id })} className="text-xs bg-violet-600 text-white px-2.5 py-1 rounded-lg">View Order</button>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-2 text-xs">
            <span className="text-gray-500">Salesperson <b className="text-gray-800 block">{order.salesperson || "—"}</b></span>
            <span className="text-gray-500">Order date <b className="text-gray-800 block">{day(order.order_date)}</b></span>
            <span className="text-gray-500">Total <b className="text-gray-800 block">{money(order.total)}</b></span>
            <span className="text-gray-500">Paid <b className="text-gray-800 block">{money(order.paid)}</b></span>
            <span className="text-gray-500">Outstanding <b className={`block ${order.outstanding > 0 ? "text-red-600" : "text-emerald-700"}`}>{money(order.outstanding)}</b></span>
          </div>
        </div>
      )}

      {timeline?.length > 0 && (
        <Section title="Story" count={timeline.length}>
          <ol className="relative border-l-2 border-gray-200 ml-2 space-y-2" data-testid="story-timeline">
            {timeline.map((e, i) => (
              <li key={i} className="ml-3">
                <span className="absolute -left-[9px] mt-1 w-4 h-4 rounded-full bg-white border-2 border-gray-300 text-[9px] flex items-center justify-center" aria-hidden="true">{KIND[e.kind]?.[0]}</span>
                <p className="text-[11px] text-gray-400">{day(e.date)} · {KIND[e.kind]?.[1]}</p>
                <p className="text-sm text-gray-900 font-medium">{e.title}</p>
                {e.detail && <p className="text-xs text-gray-600 break-words">{e.detail}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {deliveries && (
        <Section title="Deliveries" count={deliveries.delivery_orders.length + deliveries.whole_order_schedules.length}>
          {deliveries.delivery_orders.length === 0 && deliveries.whole_order_schedules.length === 0 && <p className="text-xs text-gray-400">No delivery yet.</p>}
          {deliveries.delivery_orders.map(d => {
            const live = d.schedules.find(s => !["delivered", "failed"].includes(String(s.status || "").toLowerCase())) || d.schedules[d.schedules.length - 1];
            return (
              <Card key={d.id} highlight={highlight.delivery_order_id === d.id} testid="story-delivery">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-1.5"><TypeTag t="delivery_order" /><b>{d.do_number}</b><Badge s={d.status} />{d.superseded_by && <span className="text-gray-400">→ {d.superseded_by}</span>}</span>
                  {onNavigate && d.delivery_date && !["completed", "cancelled", "superseded"].includes(d.status) && can.schedule &&
                    <button type="button" onClick={() => onNavigate({ to: "schedule", date: d.delivery_date })} className="text-xs border border-gray-300 px-2 py-0.5 rounded hover:bg-gray-50">Go to Delivery Schedule</button>}
                </div>
                <p className="text-gray-600 mt-0.5">Delivery date: <b>{d.delivery_date ? day(d.delivery_date) : "TBC"}</b> · Team: <b>{live?.team || "Unassigned"}</b></p>
                {d.items.length > 0 && <p className="text-gray-500 mt-0.5">{d.items.map(i => `${i.name} ×${i.quantity}`).join(", ")}</p>}
              </Card>
            );
          })}
          {deliveries.whole_order_schedules.map(s => (
            <Card key={s.id} testid="story-delivery"><b>Delivery</b> <Badge s={String(s.status || "").toLowerCase()} /> · {day(s.scheduled_date)} · {s.team || "Unassigned"}</Card>
          ))}
        </Section>
      )}

      {services && (
        <Section title="Service" count={services.length}>
          {services.length === 0 && <p className="text-xs text-gray-400">No Service case.</p>}
          {services.map(s => (
            <Card key={s.id} highlight={highlight.service_id === s.id} testid="story-service">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-1.5"><TypeTag t="service" /><b>{s.sv_number || "Service"}</b><Badge s={s.status} /><span className="text-gray-500">{SERVICE_TYPES[s.service_type]}</span></span>
                {onNavigate && can.service && <button type="button" onClick={() => onNavigate({ to: "service" })} className="text-xs border border-gray-300 px-2 py-0.5 rounded hover:bg-gray-50">View Service</button>}
              </div>
              <p className="text-gray-600 mt-0.5">Service date: <b>{s.operational_date ? day(s.operational_date) : "TBC"}</b> · Team: <b>{s.schedule?.team_label || "Unassigned"}</b></p>
              {s.description && <p className="text-gray-800 mt-0.5 whitespace-pre-line">“{s.description}”</p>}
              {s.items.length > 0 && <p className="text-gray-500 mt-0.5">{s.items.map(i => `${i.description || "item"} ×${serviceItemQty(i.quantity)}`).join(", ")}</p>}
            </Card>
          ))}
        </Section>
      )}

      {payments && (
        <Section title="Payments" count={payments.length}>
          {payments.length === 0 ? <p className="text-xs text-gray-400">No payment recorded.</p> : (
            <table className="w-full text-xs" data-testid="story-payments">
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="py-1 pr-2 text-gray-500 whitespace-nowrap">{day(p.payment_date)}</td>
                    <td className="py-1 pr-2">{p.deposit ? "Deposit" : "Payment"}{p.method ? ` · ${p.method}` : ""}{p.or_number ? ` · OR ${p.or_number}` : ""}</td>
                    <td className="py-1 pr-2 text-right font-medium whitespace-nowrap">{money(p.applied_to_this_order)}{p.amount !== p.applied_to_this_order && <span className="block text-[10px] text-gray-400">of {money(p.amount)}</span>}</td>
                    <td className="py-1 text-right"><Badge s={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {onNavigate && can.finance && <button type="button" onClick={() => onNavigate({ to: "finance" })} className="text-xs text-violet-700 hover:underline">Open Finance</button>}
        </Section>
      )}

      {amendments?.length > 0 && (
        <Section title="Amendments" count={amendments.length}>
          {amendments.map(a => (
            <Card key={a.id} testid="story-amendment">
              <span className="flex items-center gap-1.5"><b>{human(a.category)}</b><Badge s={a.status} /><span className="text-gray-400">{day((a.requested_at || "").slice(0, 10))}{a.requested_by ? ` · ${a.requested_by}` : ""}</span></span>
              {a.changes.length > 0 && <ul className="mt-0.5 list-disc ml-4 text-gray-700">{a.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
              {a.decision_note && <p className="text-gray-500 mt-0.5">Note: {a.decision_note}</p>}
            </Card>
          ))}
        </Section>
      )}

      {order && (
        <Section title="Other orders from this customer" count={other_orders.length}>
          {other_orders.length === 0 ? <p className="text-xs text-gray-400">{customer.linked ? "No other orders." : "—"}</p> : other_orders.map(o => (
            <button key={o.id} type="button" onClick={() => onOpenOrder(o.id)} data-testid="story-other-order"
              className="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-violet-50">
              <span className="flex items-center gap-2"><b>SO {o.order_number}</b><Badge s={o.status} />{o.archived && <Badge s="archived" />}<span className="text-gray-400">{day(o.order_date)}</span></span>
              <span className="font-medium">{money(o.total)}</span>
            </button>
          ))}
        </Section>
      )}
    </div>
  );
}

function CustomerOverview({ data, onOpenOrder }) {
  return (
    <div className="space-y-4" data-testid="customer-overview">
      <div className="rounded-xl bg-gray-50 px-4 py-3">
        <p className="text-[11px] font-bold text-gray-400 uppercase">Customer</p>
        <p className="font-bold text-gray-900">{data.customer.name}{data.customer.company_name ? ` · ${data.customer.company_name}` : ""}</p>
        <p className="text-xs text-gray-600">{[data.customer.phone, data.customer.address].filter(Boolean).join(" · ") || "—"}</p>
      </div>
      <Section title="Orders" count={data.orders.length}>
        {data.orders.length === 0 && <p className="text-xs text-gray-400">No orders.</p>}
        {data.orders.map(o => (
          <button key={o.id} type="button" onClick={() => onOpenOrder(o.id)} data-testid="customer-order"
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs hover:bg-violet-50">
            <span className="flex items-center gap-2"><b>SO {o.order_number}</b><Badge s={o.status} />{o.archived && <Badge s="archived" />}<span className="text-gray-400">{day(o.order_date)}</span></span>
            <span className="text-right"><b>{money(o.total)}</b>{o.outstanding > 0 && <span className="block text-red-600">{money(o.outstanding)} due</span>}</span>
          </button>
        ))}
      </Section>
    </div>
  );
}

/**
 * The whole top-right Search overlay: search box → results → story.
 * `onNavigate({to, ...})` hands off to existing screens (order view, schedule,
 * service, finance). `can` = { schedule, service, finance } for those buttons.
 */
export default function GlobalSearch({ onClose, onNavigate, can = {} }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState({ loading: false, data: null, error: null });
  const [stack, setStack] = useState([]); // story views opened, newest last: {kind, id, highlight}
  const [view, setView] = useState({ loading: false, data: null, error: null });
  const current = stack[stack.length - 1] || null;

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setRes({ loading: false, data: null, error: null }); return undefined; }
    let alive = true;
    setRes(r => ({ ...r, loading: true, error: null }));
    const t = setTimeout(() => {
      getJson(`${API}/global-search?q=${encodeURIComponent(text)}`)
        .then(d => { if (alive) setRes({ loading: false, data: d, error: null }); })
        .catch(e => { if (alive) setRes({ loading: false, data: null, error: e.message }); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    if (!current) return undefined;
    let alive = true;
    setView({ loading: true, data: null, error: null });
    const url = current.kind === "customer" ? `${API}/customer-360/customers/${current.id}`
      : current.kind === "service" ? `${API}/customer-360/services/${current.id}`
      : `${API}/customer-360/orders/${current.id}`;
    getJson(url)
      .then(d => { if (alive) setView({ loading: false, data: { ...d, highlight: { ...(d.highlight || {}), ...(current.highlight || {}) } }, error: null }); })
      .catch(e => { if (alive) setView({ loading: false, data: null, error: e.message }); });
    return () => { alive = false; };
  }, [current]);

  const open = (entry) => setStack(s => [...s, entry]);
  const pick = (r) => {
    if (r.type === "sales_order") open({ kind: "order", id: r.id });
    else if (r.type === "delivery_order") open({ kind: "order", id: r.sales_order_id, highlight: { delivery_order_id: r.id } });
    else if (r.type === "service") open({ kind: "service", id: r.id });
    else if (r.type === "customer") open({ kind: "customer", id: r.id });
  };
  const navigate = (n) => { onNavigate?.(n); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 pt-12 px-4" data-testid="global-search">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${current ? "max-w-3xl" : "max-w-lg"} overflow-hidden flex flex-col max-h-[85vh]`}>
        <div className="flex items-center gap-3 p-4 border-b">
          {current ? (
            <button type="button" onClick={() => setStack(s => s.slice(0, -1))} className="text-sm text-violet-700 hover:underline whitespace-nowrap" data-testid="story-back">← {stack.length > 1 ? "Back" : "Results"}</button>
          ) : <span className="text-gray-400">🔍</span>}
          <input autoFocus value={q} onChange={e => { setQ(e.target.value); setStack([]); }} placeholder="Search SO / DO / Service no., customer, phone, address, item…"
            className="flex-1 text-sm focus:outline-none" aria-label="Global search" />
          <button onClick={onClose} aria-label="Close search" className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 font-bold text-sm">×</button>
        </div>
        <div className="overflow-y-auto">
          {current ? (
            <div className="p-4">
              {view.loading && <p className="text-center text-gray-400 text-sm py-8">Loading story…</p>}
              {view.error && <p className="text-center text-red-500 text-sm py-8">{view.error}</p>}
              {view.data && (current.kind === "customer"
                ? <CustomerOverview data={view.data} onOpenOrder={id => open({ kind: "order", id })} />
                : <StoryView story={view.data} onOpenOrder={id => open({ kind: "order", id })} onNavigate={navigate} can={can} />)}
            </div>
          ) : (
            <>
              {q.trim().length < 2 && <div className="text-center py-8 text-gray-400 text-sm">Start typing — SO, DO or Service number, customer name, phone or address</div>}
              {q.trim().length >= 2 && res.loading && !res.data && <div className="text-center py-8 text-gray-400 text-sm" data-testid="global-loading">Searching…</div>}
              {res.error && <div className="text-center py-8 text-red-500 text-sm">{res.error}</div>}
              {res.data && <div className={res.loading ? "opacity-60" : ""}><GlobalSearchResults data={res.data} onPick={pick} /></div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
