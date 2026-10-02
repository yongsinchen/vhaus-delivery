// DO2609-0246 / SO56182: Order Detail showed the full CUSTOM item spec
// ([CUSTOM] MT8030-180 180X90CM LEG: T416) but Print Preview / the printed
// Delivery Order dropped "LEG: T416" — a delivery_order_item's own snapshot
// columns (written once at DO-creation time) never carried
// custom_dimensions/custom_specs at all. The fix: DELIVERY_ORDER_LIST_SELECT
// now also joins the source sales_order_item (sales_order_item_id), and
// doItemSpec() reads custom_dimensions from there, falling back to the DO
// item's own fields for a legacy row with no source link.
//
// sales_order_items.notes is deliberately NOT part of this spec — Order
// Detail's own read-only item view never shows it either (only the item-edit
// form does), and in production it is frequently an auto-written internal
// arrival-tracking stamp ("Arrived: 2026-05-08"), never meant for a
// customer-facing printed document.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "DeliverySchedule.js"), "utf8").replace(/\r\n/g, "\n");
const start = src.indexOf("function doItemSpec(");
const end = src.indexOf("\n}\n", start);
if (start < 0 || end < 0) throw new Error("doItemSpec not found in DeliverySchedule.js");
const doItemSpec = new Function(`${src.slice(start, end + 2)}; return doItemSpec;`)();

describe("doItemSpec — canonical Delivery Order item description", () => {
  test("A. CUSTOM item: full spec visible (the SO56182 / DO2609-0246 reproduction)", () => {
    const it = {
      size: "180X90CM", color: null, product_code: "CUSTOM", product_name: "MT8030-180",
      sales_order_items: { custom_dimensions: "LEG: T416", custom_specs: null, notes: "SOYO 180 1+4 BUNDLE" },
    };
    const { spec } = doItemSpec(it);
    expect(spec).toBe("180X90CM · LEG: T416");
  });

  test("B. Normal product (C9700 Chair, WALNUT & BEIGE CUSHION) — complete description, no regression", () => {
    const it = {
      size: null, color: "WALNUT & BEIGE CUSHION", product_code: "C9700", product_name: "Chair",
      sales_order_items: { custom_dimensions: null, custom_specs: null, notes: "SOYO 180 1+4 BUNDLE" },
    };
    const { spec } = doItemSpec(it);
    expect(spec).toBe("WALNUT & BEIGE CUSHION");
  });

  test("C. CUSTOM with dimensions but no custom_specs — no blank/undefined text", () => {
    const it = { size: "90CM", color: null, sales_order_items: { custom_dimensions: "COLOR: RED", custom_specs: null, notes: null } };
    const { spec } = doItemSpec(it);
    expect(spec).toBe("90CM · COLOR: RED");
    expect(spec).not.toMatch(/undefined|null/);
  });

  test("D. CUSTOM with no dimensions — size/color alone, no blank text", () => {
    const it = { size: "Single", color: null, sales_order_items: { custom_dimensions: null, custom_specs: null, notes: null } };
    const { spec } = doItemSpec(it);
    expect(spec).toBe("Single");
  });

  test("E. Normal product with size + color — both preserved", () => {
    const it = { size: "Queen", color: "Grey", sales_order_items: { custom_dimensions: null, custom_specs: null, notes: null } };
    const { spec } = doItemSpec(it);
    expect(spec).toBe("Queen · Grey");
  });

  test("G. No duplicate text when the same value appears in more than one field", () => {
    const it = { size: "Red", color: "Red", sales_order_items: { custom_dimensions: "Red", custom_specs: null, notes: null } };
    const { spec } = doItemSpec(it);
    expect(spec).toBe("Red"); // deduplicated, not "Red · Red · Red"
  });

  test("H. sales_order_items.notes is never read — it is frequently an internal arrival-tracking stamp, not a customer spec", () => {
    const it = {
      size: null, color: null,
      sales_order_items: { custom_dimensions: null, custom_specs: null, notes: "Arrived: 2026-05-08" },
    };
    const { spec } = doItemSpec(it);
    expect(spec).not.toMatch(/Arrived/);
    expect(doItemSpec(it).notes).toBeUndefined();
  });

  test("I. Legacy item lacking a source sales_order_item — safe fallback to the DO item's own fields", () => {
    const it = { size: "Single", color: null, custom_dimensions: "Leg: A1" }; // no .sales_order_items at all
    const { spec } = doItemSpec(it);
    expect(spec).toBe("Single · Leg: A1");
  });

  test("never reads Internal Remark", () => {
    expect(src.slice(start, end)).not.toMatch(/internal_remark/i);
  });
});

describe("printDeliveryOrder / exportDeliveryOrderExcel source — use the canonical builder, not a narrower inline one", () => {
  const pStart = src.indexOf("function printDeliveryOrder(");
  const pBody = src.slice(pStart, src.indexOf("\n}\n", pStart));
  const eStart = src.indexOf("async function exportDeliveryOrderExcel(");
  const eBody = src.slice(eStart, src.indexOf("\nasync function ", eStart + 10));

  test("printDeliveryOrder calls doItemSpec(it)", () => {
    expect(pBody).toMatch(/doItemSpec\(it\)/);
    expect(pBody).not.toMatch(/\[it\.size,\s*it\.color\]\.filter/);
  });

  test("exportDeliveryOrderExcel calls doItemSpec(it)", () => {
    expect(eBody).toMatch(/doItemSpec\(it\)/);
    expect(eBody).not.toMatch(/\[it\.size,\s*it\.color\]\.filter/);
  });

  // F. Long description wrapping — the DESCRIPTION column must never clip or
  // ellipsis-truncate a multi-line spec; the previous Sales Order pagination
  // fix is a separate template entirely (OrdersPage.js) and is untouched.
  test("F. the item description column has no width/overflow/white-space rule that would clip a long description", () => {
    expect(pBody).not.toMatch(/text-overflow\s*:\s*ellipsis/);
    expect(pBody).not.toMatch(/white-space\s*:\s*nowrap/);
    expect(pBody).not.toMatch(/overflow\s*:\s*hidden/);
  });

  // H. Internal Remark (and now also sales_order_items.notes) must never
  // reach the printed/exported Delivery Order.
  test("H. Internal Remark and item notes are never read by either builder", () => {
    expect(pBody).not.toMatch(/internal_remark/i);
    expect(eBody).not.toMatch(/internal_remark/i);
    expect(pBody).not.toMatch(/it\.notes|src\.notes/);
    expect(eBody).not.toMatch(/it\.notes|src\.notes/);
  });

  // J. Multiple items — each row's description comes from its OWN line; no
  // cross-line leakage (doItemSpec is a pure function of its single argument,
  // called once per item inside each .map()/.forEach() — verified structurally).
  test("J. doItemSpec is called once per item inside the row-building loop, not hoisted/shared", () => {
    expect(pBody).toMatch(/items\.map\(\(it, i\) => \{[\s\S]*doItemSpec\(it\)/);
    expect(eBody).toMatch(/items\.forEach\(\(it, i\) => \{[\s\S]*doItemSpec\(it\)/);
  });
});
