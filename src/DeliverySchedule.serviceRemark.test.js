// Delivery Schedule print — a Service stop's Service Note (orders.service_note,
// the backend-synced copy of services.description) must print in the Remark
// column, including when the case has line items. Renders the real
// TeamPrintView; never substitutes any other remark for a Service stop.
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import { TeamPrintView } from "./DeliverySchedule";

const svcStop = (id, sort_order, so_number, orders) => ({
  id, sort_order, slot: null,
  orders: { id: 1000 + id, so_number, customer_name: "Cust " + so_number, contact: "012-0000000", address: "Kulai", balance: 0, type: "Service", ...orders },
});
const note = (linked, text) => (text ? `Linked to SO: ${linked} | ${text}` : `Linked to SO: ${linked}`);
const items2 = JSON.stringify([{ itemName: "Sofa leg — replace (front left)", unit: "2" }, { itemName: "Cushion zip repair", unit: "1" }]);
const LONG = Array.from({ length: 12 }, (_, k) => `Line ${k + 1}: level 23, service lift only, guard house needs 24h notice.`).join("\n");

const team = {
  vehicle_plate: "TEST-SVC", driver_name: "QA", area: "Kulai", team_date: "2026-10-01",
  schedules: [
    svcStop(1, 1, "SV-SHORT", { linked_so: "56190", service_note: note("56190", "PREFER AFTER 3PM, PLS QC KAW KAW"), remark: note("56190", "PREFER AFTER 3PM, PLS QC KAW KAW"), items: items2 }),
    svcStop(2, 2, "SV-MULTI", { linked_so: "55732 55733", service_note: note("55732 55733", "Call 30 min before.\nBring replacement leg.\nQC before leaving."), items: items2 }),
    svcStop(3, 3, "SV-LONG", { linked_so: "55801", service_note: note("55801", LONG), items: items2 }),
    svcStop(4, 4, "SV-NONE", { linked_so: "55908 55909", service_note: note("55908 55909", ""), items: items2 }),
    svcStop(5, 5, "SV-NOITEMS", { linked_so: "56001", service_note: note("56001", "Adjust wardrobe door alignment"), items: "[]" }),
    // A regular SO stop keeps its own remark; its internal remark never prints.
    { id: 6, sort_order: 6, slot: null, orders: { id: 1006, so_number: "SO-REG", customer_name: "Cust SO", balance: 0, type: "Delivery", remark: "SO customer remark", internal_remark: "SO-INTERNAL-LEAK", items: JSON.stringify([{ itemName: "Bed frame", unit: "1" }]) } },
  ],
};

const html = renderToStaticMarkup(<TeamPrintView team={team} onClose={() => {}} company={{}} />);
const area = html.slice(html.indexOf('class="print-area'));
const count = (s) => area.split(s).length - 1;

if (process.env.SVC_PRINT_OUT) {
  const inner = area.slice(area.indexOf(">") + 1);
  fs.writeFileSync(process.env.SVC_PRINT_OUT, `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:8mm}html,body{margin:0;padding:0}body{font-family:Arial,sans-serif;width:281mm;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}.order-block{page-break-inside:avoid}table{border-collapse:collapse;table-layout:fixed;width:100%;font-size:10px}</style></head><body><div>${inner}</body></html>`);
}

describe("Delivery Schedule print — Service Note remark", () => {
  test("short and multi-line Service Notes print in the Remark column of a stop with items", () => {
    expect(count("PREFER AFTER 3PM, PLS QC KAW KAW")).toBe(1);
    expect(area).toContain("Call 30 min before.\nBring replacement leg.\nQC before leaving.");
    expect(area).toMatch(/white-space:pre-wrap[^>]*>Call 30 min before\./);
  });

  test("long Service Note prints in full", () => {
    expect(area).toContain("Line 12: level 23");
  });

  test("multi-SO prefix is stripped; the linked SOs print under the Service number (each labelled)", () => {
    expect(area).toMatch(/<div style="font-weight:bold">SV-MULTI<\/div><div style="font-weight:bold" data-field="linked-so">Linked SO: SO55732 \/ SO55733<\/div>/);
    expect(area).not.toContain("55733 | ");
    expect(area).not.toContain("Linked to SO:");
  });

  test("a case without a note prints no Remark text at all — the linked SO is in the header, not Remark", () => {
    expect(area).toContain("Linked SO: SO55908 / SO55909");
    expect(area).not.toContain("<div>Linked SO:"); // the old Remark line is gone everywhere
  });

  test("a case without items shows its note once (as the Item), not duplicated", () => {
    expect(count("Adjust wardrobe door alignment")).toBe(1);
  });

  test("SO stops keep their own remark; internal remark never prints", () => {
    expect(count("SO customer remark")).toBe(1);
    expect(area).not.toContain("SO-INTERNAL-LEAK");
  });
});
