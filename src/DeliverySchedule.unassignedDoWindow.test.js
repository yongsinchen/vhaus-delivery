// Schedule board → Unassigned → DELIVERY ORDERS must show every draft DO dated
// for the board's date, however old the DO is.
//
// Bug (SO 56029 / DO2609-0015, 2026-10-29): the board loaded DOs with
// ?status=draft,scheduled,…, which the backend caps at the newest 500 by
// created_at. A September DO rescheduled to 31 Oct fell outside that window
// and never appeared in 31 Oct's Unassigned pool, so it could not be assigned.
// The board now loads via active=1 (the Delivery Orders tab's feed).
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { ToastProvider, ModalProvider, LoadingProvider } from "./UIComponents";

jest.mock("./AuthContext", () => {
  const actual = jest.requireActual("./AuthContext");
  return {
    ...actual,
    useAuth: () => ({ user: { id: "u1", role: "manager", company_id: "c1" }, activeCompanyId: "c1", activeRoleKey: "manager" }),
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t", expires_at: 9999999999 } } }), refreshSession: async () => ({ data: {} }) } },
  };
});

const wrap = ui => <ToastProvider><ModalProvider><LoadingProvider>{ui}</LoadingProvider></ModalProvider></ToastProvider>;
const ok = body => ({ ok: true, status: 200, json: async () => body });
const DATE = "2026-10-31";
const dord = (id, doNumber, status, extra = {}) => ({
  id, do_number: doNumber, status, delivery_date: DATE, superseded_at: null, delivery_order_items: [],
  sales_orders: { id: `so-${id}`, order_number: "56029", customer_name: "Leong Hoe Mun" }, ...extra,
});

describe("Schedule board — unassigned Delivery Orders", () => {
  const originalFetch = global.fetch;
  let urls;
  beforeEach(() => {
    urls = [];
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      urls.push(u);
      if (u.includes("/delivery-teams")) return ok({ teams: [] });
      if (u.includes("/delivery-schedules?")) return ok({ schedules: [] });
      if (u.includes("/delivery/unassigned")) return ok([]);
      // Only the uncapped active=1 feed carries the old DO — exactly what the
      // capped ?status= window did in production.
      if (u.includes("/delivery-orders?active=1")) return ok({ delivery_orders: [
        dord("d1", "DO2609-0015", "draft"),
        dord("d2", "DO2610-0099", "tbc"),                                   // not a board status — ignored
        dord("d3", "DO2609-0001", "draft", { superseded_at: "2026-10-01" }), // retired — ignored
      ] });
      if (u.includes("/delivery-orders?")) return ok({ delivery_orders: [] });
      return ok({});
    });
  });
  afterEach(() => { global.fetch = originalFetch; });

  test("an older-created draft DO dated for the board's date appears in Unassigned", async () => {
    const DeliverySchedule = require("./DeliverySchedule").default;
    render(wrap(<DeliverySchedule readOnly={false} canImport={true} companyId="c1" initialDate={DATE} />));
    expect(await screen.findByText(/DO2609-0015/)).toBeTruthy();
    expect(screen.queryByText(/DO2610-0099/)).toBeNull();
    expect(screen.queryByText(/DO2609-0001/)).toBeNull();
    await waitFor(() => expect(urls.some(u => u.includes("/delivery-orders?active=1"))).toBe(true));
    expect(urls.some(u => u.includes("/delivery-orders?status="))).toBe(false);
  });
});
