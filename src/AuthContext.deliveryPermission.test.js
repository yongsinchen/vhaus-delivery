// Per-company permission override reaches the UI gate: the SAME user in two companies, where one company's role
// override removed DELIVERY_ORDER_EDIT. canPerm("editSchedule") (DELIVERY_EDIT) and canPerm("editDeliveryOrder")
// (DELIVERY_ORDER_EDIT) are independent, and follow the ACTIVE company's effective permissions from the server.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1", email: "u@x" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => {},
    },
  }),
}));

import { AuthProvider, useAuth } from "./AuthContext";

const CA = "11111111-1111-4111-8111-111111111111", CB = "22222222-2222-4222-8222-222222222222";

async function runAs(company, role, perms) {
  localStorage.clear();
  localStorage.setItem("pulseActiveCompanyId", company);
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({
    id: "u1", role, base_role: role, availableCompanies: [{ companyId: company }], activeCompanyId: company, effectiveRole: role, effectivePermissions: perms,
  }) }));
  function Probe() {
    const a = useAuth();
    return <pre data-testid="o">{JSON.stringify({ loading: a.loading, edit: a.canPerm("editSchedule"), doEdit: a.canPerm("editDeliveryOrder") })}</pre>;
  }
  const { unmount } = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(JSON.parse(screen.getByTestId("o").textContent).loading).toBe(false));
  const out = JSON.parse(screen.getByTestId("o").textContent);
  unmount();
  return out;
}

describe("canPerm — DELIVERY_EDIT and DELIVERY_ORDER_EDIT are independent and per-company", () => {
  test("a company override that removed DELIVERY_ORDER_EDIT: schedule editing yes, Delivery Order edit NO", async () => {
    expect(await runAs(CA, "manager", ["DELIVERY_EDIT", "DELIVERY_VIEW"])).toMatchObject({ edit: true, doEdit: false });
  });
  test("another company where the role holds both: both yes", async () => {
    expect(await runAs(CB, "manager", ["DELIVERY_EDIT", "DELIVERY_ORDER_EDIT"])).toMatchObject({ edit: true, doEdit: true });
  });
  test("only DELIVERY_ORDER_EDIT: Delivery Order edit yes, schedule editing no", async () => {
    expect(await runAs(CA, "manager", ["DELIVERY_ORDER_EDIT"])).toMatchObject({ edit: false, doEdit: true });
  });
  test("a user with neither: both no (no permissive default)", async () => {
    expect(await runAs(CA, "salesman", ["ORDERS_VIEW"])).toMatchObject({ edit: false, doEdit: false });
  });
});
