// Desktop login "t.some is not a function": a long-lived desktop browser can
// hold stale/legacy/corrupt state and receive wrong-shaped bootstrap data that
// a fresh phone never does. The app must (a) never crash at startup, and
// (b) FAIL CLOSED — malformed permission / company / role data must not grant
// access; the canonical server response wins over stale device data.
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";

const mockAuthCb = { current: null };
let mockSession = null;
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: mockSession } }),
      onAuthStateChange: (cb) => { mockAuthCb.current = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async () => { mockSession = null; },
      signInWithPassword: async () => ({ error: null }),
    },
  }),
}));

import { AuthProvider, useAuth } from "./AuthContext";

const CID = "11111111-2222-3333-4444-555555555555";
const CID2 = "99999999-2222-3333-4444-555555555555";
const sessionFor = (id = "u1") => ({ access_token: "tok", user: { id, email: `${id}@test.local` } });
const company = (id = CID) => ({ companyId: id, companyName: "Co", companyCode: "CO", roleName: "salesman" });

function profile(over = {}) {
  return {
    id: "u1", role: "salesman", base_role: "salesman", name: "Test",
    availableCompanies: [company()], activeCompanyId: CID,
    effectiveRole: "salesman", effectivePermissions: ["ORDERS_VIEW", "ORDERS_CREATE"],
    ...over,
  };
}

function Probe() {
  const a = useAuth();
  return (
    <pre data-testid="out">{JSON.stringify({
      loading: a.loading, user: !!a.user,
      perms: [...(a.permissions instanceof Set ? a.permissions : [])].sort(),
      companies: (a.availableCompanies || []).map(c => c.companyId),
      active: a.activeCompanyId, role: a.activeRoleKey,
      can: {
        ORDERS_VIEW: a.canPerm("ORDERS_VIEW"), FINANCE_VIEW: a.canPerm("FINANCE_VIEW"),
        SYSTEM_MANAGE_USERS: a.canPerm("SYSTEM_MANAGE_USERS"), editOrder: a.canPerm("editOrder"),
      },
    })}</pre>
  );
}
const out = () => JSON.parse(screen.getByTestId("out").textContent);

// routes: { profile: {status, body}, perms: {status, body} }
function mockApi(routes) {
  const seen = [];
  global.fetch = jest.fn(async (url, opts = {}) => {
    seen.push({ url: String(url), headers: opts.headers || {} });
    const r = String(url).includes("/auth/profile") ? routes.profile : String(url).includes("/permissions/effective") ? routes.perms : null;
    if (!r) return { ok: false, status: 404, json: async () => ({}) };
    const list = Array.isArray(r) ? r : [r];
    const pick = list[Math.min(seen.filter(s => s.url === String(url)).length - 1, list.length - 1)];
    return { ok: pick.status ? pick.status < 400 : true, status: pick.status || 200, json: async () => pick.body };
  });
  return seen;
}

async function boot() {
  const errs = jest.spyOn(console, "error").mockImplementation(() => {});
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(out().loading).toBe(false));
  await act(async () => { await new Promise(r => setTimeout(r, 250)); }); // let the delayed /permissions/effective refresh settle
  errs.mockRestore();
  return out();
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); mockSession = sessionFor(); });

describe("A/K/M. fresh desktop login and current-cache + current-API", () => {
  test("A. fresh device (no storage): canonical server data is applied", async () => {
    mockApi({ profile: { body: profile() } });
    const o = await boot();
    expect(o.user).toBe(true);
    expect(o.perms).toEqual(["ORDERS_CREATE", "ORDERS_VIEW"]);
    expect(o.companies).toEqual([CID]);
    expect(o.active).toBe(CID);
    expect(o.can.ORDERS_VIEW).toBe(true);
    expect(localStorage.getItem("pulseActiveCompanyId")).toBe(CID);
  });
  test("M. valid stored company + current profile: unchanged behaviour, header sent", async () => {
    localStorage.setItem("pulseActiveCompanyId", CID);
    const seen = mockApi({ profile: { body: profile() } });
    const o = await boot();
    expect(o.active).toBe(CID);
    expect(seen.find(s => s.url.includes("/auth/profile")).headers["X-Company-ID"]).toBe(CID);
    expect(o.can.ORDERS_VIEW).toBe(true);
  });
});

describe("B/L. legacy / unknown cached keys are never trusted", () => {
  test("legacy cached permissions/companies/role in storage are ignored — only the server grants", async () => {
    localStorage.setItem("pulsePermissions", JSON.stringify(["SYSTEM_MANAGE_USERS", "FINANCE_VIEW"]));
    localStorage.setItem("pulseCompanies", "{}");
    localStorage.setItem("pulseRole", "master");
    sessionStorage.setItem("permissions", "[]");
    mockApi({ profile: { body: profile() } });
    const o = await boot();
    expect(o.perms).toEqual(["ORDERS_CREATE", "ORDERS_VIEW"]);
    expect(o.can.SYSTEM_MANAGE_USERS).toBe(false);
    expect(o.can.FINANCE_VIEW).toBe(false);
    expect(o.role).toBe("salesman");
  });
  test("L. old cache (corrupt company id) + current API: no crash, poisoned key discarded, server company wins", async () => {
    localStorage.setItem("pulseActiveCompanyId", "[object Object]");
    const seen = mockApi({ profile: { body: profile() } });
    const o = await boot();
    expect(seen.find(s => s.url.includes("/auth/profile")).headers["X-Company-ID"]).toBeUndefined();
    expect(o.user).toBe(true);
    expect(o.active).toBe(CID);
    expect(localStorage.getItem("pulseActiveCompanyId")).toBe(CID);
  });
});

describe("C. malformed effectivePermissions never crash and never grant", () => {
  test.each([
    ["string", "ORDERS_VIEW,FINANCE_VIEW"],
    ["object map", { ORDERS_VIEW: true, FINANCE_VIEW: true }],
    ["null", null],
    ["empty string", ""],
    ["number", 7],
    ["array of non-strings", [1, null, {}]],
  ])("profile effectivePermissions as %s -> empty set; server refresh decides", async (_n, bad) => {
    mockApi({
      profile: { body: profile({ effectivePermissions: bad }) },
      perms: { body: { permissions: ["ORDERS_VIEW"], activeCompanyId: CID, roleKey: "salesman" } },
    });
    const o = await boot();
    expect(o.user).toBe(true);
    // granted ONLY what the canonical /permissions/effective returned
    expect(o.perms).toEqual(["ORDERS_VIEW"]);
    expect(o.can.ORDERS_VIEW).toBe(true);
    expect(o.can.FINANCE_VIEW).toBe(false);
    expect(o.can.SYSTEM_MANAGE_USERS).toBe(false);
  });
  test("malformed in BOTH profile and refresh: nothing extra granted for a restricted role (string would otherwise spread to characters)", async () => {
    mockApi({
      profile: { body: profile({ effectivePermissions: "FINANCE_VIEW" }) },
      perms: { body: { permissions: "FINANCE_VIEW" } },
    });
    const o = await boot();
    expect(o.user).toBe(true);
    expect(o.perms).toEqual([]);
    expect(o.can.FINANCE_VIEW).toBe(false);
    expect(o.can.SYSTEM_MANAGE_USERS).toBe(false);
  });
  test("corrupt JSON body from the permissions endpoint does not crash startup", async () => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes("/auth/profile")) return { ok: true, status: 200, json: async () => profile({ effectivePermissions: [] }) };
      return { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } };
    });
    const o = await boot();
    expect(o.user).toBe(true);
    expect(o.perms).toEqual([]);
  });
});

describe("D. wrong-shape availableCompanies exposes no company", () => {
  test.each([
    ["wrapper object", { companies: [company(CID2)] }],
    ["string", "[]"],
    ["null", null],
    ["single object", company(CID2)],
    ["entries without a usable companyId", [{}, null, "x", { companyId: 5 }, { companyId: "nope" }]],
  ])("%s", async (_n, bad) => {
    mockApi({ profile: { body: profile({ availableCompanies: bad }) } });
    const o = await boot();
    expect(o.user).toBe(true);
    expect(o.companies).toEqual([]);
  });
  test("a mixed array keeps only the valid company", async () => {
    mockApi({ profile: { body: profile({ availableCompanies: [company(CID), { companyId: "bad" }, null] }) } });
    expect((await boot()).companies).toEqual([CID]);
  });
});

describe("E. corrupt stored company id values never crash startup", () => {
  test.each(["", "null", "undefined", "{}", "[]", '{"a":1}', "not-a-uuid"])("stored %j", async (bad) => {
    localStorage.setItem("pulseActiveCompanyId", bad);
    const seen = mockApi({ profile: { body: profile() } });
    const o = await boot();
    expect(seen.find(s => s.url.includes("/auth/profile")).headers["X-Company-ID"]).toBeUndefined();
    expect(o.user).toBe(true);
    expect(o.active).toBe(CID);
  });
});

describe("F. stale (well-formed but no longer authorized) stored company", () => {
  test("403 -> cleared and retried with the server's canonical company; permissions applied via the same normalized path", async () => {
    localStorage.setItem("pulseActiveCompanyId", CID2);
    mockApi({ profile: [{ status: 403, body: { error: "no access" } }, { body: profile({ effectivePermissions: ["ORDERS_VIEW"] }) }] });
    const o = await boot();
    expect(o.user).toBe(true);
    expect(o.active).toBe(CID);
    expect(o.perms).toEqual(["ORDERS_VIEW"]);
    expect(localStorage.getItem("pulseActiveCompanyId")).toBe(CID);
  });
  test("403 retry with malformed permissions -> no crash, fail closed", async () => {
    localStorage.setItem("pulseActiveCompanyId", CID2);
    mockApi({
      profile: [{ status: 403, body: {} }, { body: profile({ effectivePermissions: { ORDERS_VIEW: true }, availableCompanies: "x" }) }],
      perms: { body: { permissions: null } },
    });
    const o = await boot();
    expect(o.user).toBe(true);
    expect(o.perms).toEqual([]);
    expect(o.companies).toEqual([]);
  });
});

describe("G/H. role fidelity", () => {
  test("G. restricted salesperson stays restricted", async () => {
    mockApi({ profile: { body: profile({ effectivePermissions: ["ORDERS_VIEW"] }) } });
    const o = await boot();
    expect(o.can.ORDERS_VIEW).toBe(true);
    expect(o.can.FINANCE_VIEW).toBe(false);
    expect(o.can.SYSTEM_MANAGE_USERS).toBe(false);
  });
  test("H. manager keeps the permissions the server grants; master keeps its bypass", async () => {
    mockApi({ profile: { body: profile({ role: "manager", base_role: "manager", effectiveRole: "manager", effectivePermissions: ["ORDERS_VIEW", "FINANCE_VIEW", "SYSTEM_MANAGE_USERS"] }) } });
    const m = await boot();
    expect(m.can.FINANCE_VIEW).toBe(true);
    expect(m.can.SYSTEM_MANAGE_USERS).toBe(true);
  });
  test("H2. master", async () => {
    mockApi({ profile: { body: profile({ role: "master", base_role: "master", effectiveRole: "master", effectivePermissions: ["ORDERS_VIEW"] }) } });
    const m = await boot();
    expect(m.can.SYSTEM_MANAGE_USERS).toBe(true);
    expect(m.role).toBe("master");
  });
});

describe("I/J. logout -> login", () => {
  test("logout clears the user; a following login applies the NEW user's permissions, not the previous user's", async () => {
    mockApi({ profile: [{ body: profile({ effectivePermissions: ["ORDERS_VIEW", "FINANCE_VIEW"] }) }, { body: profile({ id: "u2", effectivePermissions: ["ORDERS_VIEW"] }) }] });
    await boot();
    expect(out().can.FINANCE_VIEW).toBe(true);
    // sign out
    await act(async () => { mockSession = null; await mockAuthCb.current("SIGNED_OUT", null); });
    await waitFor(() => expect(out().user).toBe(false));
    // sign in as another, more restricted user (permissions must be REPLACED, never merged)
    await act(async () => { mockSession = sessionFor("u2"); await mockAuthCb.current("SIGNED_IN", mockSession); });
    await waitFor(() => expect(out().user).toBe(true));
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(out().perms).toEqual(["ORDERS_VIEW"]);
    expect(out().can.FINANCE_VIEW).toBe(false);
  });
});
