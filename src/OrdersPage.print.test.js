// Sales Order print pagination — regression guard on the print template in
// OrdersPage.js (printSalesOrder). Long orders must continue onto Page 2/3+
// at a readable size; they must never be shrunk to fit one page again, and
// the staff-only Internal Remark must never reach the customer-facing print.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "OrdersPage.js"), "utf8").replace(/\r\n/g, "\n");
const start = src.indexOf("function printSalesOrder(");
const end = src.indexOf("\n}\n", start);
const fn = src.slice(start, end);
if (start < 0 || end < 0) throw new Error("printSalesOrder not found in OrdersPage.js");

describe("Sales Order print pagination", () => {
  test("no whole-document shrink-to-fit (scale / zoom / overflow clipping)", () => {
    expect(fn).not.toMatch(/transform\s*[:=]\s*[`'"]?\s*scale/);
    expect(fn).not.toMatch(/\bzoom\s*:/);
    expect(fn).not.toMatch(/onBeforePrint/);
    expect(fn).not.toMatch(/overflow\s*=\s*["']hidden/);
  });

  test("item table header repeats and item rows never split across pages", () => {
    expect(fn).toMatch(/table\.items thead \{ display: table-header-group; \}/);
    expect(fn).toMatch(/table\.items tbody tr \{ page-break-inside: avoid; break-inside: avoid; \}/);
  });

  test("totals, payment, notes, terms and signature blocks are kept whole", () => {
    expect(fn).toMatch(/\.midrow \{ page-break-inside: avoid; break-inside: avoid; \}/);
    expect(fn).toMatch(/\.sign \{ page-break-inside: avoid; break-inside: avoid; \}/);
    expect(fn).toMatch(/\.keep, \.blk \{ page-break-inside: avoid; break-inside: avoid; \}/);
    expect(fn).toMatch(/<div class="keep sec"><div class="sectitle">Payment Method<\/div>/);
  });

  test("continuation pages carry SO number / copy / customer via the repeating thead", () => {
    expect(fn).toMatch(/<thead><tr class="ctx"><th colspan="5">Sales Order \$\{esc\(order\.order_number/);
  });

  test("totals block appears once per copy, after the item table", () => {
    const tpl = fn.slice(fn.indexOf("const html ="));
    expect((tpl.match(/BALANCE DUE/g) || []).length).toBe(1);
    expect(tpl.indexOf("BALANCE DUE")).toBeGreaterThan(tpl.indexOf("</table>"));
  });

  test("customer Remark prints; staff-only Internal Remark never does", () => {
    expect(fn).toMatch(/esc\(order\.remark \|\| order\.notes \|\| ""\)/);
    expect(fn).not.toMatch(/internal_remark/);
  });
});
