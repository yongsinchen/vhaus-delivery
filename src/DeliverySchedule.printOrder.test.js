// URGENT fix — Delivery Schedule print order. TeamPrintView used to build its
// printed rows straight from team.schedules in whatever array order it
// received, trusting the caller to have already sorted it ascending by the
// canonical sequence field (sort_order) — it never sorted on its own. This
// tests both the extracted comparator/sort helper directly, and the actual
// printed DOM order via TeamPrintView, so a regression here is caught at
// both levels.
import { render, screen } from "@testing-library/react";
import { TeamPrintView, compareSequenceForPrint, sortSchedulesForPrint } from "./DeliverySchedule";

function sched(id, sort_order, soNumber, extra = {}) {
  return {
    id, sort_order, slot: null,
    orders: { id: 1000 + (sort_order ?? 0), so_number: soNumber, customer_name: "Cust-" + soNumber, items: "[]", balance: 0 },
    ...extra,
  };
}

function renderedSoOrder(schedules, teamOverrides = {}) {
  const team = { vehicle_plate: "ABC123", team_date: "2026-09-16", schedules, ...teamOverrides };
  const { unmount } = render(<TeamPrintView team={team} onClose={() => {}} company={{}} />);
  const order = screen.getAllByText(/^SO-[\w-]+$/).map(el => el.textContent);
  unmount();
  return order;
}

describe("sortSchedulesForPrint / compareSequenceForPrint (pure)", () => {
  test("deliberately unsorted input (3,1,4,2) sorts to ascending 1,2,3,4", () => {
    const input = [sched("s3", 3, "SO-3"), sched("s1", 1, "SO-1"), sched("s4", 4, "SO-4"), sched("s2", 2, "SO-2")];
    const sorted = sortSchedulesForPrint(input);
    expect(sorted.map(s => s.sort_order)).toEqual([1, 2, 3, 4]);
  });

  test("does not mutate the input array (screen/other consumers unaffected)", () => {
    const input = [sched("s3", 3, "SO-3"), sched("s1", 1, "SO-1")];
    const before = input.map(s => s.id);
    sortSchedulesForPrint(input);
    expect(input.map(s => s.id)).toEqual(before);
  });

  test("a missing/null sort_order does NOT move ahead of valid Sequence 1", () => {
    const input = [sched("sNull", null, "SO-N"), sched("s1", 1, "SO-1"), sched("s2", 2, "SO-2")];
    const sorted = sortSchedulesForPrint(input);
    expect(sorted[0].id).toBe("s1"); // Sequence 1 stays first
    expect(sorted[sorted.length - 1].id).toBe("sNull"); // null goes last, never ahead
  });

  test("undefined sort_order is treated the same as null (goes last)", () => {
    const input = [sched("sUndef", undefined, "SO-U"), sched("s1", 1, "SO-1")];
    const sorted = sortSchedulesForPrint(input);
    expect(sorted[0].id).toBe("s1");
    expect(sorted[1].id).toBe("sUndef");
  });

  test("compareSequenceForPrint is a stable ascending comparator usable directly", () => {
    expect(compareSequenceForPrint({ sort_order: 1 }, { sort_order: 2 })).toBeLessThan(0);
    expect(compareSequenceForPrint({ sort_order: 5 }, { sort_order: 5 })).toBe(0);
    expect(compareSequenceForPrint({ sort_order: 9 }, { sort_order: 1 })).toBeGreaterThan(0);
  });
});

describe("TeamPrintView — canonical print order (rendered DOM)", () => {
  test("deliberately unsorted input (3,1,4,2) prints as 1,2,3,4 top to bottom", () => {
    const schedules = [sched("s3", 3, "SO-3"), sched("s1", 1, "SO-1"), sched("s4", 4, "SO-4"), sched("s2", 2, "SO-2")];
    expect(renderedSoOrder(schedules)).toEqual(["SO-1", "SO-2", "SO-3", "SO-4"]);
  });

  test("Sequence 1 is the first rendered row/group", () => {
    const schedules = [sched("s2", 2, "SO-2"), sched("s1", 1, "SO-1")];
    expect(renderedSoOrder(schedules)[0]).toBe("SO-1");
  });

  test("the highest sequence is rendered last", () => {
    const schedules = [sched("s2", 2, "SO-2"), sched("s1", 1, "SO-1"), sched("s3", 3, "SO-3")];
    const order = renderedSoOrder(schedules);
    expect(order[order.length - 1]).toBe("SO-3");
  });

  test("a larger (multi-page-sized) unsorted set still prints in full ascending order (1..8)", () => {
    const shuffled = [5, 2, 8, 1, 6, 3, 7, 4];
    const schedules = shuffled.map(n => sched("s" + n, n, "SO-" + n));
    expect(renderedSoOrder(schedules)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(n => "SO-" + n));
  });

  test("a missing/null sequence does not move ahead of valid Sequence 1 in the printed DOM", () => {
    const schedules = [sched("sNull", null, "SO-N"), sched("s2", 2, "SO-2"), sched("s1", 1, "SO-1")];
    const order = renderedSoOrder(schedules);
    expect(order[0]).toBe("SO-1");
    expect(order[order.length - 1]).toBe("SO-N");
  });

  test("existing superseded-DO print exclusion still works alongside the new sort", () => {
    const schedules = [
      sched("s3", 3, "SO-3"),
      sched("s1", 1, "SO-1", { delivery_orders: { do_number: "DO1", superseded_at: "2026-09-11T07:50:09Z", status: "scheduled" } }),
      sched("s2", 2, "SO-2"),
    ];
    // SO-1's schedule points at a superseded DO — must be excluded entirely,
    // regardless of it having the lowest sort_order (would otherwise print first).
    expect(renderedSoOrder(schedules)).toEqual(["SO-2", "SO-3"]);
  });
});
