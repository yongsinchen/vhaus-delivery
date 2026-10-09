// Finance → Payments: each payment's Sales Order(s) and their effective
// delivery date, as sent by GET /payments (`linked_orders`, backend
// lib/payment-so-links.js). Display only.
//   one active DO → that DO's date · no DO → the SO's own date
//   several active DOs → each DO listed ("Multiple DO"), never one guessed date
//   no date → TBC
// A split payment lists every SO it is allocated to, each with its own date.
import { fmtYmd } from "./paymentDate";

const soLabel = n => { const s = String(n || "").trim(); return !s ? "" : /^SO/i.test(s) ? s : `SO${s}`; };

/** Plain-text delivery label for one linked SO. */
export function deliveryLabel(delivery) {
  if (!delivery) return "—";
  if (delivery.ambiguous) {
    const parts = (delivery.deliveries || []).map(d => `${d.do_number || "DO"} ${d.date ? fmtYmd(d.date) : "TBC"}`);
    return `Multiple DO: ${parts.join(", ")}`;
  }
  if (delivery.tbc || !delivery.date) return "TBC";
  return fmtYmd(delivery.date) + (delivery.source === "delivery_order" && delivery.do_number ? ` (${delivery.do_number})` : "");
}

export function LinkedOrdersCell({ links, amountKnown = true }) {
  const list = links || [];
  if (!list.length) return <span className="text-gray-300">—</span>;
  const many = list.length > 1;
  return (
    <div className="space-y-0.5" data-testid="linked-orders">
      {list.map((l, i) => (
        <div key={`${l.so_number}-${i}`} className="whitespace-nowrap" data-testid="linked-order">
          <span className="font-medium text-gray-800">{soLabel(l.so_number)}</span>
          {many && amountKnown && l.amount != null && <span className="text-gray-400"> · RM {Number(l.amount).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
          <span className={`ml-1 ${l.delivery?.ambiguous ? "text-amber-700" : l.delivery?.tbc ? "text-gray-400" : "text-indigo-700"}`}>· {deliveryLabel(l.delivery)}</span>
        </div>
      ))}
    </div>
  );
}
