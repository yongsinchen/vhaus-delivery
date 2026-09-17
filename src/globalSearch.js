// Pure Global Search helpers (extracted from App.js so they are unit-testable
// without React). See App.js for how they are wired into the modal + the live
// backend Sales Order search.

// Local match against a preloaded order/service row (the dashboard working set).
export const globalMatchRow = (o, q) =>
  o.soNumber?.toLowerCase().includes(q) || o.svNumber?.toLowerCase().includes(q)
  || o.customerName?.toLowerCase().includes(q) || o.contact?.includes(q)
  || o.serviceNote?.toLowerCase().includes(q) || o.items?.some(i => i.itemName?.toLowerCase().includes(q));

// Map a /sales-orders?search= list row into a Global Search result. Tagged
// _backendOrder so the click handler routes it into the Orders page's own
// canonical detail view by its stable sales_orders id (never reconstructing
// identity from the SO number). Company scope is enforced by the backend from
// the authenticated session — the client never sends an arbitrary company_id.
export const mapSalesOrderHit = (r) => ({
  _backendOrder: true,
  id: r.id,                       // sales_orders UUID — stable identity for navigation
  soNumber: r.order_number,
  customerName: r.customer_name,
  contact: r.customer_contact,
  status: r.status,
  items: [],                      // the list endpoint omits items (cosmetic subtitle only)
});

// Deterministic de-dupe by canonical Sales Order identity: a backend hit whose
// SO number already appears as a locally-matched (non-service) order is
// dropped, so the same order never shows twice. Local hits are kept first (and
// open cleanly via the dashboard modal); backend-only hits follow.
export const mergeGlobalResults = (local, backend) => {
  const localOrderSo = new Set(local.filter(o => !o._isService && o.soNumber).map(o => String(o.soNumber).toLowerCase()));
  const extra = backend.filter(b => b.soNumber && !localOrderSo.has(String(b.soNumber).toLowerCase()));
  return [...local, ...extra];
};
