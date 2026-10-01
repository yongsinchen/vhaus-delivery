// Service item quantity: whole number >= 1, default 1, never silently coerced.
import { render, screen, fireEvent } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { parseServiceItemQty, serviceItemQty } from "./serviceItemQty";
import ServiceCaseFormModal from "./ServiceCaseFormModal";
import { LinkedServicesView } from "./LinkedServicesSection";

const mockWarnings = [];
const mockToast = { success() {}, warning: (m) => mockWarnings.push(m), error() {}, info() {} };
jest.mock("./AuthContext", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } }));
jest.mock("./UIComponents", () => ({ useToast: () => mockToast, useLoading: () => ({ withLoading: async (_m, fn) => fn() }) }));

describe("parseServiceItemQty / serviceItemQty", () => {
  test("whole numbers ≥ 1 accepted", () => {
    expect(parseServiceItemQty(1).value).toBe(1);
    expect(parseServiceItemQty("4").value).toBe(4);
    expect(parseServiceItemQty(" 2 ").value).toBe(2);
  });
  test("0, negative, decimal, blank, malformed rejected — no coercion", () => {
    for (const v of [0, "0", -1, "-1", 2.5, "2.5", "", "  ", "abc", "1e2", null, undefined, NaN, "4x"]) {
      expect(parseServiceItemQty(v).ok).toBe(false);
    }
  });
  test("legacy display fallback: NULL / junk → 1; valid values unchanged", () => {
    expect(serviceItemQty(null)).toBe(1);
    expect(serviceItemQty(undefined)).toBe(1);
    expect(serviceItemQty("x")).toBe(1);
    expect(serviceItemQty(4)).toBe(4);
    expect(serviceItemQty("2")).toBe(2);
  });
});

describe("New Service Case form", () => {
  beforeEach(() => { mockWarnings.length = 0; });
  afterEach(() => { delete global.fetch; });

  const setup = () => {
    const calls = [];
    global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ service: { id: 1 }, request: { id: 1 } }) }; };
    render(<ServiceCaseFormModal mode="create" isApprover onClose={() => {}} onSaved={() => {}} />);
    return calls;
  };
  const addItem = (desc, qty) => {
    fireEvent.click(screen.getByText("+ Add Item"));
    const descs = screen.getAllByPlaceholderText("e.g. Dining chair");
    fireEvent.change(descs[descs.length - 1], { target: { value: desc } });
    if (qty !== undefined) {
      const qtys = screen.getAllByTitle("Quantity");
      fireEvent.change(qtys[qtys.length - 1], { target: { value: qty } });
    }
  };

  test("1/2/3. new item defaults to 1; items 1 / 4 / 2 are sent as entered, in order", async () => {
    const calls = setup();
    addItem("Mattress protector");
    expect(screen.getAllByTitle("Quantity")[0].value).toBe("1");
    addItem("Chair leg", "4");
    addItem("Touch-up kit", "2");
    fireEvent.click(screen.getByText("Create"));
    await new Promise(r => setTimeout(r, 0));
    const post = calls.find(c => /\/service-cases$/.test(c.url));
    expect(post).toBeTruthy();
    expect(JSON.parse(post.opts.body).items.map(i => [i.description, i.quantity])).toEqual([["Mattress protector", 1], ["Chair leg", 4], ["Touch-up kit", 2]]);
  });

  test.each([["0"], ["-1"], ["2.5"], [""]])("7–10. quantity %p blocks the save with a message (no request sent)", async (bad) => {
    const calls = setup();
    addItem("Chair leg", bad);
    fireEvent.click(screen.getByText("Create"));
    await new Promise(r => setTimeout(r, 0));
    expect(mockWarnings).toContain("Item 1: quantity must be a whole number of at least 1");
    expect(calls.some(c => /\/service-cases$/.test(c.url))).toBe(false);
  });

  test("18. a case with no items still saves (no item forced)", async () => {
    const calls = setup();
    fireEvent.click(screen.getByText("Create"));
    await new Promise(r => setTimeout(r, 0));
    const post = calls.find(c => /\/service-cases$/.test(c.url));
    expect(JSON.parse(post.opts.body).items).toEqual([]);
  });
});

describe("displays", () => {
  test("15/16. Linked Service Info shows each case's own quantities; legacy NULL reads ×1", () => {
    render(<LinkedServicesView services={[
      { id: 1, service_type: 1, status: "scheduled", _sv_number: "SV-1", _items: [{ id: 11, description: "Chair leg", action_type: 2, quantity: 4 }, { id: 12, description: "Legacy part", action_type: 2, quantity: null }] },
      { id: 2, service_type: 2, status: "open", _sv_number: "SV-2", _items: [{ id: 21, description: "Hinge", action_type: 2, quantity: 6 }] },
    ]} />);
    const cards = screen.getAllByTestId("linked-service-card");
    expect(cards[0].textContent).toContain("Chair leg×4");
    expect(cards[0].textContent).toContain("Legacy part×1");
    expect(cards[1].textContent).toContain("Hinge×6");
    expect(cards[1].textContent).not.toContain("Chair leg");
  });

  test("12/13. Service page list, Service Note print and Excel use the shared quantity helper", () => {
    const src = fs.readFileSync(path.join(__dirname, "ServicePage.js"), "utf8");
    expect(src).toMatch(/<td class="qty">\$\{esc\(serviceItemQty\(it\.quantity\)\)\}<\/td>/);
    expect(src).toMatch(/writeRow\(it\.description \|\| "—", serviceItemQty\(it\.quantity\), false\)/);
    expect(src).toMatch(/×\{serviceItemQty\(it\.quantity\)\}/);
    expect(src).not.toMatch(/Math\.floor\(Number\(/); // no silent decimal truncation left
  });
});
