// ── Sales order document content, shared by Print and Download PDF ──────────
// OrdersPage's printSalesOrder (HTML → print dialog) and salesOrderPdf (a real
// text PDF) both render a sales order from these figures and terms, so the two
// can never show a different total, balance, item line or T&C.
import { formatMoney } from "./UIComponents";
import { matchPaymentOption } from "./paymentMethodMatch";

export const PAYMENT_METHODS = ["Cash", "Card", "Online Transfer", "E-Wallet", "Cheque", "Instalment"];

export const SALES_ORDER_TERMS = [
  "All orders are confirmed only upon payment of a deposit. Deposits are strictly non-refundable.",
  "Full payment must be settled prior to delivery or collection of goods.",
  "Delivery dates provided are estimates only. The Company shall not be liable for any delay caused by suppliers, manufacturing, transportation, or any cause beyond its reasonable control.",
  "Goods sold are not returnable, refundable, or exchangeable once the order is confirmed, except for genuine manufacturing defects reported within 3 days of delivery.",
  "Customised, made-to-order, and special-size items cannot be cancelled, refunded, or exchanged under any circumstances.",
  "Natural materials (wood, rattan, leather, fabric) may vary in colour, grain, and texture. Such variations are inherent characteristics and shall not be regarded as defects.",
  "The customer must inspect all goods upon delivery. Signing the delivery note constitutes acceptance of the goods in good condition.",
  "Ownership of goods remains with the Company until full payment is received. Goods stored beyond 14 days from the agreed delivery date at the customer's request may incur storage charges.",
  "Warranty (where applicable) covers manufacturing defects only and excludes normal wear and tear, misuse, or improper care.",
  "The Company's total liability shall not exceed the purchase value of the goods. This agreement is governed by the laws of Malaysia.",
];

export const soMoney = (v) => (v == null || v === "" ? "" : formatMoney(v));

/**
 * Everything a printed / PDF sales order shows that is derived from the order.
 * Items: one entry per line with display strings ready to place.
 */
export function salesOrderFigures(order, branchName) {
  const items = order.items || order.sales_order_items || [];
  let gross = 0;
  const lines = items.map((it, i) => {
    const qty = Number(it.quantity) || 1;
    const price = Number(it.unit_price) || 0;
    const line = qty * price;
    gross += line;
    return {
      no: i + 1,
      name: it.product_name || it.product_code || "",
      sub: [it.product_code, it.size, it.color, it.custom_dimensions].filter(Boolean).join(" · "),
      notes: it.notes || "",
      qty,
      unitPrice: it.unit_price === 0 || it.unit_price == null ? "" : soMoney(price),
      amount: line ? soMoney(line) : "",
    };
  });

  const discount = Number(order.discount) || 0;
  const deposit = Number(order.deposit) || 0;
  const subtotal = order.subtotal != null && order.subtotal !== "" ? Number(order.subtotal) : gross;
  const gstRate = order.gst_waived ? 0 : (Number(order.gst_rate) || 0);
  // Stored gst_amount wins (old orders keep the GST they were sold at);
  // fallback computes on the full subtotal — discount comes off after tax.
  const gst = order.gst_waived ? 0 : (order.gst_amount != null ? Number(order.gst_amount) : Math.round(subtotal * gstRate) / 100);
  const total = subtotal + gst - discount;
  const balance = total - deposit;
  const dateStr = new Date((order.order_date || order.created_at || new Date().toISOString()) + (order.order_date ? "T00:00:00" : "")).toLocaleDateString("en-MY");

  return {
    lines, subtotal, discount, deposit, gst, gstRate, total, balance, dateStr,
    branchLine: (branchName || order.branch_name || order.sales_channel || "—").toString().toUpperCase(),
    idLabel: order.customer_id_type === "passport" ? "Passport No" : "I/C No",
    // Tick the box whose canonical option matches the SO's stored payment_method,
    // mapping cross-UI / legacy label variants (e.g. "Bank Transfer" → Online
    // Transfer, "Credit Card" → Card, "Touch n Go" → E-Wallet). A missing or
    // unrecognised value ticks NOTHING — never inferred from payments, never
    // defaulted to Cash.
    checkedPay: matchPaymentOption(order.payment_method),
  };
}
