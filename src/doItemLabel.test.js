// SO 56364 / DO2610-0224: the SO showed "WAKO Bench … · Col: Natural / G04
// Beige" and "HAKO … · Main Col: MOLLY-04 | Motor: …", but the delivery
// schedule printed only the product name — a DO line's custom specs live on
// the source sales_order_item, which the schedule never read.
import { doItemLabel, doItemCustomDimensions } from "./doItemLabel";
import { buildTeamScheduleRows, teamScheduleItemCells } from "./DeliverySchedule";

const wako = {
  product_code: "CUSTOM", product_name: "WAKO Bench L1000 x D380 x H480", size: null, color: null, quantity: 1, status: "pending",
  sales_order_items: { custom_dimensions: "Col: Natural / G04 Beige" },
};
const hako = {
  product_code: "MOD", product_name: "HAKO 1118 3 Seater Incliner Sofa (2 Motor)", quantity: 1, status: "pending",
  sales_order_items: { custom_dimensions: "Main Col: MOLLY-04 | Motor: Middle & Right Side (View from TV)" },
};
const miami = { product_code: "MIAMI", product_name: "MIAMI 900 X 1500MM DINING TABLE", size: "L1500 W900 H750 mm", color: "NATURAL", quantity: 1, status: "pending" };

describe("doItemLabel", () => {
  test("appends the source SO line's custom specs", () => {
    expect(doItemLabel(wako)).toBe("WAKO Bench L1000 x D380 x H480 Col: Natural / G04 Beige");
    expect(doItemLabel(hako)).toBe("HAKO 1118 3 Seater Incliner Sofa (2 Motor) Main Col: MOLLY-04 | Motor: Middle & Right Side (View from TV)");
  });
  test("size + colour unchanged when there are no specs (and no source link)", () => {
    expect(doItemLabel(miami)).toBe("MIAMI 900 X 1500MM DINING TABLE L1500 W900 H750 mm NATURAL");
    expect(doItemLabel({ ...miami, sales_order_items: null })).toBe("MIAMI 900 X 1500MM DINING TABLE L1500 W900 H750 mm NATURAL");
  });
  test("a repeated value appears once; the DO line's own field wins when present", () => {
    expect(doItemLabel({ product_name: "Sofa", color: "Red", sales_order_items: { custom_dimensions: "Red" } })).toBe("Sofa Red");
    expect(doItemCustomDimensions({ custom_dimensions: "Leg: A1", sales_order_items: { custom_dimensions: "Leg: B2" } })).toBe("Leg: A1");
  });
});

describe("Print Schedule / PDF / Excel rows", () => {
  test("a DO stop's Item column carries the specs", () => {
    const team = {
      team_date: "2026-10-31",
      schedules: [{
        id: 1, sort_order: 1, delivery_order_id: "d1",
        orders: { id: 9, so_number: "56364", customer_name: "Cody Chang Weng Leong", items: "[]" },
        delivery_orders: { id: "d1", do_number: "DO2610-0224", status: "scheduled", delivery_order_items: [miami, hako, wako] },
      }],
    };
    const names = buildTeamScheduleRows(team).map(r => teamScheduleItemCells(r.item, r.idx).name.text);
    expect(names).toEqual([
      "MIAMI 900 X 1500MM DINING TABLE L1500 W900 H750 mm NATURAL",
      "HAKO 1118 3 Seater Incliner Sofa (2 Motor) Main Col: MOLLY-04 | Motor: Middle & Right Side (View from TV)",
      "WAKO Bench L1000 x D380 x H480 Col: Natural / G04 Beige",
    ]);
  });
});
