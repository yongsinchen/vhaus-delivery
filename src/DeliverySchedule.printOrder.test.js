// URGENT fix (round 2) — Delivery Schedule canonical ordering.
//
// Round 1 (commit 4a47af0) added a print-only defensive sort on the theory
// that print trusted array order the board didn't. Production verification
// proved that wrong: the board and print already computed the IDENTICAL
// order — both derive from ONE shared comparator. The real bug is inside
// that comparator: it compared the free-text `slot` field as a STRING
// ("1000-1200".localeCompare("800-1000") sorts "1000-1200" first, since '1' <
// '8' as a character), not chronologically. This suite proves the fix at
// three levels: the pure time parser, the shared comparator used by BOTH
// loadData() (the board) and sortSchedulesForPrint() (print), and the actual
// rendered TeamPrintView DOM — so a regression here, on either surface, is
// caught.
import { render, screen } from "@testing-library/react";
import { TeamPrintView, parseSlotStartMinutes, compareScheduleOrder, sortSchedulesForPrint } from "./DeliverySchedule";

function sched(id, sort_order, soNumber, extra = {}) {
  return {
    id, sort_order, slot: null,
    orders: { id: 1000 + (sort_order ?? 0), so_number: soNumber, customer_name: "Cust-" + soNumber, items: "[]", balance: 0 },
    ...extra,
  };
}
function schedWithSlot(id, slot, soNumber, extra = {}) {
  return { ...sched(id, null, soNumber, extra), slot };
}

function renderedSoOrder(schedules, teamOverrides = {}) {
  const team = { vehicle_plate: "ABC123", team_date: "2026-09-16", schedules, ...teamOverrides };
  const { unmount } = render(<TeamPrintView team={team} onClose={() => {}} company={{}} />);
  const order = screen.getAllByText(/^SO-[\w-]+$/).map(el => el.textContent);
  unmount();
  return order;
}

describe("parseSlotStartMinutes — chronological parsing of real production slot formats", () => {
  test("800-1000 parses before 1000-1200 (the confirmed lexicographic bug case)", () => {
    expect(parseSlotStartMinutes("800-1000")).toBeLessThan(parseSlotStartMinutes("1000-1200"));
  });
  test("full chronological run: 800-1000, 1000-1200, 1200-1400, 1400-1600, 1600-1800", () => {
    const values = ["800-1000", "1000-1200", "1200-1400", "1400-1600", "1600-1800"].map(parseSlotStartMinutes);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
  test("0800-1000 (leading zero) parses the same as 800-1000", () => {
    expect(parseSlotStartMinutes("0800-1000")).toBe(parseSlotStartMinutes("800-1000"));
  });
  test("8:00-10:00 (colon) parses the same as 800-1000", () => {
    expect(parseSlotStartMinutes("8:00-10:00")).toBe(parseSlotStartMinutes("800-1000"));
  });
  test("800 - 1000 (spaced dash) parses the same as 800-1000", () => {
    expect(parseSlotStartMinutes("800 - 1000")).toBe(parseSlotStartMinutes("800-1000"));
  });
  test("H.MM decimal ranges parse chronologically: 12.00 (noon), 1.30, 2.00, 4.00", () => {
    // 12.00 (noon) must come before 1.30 (which is 1:30pm under the
    // business-hours heuristic, i.e. after noon).
    const inOrder = ["12.00 - 2.00", "1.30 - 3.30", "2.00 - 4.00", "4.00 - 6.00"].map(parseSlotStartMinutes);
    expect(inOrder).toEqual([...inOrder].sort((a, b) => a - b));
    expect(new Set(inOrder).size).toBe(4); // all distinct, no accidental collisions
  });
  test("bare-hour business-day heuristic: 8-11 => AM, 12 => noon, 1-7 => PM", () => {
    expect(parseSlotStartMinutes("8-10")).toBe(8 * 60);
    expect(parseSlotStartMinutes("10-12")).toBe(10 * 60);
    expect(parseSlotStartMinutes("12-2")).toBe(12 * 60);
    expect(parseSlotStartMinutes("1-3")).toBe(13 * 60);
    expect(parseSlotStartMinutes("3-5")).toBe(15 * 60);
  });
  test("explicit am/pm suffix overrides the bare-hour heuristic", () => {
    expect(parseSlotStartMinutes("3pm - 5pm")).toBe(15 * 60);
    expect(parseSlotStartMinutes("8am - 10am")).toBe(8 * 60);
    expect(parseSlotStartMinutes("1-4pm")).toBe(13 * 60); // shared trailing suffix
  });
  test("genuinely unparseable free text sorts after every real time, never guessed", () => {
    for (const v of ["MORNING", "AFTERNOON", "等货到", "B4 12PM", "AFTER 130PM", "", null, undefined]) {
      expect(parseSlotStartMinutes(v)).toBe(Infinity);
    }
  });
});

describe("compareScheduleOrder — the ONE canonical comparator shared by the board and print", () => {
  test("chronological slot wins over sort_order when slots differ", () => {
    const early = { slot: "800-1000", sort_order: 99 };
    const late = { slot: "1600-1800", sort_order: 1 };
    expect(compareScheduleOrder(early, late)).toBeLessThan(0);
  });
  test("sort_order is the tiebreaker within an identical parsed time", () => {
    const a = { slot: "800-1000", sort_order: 2 };
    const b = { slot: "0800-1000", sort_order: 1 }; // same parsed time, different text
    expect(compareScheduleOrder(b, a)).toBeLessThan(0);
  });
  test("a missing/null sort_order does not move ahead of a real Sequence 1 (same slot)", () => {
    const withOrder = { slot: "800-1000", sort_order: 1 };
    const nullOrder = { slot: "800-1000", sort_order: null };
    expect(compareScheduleOrder(withOrder, nullOrder)).toBeLessThan(0);
  });

  test("reproduces the exact production case: WVX7723/Sham, 2026-09-18", () => {
    // Real slot/sort_order values queried directly from production for this
    // team/date. Before this fix, both the board and print rendered
    // SV-345, SV-330, SV-362, SV-354, SV-366 (SV-366's 8am stop LAST).
    const rows = [
      { id: "so", slot: "1200-1400", sort_order: 6, name: "SV-330" },
      { id: "sk", slot: "1400 - 1600", sort_order: 1, name: "SV-362" },
      { id: "sl", slot: "1000-1200", sort_order: 2, name: "SV-345" },
      { id: "sm", slot: "1600-1800", sort_order: 4, name: "SV-354" },
      { id: "sn", slot: "800-1000", sort_order: 3, name: "SV-366" },
    ];
    const sorted = [...rows].sort(compareScheduleOrder); // exactly loadData()'s own usage
    expect(sorted.map(r => r.name)).toEqual(["SV-366", "SV-345", "SV-330", "SV-362", "SV-354"]);
    // print's usage of the identical comparator must agree, not just "also work"
    expect(sortSchedulesForPrint(rows).map(r => r.name)).toEqual(sorted.map(r => r.name));
  });
});

describe("TeamPrintView — canonical order in the rendered DOM (mirrors compareScheduleOrder exactly)", () => {
  test("chronological slots print in time order regardless of sort_order/array position", () => {
    const schedules = [
      schedWithSlot("s330", "1200-1400", "SO-330"),
      schedWithSlot("s362", "1400 - 1600", "SO-362"),
      schedWithSlot("s345", "1000-1200", "SO-345"),
      schedWithSlot("s354", "1600-1800", "SO-354"),
      schedWithSlot("s366", "800-1000", "SO-366"),
    ];
    expect(renderedSoOrder(schedules)).toEqual(["SO-366", "SO-345", "SO-330", "SO-362", "SO-354"]);
  });

  test("no-slot fixtures still order correctly by sort_order (unaffected by the slot-parsing change)", () => {
    const schedules = [sched("s3", 3, "SO-3"), sched("s1", 1, "SO-1"), sched("s4", 4, "SO-4"), sched("s2", 2, "SO-2")];
    expect(renderedSoOrder(schedules)).toEqual(["SO-1", "SO-2", "SO-3", "SO-4"]);
  });

  test("a missing/null sequence does not move ahead of valid Sequence 1 in the printed DOM", () => {
    const schedules = [sched("sNull", null, "SO-N"), sched("s2", 2, "SO-2"), sched("s1", 1, "SO-1")];
    const order = renderedSoOrder(schedules);
    expect(order[0]).toBe("SO-1");
    expect(order[order.length - 1]).toBe("SO-N");
  });

  test("existing superseded-DO print exclusion still works alongside the new sort", () => {
    const schedules = [
      schedWithSlot("s3", "1200-1400", "SO-3"),
      schedWithSlot("s1", "800-1000", "SO-1", { delivery_orders: { do_number: "DO1", superseded_at: "2026-09-11T07:50:09Z", status: "scheduled" } }),
      schedWithSlot("s2", "1000-1200", "SO-2"),
    ];
    // SO-1 has the EARLIEST slot (would print first) but points at a
    // superseded DO — must still be excluded entirely.
    expect(renderedSoOrder(schedules)).toEqual(["SO-2", "SO-3"]);
  });
});
