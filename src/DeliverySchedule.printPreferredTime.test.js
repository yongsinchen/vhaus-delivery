// Delivery print — the stop's delivery times: the slot the dispatcher confirmed ("Slot: 1500 - 1700") AND the
// customer's preferred time from the order (orders.time_slot, the purple "AFTER 3PM" tag on the board). Both print
// when both are set (SO 56413 / DO2610-0177); the preference alone prints when no slot is confirmed; it is left out
// only when it says the same as the slot. Same rule on the printed sheet, PDF and Excel.
import { render, screen } from "@testing-library/react";
import { TeamPrintView, stopTimeLabels, teamScheduleStopCells } from "./DeliverySchedule";

const order = (extra = {}) => ({ id: 56413, so_number: "56413", customer_name: "Chua Hanson", contact: "0127127690", address: "3, Jalan Harmonium 21/6", items: "[]", balance: 0, remark: "TOLONG CUSTOMER DISPOSE 2 SUPER SINGLE MATTRESS", ...extra });
const sched = (extra = {}, o = {}) => ({ id: "s1", sort_order: 1, slot: null, orders: order(o), ...extra });
const infoTexts = (o, sc) => teamScheduleStopCells(o, sc, [{}], { vehicle_plate: "JWN8225" }).info.map(p => p.text);

describe("stopTimeLabels", () => {
  test("slot AND preference → both, slot first (SO 56413)", () => {
    expect(stopTimeLabels({ slot: "1500 - 1700" }, { time_slot: "AFTER 3PM" })).toEqual([
      { text: "Slot: 1500 - 1700", kind: "slot" }, { text: "Pref: AFTER 3PM", kind: "pref" }]);
  });
  test("no confirmed slot → the preference alone", () => {
    expect(stopTimeLabels({ slot: null }, { time_slot: "AFTER 3PM" })).toEqual([{ text: "Pref: AFTER 3PM", kind: "pref" }]);
  });
  test("slot alone → the slot alone", () => {
    expect(stopTimeLabels({ slot: "800-1000" }, { time_slot: "" })).toEqual([{ text: "Slot: 800-1000", kind: "slot" }]);
  });
  test("preference saying the same as the slot is not repeated (spaces / dashes ignored)", () => {
    expect(stopTimeLabels({ slot: "1500 - 1700" }, { time_slot: "1500-1700" })).toEqual([{ text: "Slot: 1500 - 1700", kind: "slot" }]);
    expect(stopTimeLabels({ slot: "after 3pm" }, { time_slot: "AFTER 3PM" })).toEqual([{ text: "Slot: after 3pm", kind: "slot" }]);
  });
  test("neither (or blanks) → nothing", () => {
    expect(stopTimeLabels({ slot: "  " }, { time_slot: "" })).toEqual([]);
    expect(stopTimeLabels({}, {})).toEqual([]);
    expect(stopTimeLabels(undefined, undefined)).toEqual([]);
  });
});

describe("PDF / Excel cells (teamScheduleStopCells)", () => {
  test("both times printed under the customer, slot then preference", () => {
    const t = infoTexts(order({ time_slot: "AFTER 3PM" }), { slot: "1500 - 1700" });
    expect(t.slice(-2)).toEqual(["Slot: 1500 - 1700", "Pref: AFTER 3PM"]);
  });
  test("preference alone when no slot is confirmed", () => {
    expect(infoTexts(order({ time_slot: "AFTER 3PM" }), { slot: null })).toContain("Pref: AFTER 3PM");
  });
  test("the remark column is unchanged", () => {
    const cells = teamScheduleStopCells(order({ time_slot: "AFTER 3PM" }), { slot: "1500 - 1700" }, [{}], {});
    expect(cells.remark.map(p => p.text)).toEqual(["TOLONG CUSTOMER DISPOSE 2 SUPER SINGLE MATTRESS"]);
  });
});

describe("printed sheet (TeamPrintView)", () => {
  const renderTeam = schedules => render(<TeamPrintView team={{ vehicle_plate: "JWN8225", team_date: "2026-10-22", schedules }} onClose={() => {}} company={{}} />);
  test("SO 56413: 'Slot: 1500 - 1700' AND 'Pref: AFTER 3PM' on the sheet, remark kept", () => {
    renderTeam([sched({ slot: "1500 - 1700" }, { time_slot: "AFTER 3PM" })]);
    expect(screen.getByText("Slot: 1500 - 1700")).toBeTruthy();
    expect(screen.getByText("Pref: AFTER 3PM")).toBeTruthy();
    expect(screen.getByText("TOLONG CUSTOMER DISPOSE 2 SUPER SINGLE MATTRESS")).toBeTruthy();
  });
  test("no slot → the preference alone", () => {
    renderTeam([sched({}, { time_slot: "AFTER 3PM" })]);
    expect(screen.getByText("Pref: AFTER 3PM")).toBeTruthy();
    expect(screen.queryByText(/^Slot:/)).toBeNull();
  });
  test("no time at all → no time line", () => {
    const { container } = renderTeam([sched({}, { time_slot: null })]);
    expect(container.querySelector('[data-field="stop-time"]')).toBeNull();
  });
});
