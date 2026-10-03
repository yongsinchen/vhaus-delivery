// Delivery Schedule "Copy" — customer details for an assigned Customer Stop.
import { buildStopCopyText, copyTextToClipboard, copyStopDetails } from "./stopCopy";

const so = (no, extra = {}) => ({ so_number: no, customer_name: "TAN AH KOW", contact: "0123456789", address: "123, JALAN ABC, 14000 BUKIT MERTAJAM", balance: 1250, ...extra });

describe("buildStopCopyText", () => {
  test("E. single stop → NAME / CONTACT / ADDRESS / BALANCE exactly as specified", () => {
    expect(buildStopCopyText([so("SO1")])).toBe(
      "NAME: TAN AH KOW\nCONTACT: 0123456789\nADDRESS: 123, JALAN ABC, 14000 BUKIT MERTAJAM\nBALANCE: RM 1,250.00");
  });
  test("a multi-line address is kept on one line; zero / null balance are explicit, never blank", () => {
    expect(buildStopCopyText([so("SO1", { address: "123 Jalan ABC,\r\nBukit Mertajam", balance: 0 })])).toMatch(/ADDRESS: 123 Jalan ABC, Bukit Mertajam\nBALANCE: RM 0.00$/);
    expect(buildStopCopyText([so("SO1", { balance: null })])).toMatch(/BALANCE: -$/);
  });
  test("balance uses the canonical value as-is (float noise rounded to cents, never recomputed)", () => {
    expect(buildStopCopyText([so("SO1", { balance: 3647.6000000000004 })])).toMatch(/BALANCE: RM 3,647.60$/);
  });
  test("missing contact/address shows '-' not 'undefined'", () => {
    const t = buildStopCopyText([so("SO1", { contact: undefined, address: null })]);
    expect(t).toMatch(/CONTACT: -\nADDRESS: -/); expect(t).not.toMatch(/undefined|null/);
  });
  test("F. Deliver Together: customer details once, TOTAL balance + per-SO breakdown (never one SO's balance alone)", () => {
    const t = buildStopCopyText([so("SO1", { balance: 1000 }), so("SO2", { balance: 250.5 })]);
    expect(t).toBe("NAME: TAN AH KOW\nCONTACT: 0123456789\nADDRESS: 123, JALAN ABC, 14000 BUKIT MERTAJAM\nBALANCE (TOTAL): RM 1,250.50\n  SO1: RM 1,000.00\n  SO2: RM 250.50");
    expect(t.match(/NAME:/g)).toHaveLength(1);
  });
  test("F. a member with an unknown balance flags the total as INCOMPLETE", () => {
    const t = buildStopCopyText([so("SO1", { balance: 100 }), so("SO2", { balance: null })]);
    expect(t).toMatch(/BALANCE \(TOTAL, INCOMPLETE\): RM 100.00/);
    expect(t).toMatch(/SO2: -/);
  });
  test("F. members that disagree on name/contact/address are each listed with their SO — never silently one", () => {
    const t = buildStopCopyText([so("SO1"), so("SO2", { customer_name: "MRS TAN", contact: "0199999999", address: "No 9 Lorong X" })]);
    expect(t).toMatch(/NAME \(SO1\): TAN AH KOW\nNAME \(SO2\): MRS TAN/);
    expect(t).toMatch(/CONTACT \(SO1\): 0123456789\nCONTACT \(SO2\): 0199999999/);
    expect(t).toMatch(/ADDRESS \(SO1\):.*\nADDRESS \(SO2\): No 9 Lorong X/);
  });
  test("Chinese text is preserved verbatim; Internal Remark is never part of the copy", () => {
    const t = buildStopCopyText([so("SO1", { customer_name: "陈阿狗", address: "槟城 峇都交湾", internal_remark: "SECRET MARGIN" })]);
    expect(t).toMatch(/NAME: 陈阿狗/); expect(t).toMatch(/ADDRESS: 槟城 峇都交湾/); expect(t).not.toMatch(/SECRET/);
  });
  test("empty input → empty string", () => { expect(buildStopCopyText([])).toBe(""); expect(buildStopCopyText(null)).toBe(""); });
});

describe("copyTextToClipboard", () => {
  const origClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    if (origClipboard) Object.defineProperty(navigator, "clipboard", origClipboard); else delete navigator.clipboard;
    delete document.execCommand;
  });
  test("uses navigator.clipboard when available", async () => {
    const writeText = jest.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    expect(await copyTextToClipboard("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });
  test("G. clipboard API unavailable → execCommand fallback copies the text", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    let selected = null;
    document.execCommand = jest.fn(() => { selected = document.activeElement?.value; return true; });
    expect(await copyTextToClipboard("fallback text")).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(selected).toBe("fallback text");
    expect(document.querySelector("textarea")).toBeNull(); // helper element cleaned up
  });
  test("G. clipboard API rejects (permission denied) → falls back, still no throw", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: jest.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    document.execCommand = jest.fn(() => true);
    expect(await copyTextToClipboard("x")).toBe(true);
  });
  test("G. nothing works → resolves false (never throws)", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    document.execCommand = jest.fn(() => false);
    await expect(copyTextToClipboard("x")).resolves.toBe(false);
  });
  test("copyStopDetails: lightweight toast feedback, no alert()", async () => {
    const writeText = jest.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const toast = { success: jest.fn(), error: jest.fn() };
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    expect(await copyStopDetails([so("SO1")], toast)).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Copied");
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
