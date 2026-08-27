// ── Printing that survives being cancelled ───────────────────────────────────
// Every print in the app used to open a child window (window.open("", "_blank")),
// write a self-contained HTML document into it, and call print() on that window.
//
// On a desktop browser the leftover tab is harmless — the user closes it. Inside
// an iOS/iPadOS home-screen web app it is a dead end: standalone mode has no tab
// bar, no address bar and no back button, so cancelling the print sheet leaves
// the user staring at a blank child window with nothing to tap. Force-quitting
// and reopening the app is the only way out. (Reported on iPad, My Orders.)
//
// Printing an off-screen iframe inside the CURRENT document avoids the whole
// problem: no second window exists, so cancelling just returns to the app. It
// also removes the pop-up-blocker failure mode ("Allow pop-ups to print") that
// standalone web apps and mobile Safari trip over constantly.
//
// Every caller passes the same thing it used to write into the child window: a
// complete <html> document with its own <style>. Nothing about the print layouts
// changes — they still render in their own document, isolated from the app's CSS.

const FRAME_ID = "pulseos-print-frame";

// The iframe has to outlive print(). On iOS, print() returns as soon as the
// share sheet appears, so tearing the frame down straight away would cancel the
// job. afterprint is the good signal, but iOS does not fire it when the user
// cancels — hence the long backstop timer as well.
const CLEANUP_MS = 60000;

// Give embedded logos/signatures a moment, but never block printing on a slow
// or broken image.
const IMAGE_TIMEOUT_MS = 3000;

function removeFrame(frame) {
  if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
}

function waitForImages(doc) {
  const pending = Array.from(doc.images || []).filter(img => !img.complete);
  if (pending.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(pending.map(img => new Promise(resolve => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    }))),
    new Promise(resolve => setTimeout(resolve, IMAGE_TIMEOUT_MS)),
  ]);
}

/**
 * Print a complete HTML document without leaving the app.
 *
 * @param {string} html  A full <html>…</html> document, exactly as it used to be
 *                       written into the pop-up window.
 * @param {object} [opts]
 * @param {(win: Window) => void} [opts.onBeforePrint]
 *        Runs against the iframe's window once its content and images are laid
 *        out, immediately before print() — used by the sales order to measure
 *        rendered heights and scale each copy to fit its A4 sheet. Errors here
 *        are swallowed so a measurement failure still prints, just unscaled.
 */
export function printHtml(html, { onBeforePrint } = {}) {
  // One frame at a time: a rapid second print replaces the first rather than
  // stacking hidden frames that each hold a full document alive.
  removeFrame(document.getElementById(FRAME_ID));

  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.title = "Print";
  frame.setAttribute("aria-hidden", "true");
  // Positioned off-screen at a real size rather than display:none or 0×0. The
  // sales-order print measures rendered element heights to auto-fit A4, and an
  // unrendered frame reports every box as zero. 900px comfortably exceeds the
  // 725px A4 printable width the layouts are built around.
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:1200px;border:0;";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) { removeFrame(frame); return; }
  doc.open();
  doc.write(html);
  doc.close();

  waitForImages(doc).then(() => {
    const win = frame.contentWindow;
    if (!win) { removeFrame(frame); return; }

    try { if (onBeforePrint) onBeforePrint(win); } catch (e) { /* print unscaled */ }

    // Registered before print() — on desktop the call blocks until the dialog
    // closes, so a listener added afterwards would miss the event entirely.
    try { win.addEventListener("afterprint", () => removeFrame(frame), { once: true }); } catch (e) { /* backstop covers it */ }
    setTimeout(() => removeFrame(frame), CLEANUP_MS);

    try {
      win.focus();
      win.print();
    } catch (e) {
      removeFrame(frame);
    }
  });
}
