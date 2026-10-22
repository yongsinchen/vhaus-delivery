// Delivery print — the customer's preferred time (orders.time_slot, the purple "AFTER 3PM" tag on the board) prints
// when the dispatcher has not confirmed a slot. Before: only a confirmed slot printed, so SO 56413 / DO2610-0177
// went out with no time at all. A confirmed slot still wins. Same rule on the printed sheet, PDF and Excel.
import { render, screen } from "@testing-library/react";
import { TeamPrintView, stopTimeLabel, teamScheduleStopCells } from "./DeliverySchedule";

const order = (extra = {}) => ({ id: 56413, so_number: "56413", customer_name: "Chua Hanson", contact: "0127127690", address: "3, Jalan Harmonium 21/6", items: "[]", balance: 0, remark: "TOLONG CUSTOMER DISPOSE 2 SUPER SINGLE MATTRESS", ...extra });
const sched = (extra = {}, o = {}) => ({ id: "s1", sort_order: 1, slot: null, orders: order(o), ...extra });
const infoTexts = (o, sc) => teamScheduleStopCells(o, sc, [{}], { vehicle_plate: "JWN8225" }).info.map(p => p.text);

describe("stopTimeLabel", () => {
  test("no confirmed slot → the customer's preferred time", () => {
    expect(stopTimeLabel({ slot: null }, { time_slot: "AFTER 3PM" })).toEqual({ text: "Pref: AFTER 3PM", kind: "pref" });
  });
  test("a confirmed slot wins over the preference", () => {
    expect(stopTimeLabel({ slot: "3-5pm" }, { time_slot: "AFTER 3PM" })).toEqual({ text: "Slot: 3-5pm", kind: "slot" });
  });
  test("neither (or blanks) → nothing printed", () => {
    expect(stopTimeLabel({ slot: "  " }, { time_slot: "" })).toBeNull();
    expect(stopTimeLabel({}, {})).toBeNull();
    expect(stopTimeLabel(undefined, undefined)).toBeNull();
  });
});

describe("PDF / Excel cells (teamScheduleStopCells)", () => {
  test("preferred time printed under the customer when no slot is confirmed", () => {
    expect(infoTexts(order({ time_slot: "AFTER 3PM" }), { slot: null })).toContain("Pref: AFTER 3PM");
  });
  test("confirmed slot printed instead — the preference is not printed twice", () => {
    const t = infoTexts(order({ time_slot: "AFTER 3PM" }), { slot: "3-5pm" });
    expect(t).toContain("Slot: 3-5pm");
    expect(t.some(x => /^Pref:/.test(x))).toBe(false);
  });
  test("the remark column is unchanged", () => {
    const o = order({ time_slot: "AFTER 3PM" });
    const cells = teamScheduleStopCells(o, { slot: null }, [{}], {});
    expect(cells.remark.map(p => p.text)).toEqual(["TOLONG CUSTOMER DISPOSE 2 SUPER SINGLE MATTRESS"]);
  });
});

describe("printed sheet (TeamPrintView)", () => {
  const renderTeam = schedules => render(<TeamPrintView team={{ vehicle_plate: "JWN8225", team_date: "2026-10-22", schedules }} onClose={() => {}} company={{}} />);
  test("SO 56413 with AFTER 3PM and no slot → 'Pref: AFTER 3PM' on the sheet", () => {
    renderTeam([sched({}, { time_slot: "AFTER 3PM" })]);
    expect(screen.getByText("Pref: AFTER 3PM")).toBeTruthy();
    expect(screen.getByText("TOLONG CUSTOMER DISPOSE 2 SUPER SINGLE MATTRESS")).toBeTruthy();
  });
  test("a confirmed slot prints as before", () => {
    renderTeam([sched({ slot: "800-1000" }, { time_slot: "AFTER 3PM" })]);
    expect(screen.getByText("Slot: 800-1000")).toBeTruthy();
    expect(screen.queryByText("Pref: AFTER 3PM")).toBeNull();
  });
  test("no time at all → no time line", () => {
    const { container } = renderTeam([sched({}, { time_slot: null })]);
    expect(container.querySelector('[data-field="stop-time"]')).toBeNull();
  });
});
