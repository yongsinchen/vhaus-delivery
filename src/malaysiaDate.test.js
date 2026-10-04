// Phase 2D: operational "today" / "this month" / date presets are the MALAYSIA business calendar in every browser timezone.
// The critical window is 00:00–07:59 Malaysia time, when the UTC date (and the old `toISOString().slice(0, 10)`) is still YESTERDAY —
// a driver opening the app at 07:30 was shown yesterday's route.
//
// Run the file under several host zones to prove timezone independence:
//   TZ=UTC | TZ=Asia/Kuala_Lumpur | TZ=America/Los_Angeles | TZ=Pacific/Kiritimati   CI=true npx react-scripts test --watchAll=false src/malaysiaDate.test.js
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "./UIComponents";
import { malaysiaToday, malaysiaMonth, malaysiaMonthStart, addDaysISO, malaysiaDaysAgo, formatCalendarDate } from "./malaysiaDate";
import DriverPage from "./DriverPage";
import { ArrivalDateInput } from "./OrdersPage";

jest.mock("./AuthContext", () => ({
  useAuth: () => ({ user: { id: "d1", role: "driver" } }),
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

// 2026-10-05 07:30 in Malaysia == 2026-10-04 23:30 UTC (the UTC calendar date is still the 4th)
const AT_0730_MYT = new Date("2026-10-04T23:30:00Z");
const AT_0000_MYT = new Date("2026-10-04T16:00:00Z");   // exactly Malaysian midnight
const AT_2359_MYT = new Date("2026-10-05T15:59:59Z");   // last second of the 5th in Malaysia
const AT_0800_MYT = new Date("2026-10-05T00:00:00Z");

function freezeClock(instant) {
  const RealDate = Date;
  global.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(instant.getTime()); }
    static now() { return instant.getTime(); }
  };
  return () => { global.Date = RealDate; };
}

describe("malaysiaDate helpers", () => {
  test("host timezone (informational)", () => { console.info("host TZ offset (min, July):", new RealDateOffset().toString()); });
  test.each([
    [AT_0000_MYT, "2026-10-05"], [AT_0730_MYT, "2026-10-05"], [AT_0800_MYT, "2026-10-05"], [AT_2359_MYT, "2026-10-05"],
    [new Date("2026-10-04T15:59:59Z"), "2026-10-04"],
  ])("malaysiaToday(%s) = %s", (instant, expected) => { expect(malaysiaToday(instant)).toBe(expected); });
  test("this month / month start follow the Malaysia calendar at a month boundary", () => {
    const lastSecondOfSept = new Date("2026-09-30T15:59:59Z");   // 23:59:59 MYT on 30 Sep
    const firstSecondOfOct = new Date("2026-09-30T16:00:00Z");   // 00:00:00 MYT on 1 Oct — still 30 Sep in UTC
    expect(malaysiaMonth(lastSecondOfSept)).toBe("2026-09");
    expect(malaysiaMonth(firstSecondOfOct)).toBe("2026-10");
    expect(malaysiaMonthStart(firstSecondOfOct)).toBe("2026-10-01");
  });
  test("yesterday / tomorrow / N days ago are calendar arithmetic", () => {
    expect(addDaysISO(malaysiaToday(AT_0730_MYT), -1)).toBe("2026-10-04");
    expect(addDaysISO(malaysiaToday(AT_0730_MYT), 1)).toBe("2026-10-06");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2028-02-28", 1)).toBe("2028-02-29");
    expect(malaysiaDaysAgo(7, AT_0730_MYT)).toBe("2026-09-28");
  });
  test("a calendar date renders as the same day in any browser zone", () => {
    expect(formatCalendarDate("2026-10-05", { day: "numeric", month: "short", year: "numeric" })).toMatch(/5/);
    expect(formatCalendarDate("2026-10-05", { weekday: "long" })).toMatch(/Mon/);   // 5 Oct 2026 is a Monday
  });
});

function RealDateOffset() { this.toString = () => String(new Date(2026, 6, 15).getTimezoneOffset()); }

describe("DriverPage default date", () => {
  let restore, originalFetch, urls;
  beforeEach(() => {
    restore = freezeClock(AT_0730_MYT); originalFetch = global.fetch; urls = [];
    global.fetch = jest.fn(async (url) => { urls.push(String(url)); return { ok: true, json: async () => ({ teams: [] }) }; });
  });
  afterEach(() => { restore(); global.fetch = originalFetch; });
  test("at 07:30 Malaysia time the route is requested for TODAY (the 5th), not the UTC date (the 4th)", async () => {
    render(<ToastProvider><DriverPage /></ToastProvider>);
    await waitFor(() => expect(urls.some(u => u.includes("/driver/my-route"))).toBe(true));
    expect(urls.find(u => u.includes("/driver/my-route"))).toMatch(/date=2026-10-05$/);
  });
});

describe("Arrival date presets (Orders page)", () => {
  let restore;
  beforeEach(() => { restore = freezeClock(AT_0730_MYT); });
  afterEach(() => restore());
  test("Today / -1d / -1wk are Malaysia-calendar days in every browser timezone", () => {
    const onChange = jest.fn();
    render(<ArrivalDateInput value="" onChange={onChange} />);
    fireEvent.click(screen.getByText("Today"));  expect(onChange).toHaveBeenLastCalledWith("2026-10-05");
    fireEvent.click(screen.getByText("-1d"));    expect(onChange).toHaveBeenLastCalledWith("2026-10-04");
    fireEvent.click(screen.getByText("-1wk"));   expect(onChange).toHaveBeenLastCalledWith("2026-09-28");
  });
});

describe("no operational UTC-date pattern is left in the standardized files", () => {
  const fs = require("fs"), path = require("path");
  const FILES = ["DriverPage.js", "DeliveryDateRequestsPage.js", "ServiceCaseFormModal.js", "WarehousePage.js", "PerformancePage.js", "FinancePage.js"];
  test.each(FILES)("%s does not derive 'today' from toISOString()", (f) => {
    const src = fs.readFileSync(path.join(__dirname, f), "utf8");
    expect(src).not.toMatch(/new Date\(\)\.toISOString\(\)\.(slice\(0, ?10\)|split\("T"\)\[0\])/);
  });
  test("App.js operational defaults (today, month, next 3 days, order window) use the Malaysia helpers", () => {
    const src = fs.readFileSync(path.join(__dirname, "App.js"), "utf8");
    expect(src).toMatch(/const todayStr = malaysiaToday\(\)/);
    expect(src).not.toMatch(/const todayStr = now\.toISOString/);
    expect(src).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0, 7\)/);
    expect(src).toMatch(/const cutoff = malaysiaDaysAgo\(ORDER_WINDOW_DAYS\)/);
  });
  test("DeliverySchedule default board date uses the existing Malaysia helper", () => {
    const src = fs.readFileSync(path.join(__dirname, "DeliverySchedule.js"), "utf8");
    expect(src).toMatch(/useState\(initialDate \|\| getMalaysiaDate\(\)\)/);
  });
});
