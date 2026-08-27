// Guards the behaviour that made printing unusable inside the iPad home-screen
// app: printing must never open a second window, because standalone mode gives
// the user no chrome to get back from one.
import { printHtml } from "./printDocument";

const FRAME_ID = "pulseos-print-frame";
const DOC = `<!DOCTYPE html><html><head><title>T</title></head><body><div class="page"><div class="doc">hi</div></div></body></html>`;

const frame = () => document.getElementById(FRAME_ID);

// The frame is created synchronously, but printing happens after images settle
// (a microtask when there are none). Stub print on the way through.
function printCalls() {
  const f = frame();
  const calls = [];
  f.contentWindow.print = () => calls.push("print");
  f.contentWindow.focus = () => {};
  return calls;
}

afterEach(() => {
  const f = frame();
  if (f) f.remove();
  jest.useRealTimers();
});

test("never opens a window — the whole point of the fix", async () => {
  const openSpy = jest.spyOn(window, "open").mockImplementation(() => null);
  printHtml(DOC);
  printCalls();
  await Promise.resolve();
  expect(openSpy).not.toHaveBeenCalled();
  openSpy.mockRestore();
});

test("renders the document into an off-screen iframe in this document", async () => {
  printHtml(DOC);
  const f = frame();
  expect(f).toBeTruthy();
  expect(f.parentNode).toBe(document.body);
  // Off-screen, not display:none / 0x0 — the sales order measures rendered
  // heights to auto-fit A4 and an unrendered frame reports every box as zero.
  expect(f.style.left).toBe("-10000px");
  expect(f.style.display).not.toBe("none");
  expect(parseInt(f.style.width, 10)).toBeGreaterThanOrEqual(725);
  expect(f.contentDocument.title).toBe("T");
  printCalls();
  await Promise.resolve();
});

test("calls print on the iframe, not on the app window", async () => {
  const appPrint = jest.fn();
  window.print = appPrint;
  printHtml(DOC);
  const calls = printCalls();
  await Promise.resolve();
  expect(calls).toEqual(["print"]);
  expect(appPrint).not.toHaveBeenCalled();
});

test("runs onBeforePrint against the iframe window before printing", async () => {
  const order = [];
  printHtml(DOC, {
    onBeforePrint: (win) => {
      order.push("before");
      // The sales-order auto-fit reaches into the printed document this way.
      expect(win.document.querySelectorAll(".page").length).toBe(1);
    },
  });
  const f = frame();
  f.contentWindow.focus = () => {};
  f.contentWindow.print = () => order.push("print");
  await Promise.resolve();
  expect(order).toEqual(["before", "print"]);
});

test("a throwing onBeforePrint still prints, just unscaled", async () => {
  printHtml(DOC, { onBeforePrint: () => { throw new Error("measure failed"); } });
  const calls = printCalls();
  await Promise.resolve();
  expect(calls).toEqual(["print"]);
});

test("keeps the frame alive until afterprint, then removes it", async () => {
  printHtml(DOC);
  const f = frame();
  printCalls();
  await Promise.resolve();
  // Still present: iOS returns from print() while its share sheet is open, so
  // an immediate teardown would cancel the job.
  expect(frame()).toBe(f);
  f.contentWindow.dispatchEvent(new Event("afterprint"));
  expect(frame()).toBeNull();
});

test("removes the frame on a backstop timer when afterprint never fires", async () => {
  // Cancelling the iOS print sheet fires no afterprint at all.
  jest.useFakeTimers();
  printHtml(DOC);
  printCalls();
  await Promise.resolve();
  expect(frame()).toBeTruthy();
  jest.advanceTimersByTime(60000);
  expect(frame()).toBeNull();
});

test("a second print replaces the first frame instead of stacking", async () => {
  printHtml(DOC);
  printCalls();
  await Promise.resolve();
  printHtml(DOC);
  printCalls();
  await Promise.resolve();
  expect(document.querySelectorAll(`#${FRAME_ID}`).length).toBe(1);
});
