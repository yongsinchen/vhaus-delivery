// Delivery Order → linked Service info: internal, read-only display of the
// canonical Service cases of the DO's Sales Order.
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import LinkedServicesSection, { LinkedServicesView, isHistoricalService } from "./LinkedServicesSection";

jest.mock("./AuthContext", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } }));

const NOTE = "Line one: call customer 30 min before.\n第二行：客户要求下午三点后送货。\nLine three: QC before leaving.";
const svc = (over = {}) => ({ id: 1, service_type: 1, status: "scheduled", description: NOTE, due_date: "2026-10-09", schedule_tbc: false, _sv_number: "SV-0001", _order: { so_number: "SO-30001" }, _items: [], ...over });

describe("LinkedServicesView", () => {
  test("1. no Service → renders nothing (normal DO unchanged)", () => {
    const { container } = render(<LinkedServicesView services={[]} />);
    expect(container.innerHTML).toBe("");
    expect(render(<LinkedServicesView services={null} />).container.innerHTML).toBe("");
  });

  test("2–4. active Service: id, type, status, linked SO, scheduled date, full multi-line Chinese note", () => {
    render(<LinkedServicesView services={[svc()]} />);
    expect(screen.getByText("SERVICE (1 active)")).toBeTruthy();
    expect(screen.getByText("SV-0001")).toBeTruthy();
    expect(screen.getByText("Warranty Repair")).toBeTruthy();
    expect(screen.getByText("Scheduled", { selector: "span.rounded-full" })).toBeTruthy();
    expect(screen.getByText("SO-30001")).toBeTruthy();
    expect(screen.getByText(new Date("2026-10-09T00:00:00").toLocaleDateString("en-MY"))).toBeTruthy();
    const note = screen.getByText((_, el) => el?.tagName === "P" && el.textContent === NOTE);
    expect(note.className).toMatch(/whitespace-pre-line/);
    expect(note.className).toMatch(/break-words/);
    expect(note.className).not.toMatch(/truncate|line-clamp/);
  });

  test("5. Service items with their own quantities", () => {
    render(<LinkedServicesView services={[svc({ _items: [
      { id: 11, description: "Sofa leg — replace", action_type: 2, quantity: 2, status: "pending" },
      { id: 12, description: "抽屉滑轨", action_type: 3, quantity: 1, status: "done" },
    ] })]} />);
    expect(screen.getByText("Sofa leg — replace")).toBeTruthy();
    expect(screen.getByText("×2")).toBeTruthy();
    expect(screen.getByText("抽屉滑轨")).toBeTruthy();
    expect(screen.getByText("×1 · ✓ done")).toBeTruthy();
    expect(screen.getByText("[Claim]", { exact: false })).toBeTruthy();
  });

  test("6. Service without items still shows its note; TBC schedule shown as TBC", () => {
    render(<LinkedServicesView services={[svc({ description: "Assemble wardrobe on site", schedule_tbc: true, due_date: null, _items: [] })]} />);
    expect(screen.getByText("Assemble wardrobe on site")).toBeTruthy();
    expect(screen.getByText("TBC")).toBeTruthy();
  });

  test("7. multiple Service cases are separate cards, notes not merged", () => {
    render(<LinkedServicesView services={[svc({ id: 1, _sv_number: "SV-0001", description: "Note A" }), svc({ id: 2, _sv_number: "SV-0002", service_type: 2, status: "open", description: "Note B" })]} />);
    expect(screen.getAllByTestId("linked-service-card")).toHaveLength(2);
    expect(screen.getByText("Note A")).toBeTruthy();
    expect(screen.getByText("Note B")).toBeTruthy();
    expect(screen.getByText("SERVICE (2 active)")).toBeTruthy();
  });

  test("8. completed Service is history, not shown as the active one", () => {
    render(<LinkedServicesView services={[svc({ id: 1, description: "Current job" }), svc({ id: 2, _sv_number: "SV-OLD", status: "resolved", description: "Old exchange — done" })]} />);
    expect(screen.getByText("SERVICE (1 active)")).toBeTruthy();
    expect(screen.queryByText("Old exchange — done")).toBeNull();
    fireEvent.click(screen.getByText(/Show 1 completed Service case/));
    expect(screen.getByText("Old exchange — done")).toBeTruthy();
    expect(isHistoricalService({ status: "closed" })).toBe(true);
    expect(isHistoricalService({ status: "in_progress" })).toBe(false);
  });

  test("8b. only completed cases → says no active case, history still reachable", () => {
    render(<LinkedServicesView services={[svc({ status: "resolved", description: "Done long ago" })]} />);
    expect(screen.getByText("No active Service case for this order.")).toBeTruthy();
    expect(screen.queryByText("Done long ago")).toBeNull();
  });
});

describe("LinkedServicesSection (data)", () => {
  afterEach(() => { delete global.fetch; });

  test("9. asks the canonical endpoint by the DO's SO number (works for any DO generation)", async () => {
    const calls = [];
    global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ services: [svc()] }) }; };
    render(<LinkedServicesSection soNumber="SO-30001" />);
    await waitFor(() => expect(screen.getByText("SV-0001")).toBeTruthy());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/service-cases\?so_number=SO-30001$/);
    expect(calls[0].opts.method).toBeUndefined(); // read-only GET
  });

  test("errors and denied requests render nothing", async () => {
    global.fetch = async () => ({ ok: false, json: async () => ({ error: "nope" }) });
    const { container } = render(<LinkedServicesSection soNumber="SO-1" />);
    await new Promise(r => setTimeout(r, 0));
    expect(container.innerHTML).toBe("");
  });

  test("no SO number → no request, nothing rendered", async () => {
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, json: async () => ({ services: [] }) }; };
    const { container } = render(<LinkedServicesSection soNumber={null} />);
    await new Promise(r => setTimeout(r, 0));
    expect(called).toBe(false);
    expect(container.innerHTML).toBe("");
  });
});

describe("11. customer-facing DO print never includes internal Service info", () => {
  const src = fs.readFileSync(path.join(__dirname, "DeliverySchedule.js"), "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf("function printDeliveryOrder(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  test("printDeliveryOrder doesn't read Service data", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toMatch(/service|LinkedServices/i);
  });
  test("the Service section is mounted only in INTERNAL, interactive views: the unassigned preview modal and the Delivery Orders tab detail row — never print/export", () => {
    const uses = [...src.matchAll(/<LinkedServicesSection /g)].map(m => m.index);
    expect(uses).toHaveLength(2);
    const modalStart = src.indexOf("function UnassignedPreviewModal(");
    const modalEnd = src.indexOf("\nfunction ", modalStart + 10);
    const tabStart = src.indexOf("function DeliveryOrdersTab(");
    const tabEnd = src.indexOf("\nfunction ", tabStart + 10);
    expect(uses.filter(i => i > modalStart && i < modalEnd)).toHaveLength(1);
    expect(uses.filter(i => i > tabStart && i < tabEnd)).toHaveLength(1);
    // and never inside the DO print / export builders
    const exStart = src.indexOf("async function exportDeliveryOrderExcel(");
    const exRest = src.slice(exStart + 10);
    const exEnd = exRest.search(/\n(async function |function |export function |export default )/);
    const exBody = exRest.slice(0, exEnd);
    expect(exBody).not.toMatch(/LinkedServices/);
  });
});
