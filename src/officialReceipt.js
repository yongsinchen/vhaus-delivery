// Payment Acknowledgement — printed after a deposit/balance collection and
// reprintable from the Customer and Finance pages. Mirrors the company's
// receipt book and uses the uploaded company logo. Kept in one place so both
// pages render an identical document.
//
// Print architecture: each copy is its OWN atomic print page (page-break-after
// on the container), so Customer Copy = physical/PDF page 1 and Merchant Copy =
// page 2 — never split or shifted across pages, and never dependent on browser
// content flow to decide the boundary. Internal sections use break-inside:avoid
// so a table/notice/signature can't overflow onto the next page.
import { printHtml } from "./printDocument";

const money = v => `RM ${(Number(v) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

export function printOfficialReceipt({ company = {}, receiptNo, customer = {}, date, rows = [], totalReceived, creditBalance, kindLabel, voided = false }) {
  const MIN_ROWS = 4;
  const bodyRows = rows.map(r => `<tr>
      <td>${esc(r.so_number || "")}</td>
      <td>${esc(r.date || "")}</td>
      <td>${esc(r.payment_method || "")}</td>
      <td class="r">${r.amount != null ? money(r.amount) : ""}</td>
      <td class="r">${r.paid != null ? money(r.paid) : ""}</td>
      <td class="r">${r.balance != null ? money(r.balance) : ""}</td>
    </tr>`);
  for (let i = rows.length; i < MIN_ROWS; i++) bodyRows.push(`<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>`);
  const contactLine = [company.hotline && `HOTLINE: ${company.hotline}`, company.email && `EMAIL: ${company.email}`, company.website && `WEBSITE: ${company.website}`].filter(Boolean).join(" · ");

  // One full-page copy. Both pages carry identical financial information; only
  // the copy badge (CUSTOMER COPY / MERCHANT COPY) differs. Each is its own
  // print page — see the print architecture note at the top of the file.
  const copy = (tag) => `
  <section class="page">
    ${voided ? `<div class="void">VOID</div>` : ""}
    <div class="head">
      ${company.logo ? `<img src="${esc(company.logo)}" class="logo" alt="logo">` : ""}
      <div class="hmeta">
        <div class="cn">${esc(company.name || "")}</div>
        <div class="cmeta">${company.reg ? esc(company.reg) + "<br>" : ""}${company.address ? esc(company.address) + "<br>" : ""}${contactLine}</div>
      </div>
      <div class="copytag">${esc(tag)}</div>
    </div>
    <div class="title">PAYMENT ACKNOWLEDGEMENT</div>
    <div class="no">Acknowledgement No: ${esc(receiptNo || "")}${kindLabel ? ` · ${esc(kindLabel)}` : ""}</div>
    <div class="fields">
      <div><b>RECEIVED FROM:</b> ${esc(customer.name || "")}</div>
      <div><b>PHONE NO:</b> ${esc(customer.phone || "")}</div>
      <div><b>DATE:</b> ${esc(date || "")}</div>
    </div>
    <table>
      <thead><tr><th>Sales Order No.</th><th>Date</th><th>Payment Method</th><th class="r">Amount (RM)</th><th class="r">Paid (RM)</th><th class="r">Balance (RM)</th></tr></thead>
      <tbody>${bodyRows.join("")}</tbody>
    </table>
    <div class="totals">
      <div class="row"><b>Total Amount Received (RM)</b><b>${money(totalReceived)}</b></div>
      <div class="row"><span>Credit Balance (RM, if any)</span><span>${creditBalance ? money(creditBalance) : "-"}</span></div>
    </div>
    <div class="notice">
      <b>Payment Verification Notice:</b>
      All payments are subject to verification. If we are unable to verify your payment,
      we will contact you within 14 days from the payment date.
    </div>
    <div class="foot">
      <div>for ${esc(company.name || "")}</div>
      <div class="sig"><div class="line">Company Chop &amp; Signature</div></div>
    </div>
  </section>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment Acknowledgement ${esc(receiptNo || "")}</title>
<style>
  /* Print-safe fixed A4 geometry — never viewport-dependent, never shrink-to-fit. */
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; }

  /* Each copy is ONE atomic page. The break-after guarantees Merchant Copy
     starts at the top of page 2; the last page must not emit a trailing blank
     page. min-height fills the sheet so the signature sits near the bottom. */
  .page {
    position: relative;
    min-height: 265mm;                 /* A4 (297) minus 2×12mm margins ≈ 273; leave slack */
    padding: 0;
    page-break-after: always;
    break-after: page;
    page-break-inside: avoid;          /* try to keep a whole copy on its page */
  }
  .page:last-child { page-break-after: auto; break-after: auto; }

  .void { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 96px; font-weight: 900; color: rgba(220,38,38,.16); transform: rotate(-22deg); letter-spacing: 10px; pointer-events: none; z-index: 9; }

  .head { display: flex; align-items: flex-start; gap: 12px; border-bottom: 2px solid #111; padding-bottom: 8px; break-inside: avoid; }
  .hmeta { flex: 1; min-width: 0; }
  .logo { height: 46px; max-width: 190px; object-fit: contain; }
  .cn { font-size: 16px; font-weight: 800; letter-spacing: .3px; overflow-wrap: anywhere; }
  .cmeta { font-size: 10px; color: #374151; line-height: 1.45; margin-top: 2px; overflow-wrap: anywhere; }

  /* Copy indicator — a clearly visible badge at the top-right of the header. */
  .copytag { align-self: flex-start; border: 2px solid #111; border-radius: 6px; padding: 4px 12px; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #111; white-space: nowrap; }

  .title { text-align: center; font-size: 20px; font-weight: 800; letter-spacing: 3px; margin: 14px 0 3px; }
  .no { text-align: center; color: #dc2626; font-weight: 700; font-size: 13px; margin-bottom: 10px; }

  .fields { font-size: 12px; line-height: 1.8; margin-bottom: 8px; break-inside: avoid; }
  .fields b { display: inline-block; min-width: 120px; font-weight: 700; }
  .fields > div { overflow-wrap: anywhere; }

  table { width: 100%; border-collapse: collapse; margin-top: 4px; break-inside: avoid; }
  th, td { border: 0.8px solid #6b7280; padding: 5px 6px; font-size: 11px; overflow-wrap: anywhere; }
  th { background: #f3f4f6; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
  td.r, th.r { text-align: right; white-space: nowrap; }

  .totals { margin-top: 10px; width: 60%; margin-left: auto; break-inside: avoid; }
  .totals .row { display: flex; justify-content: space-between; border-bottom: 0.8px solid #9ca3af; padding: 4px 2px; }
  .totals .row b { font-weight: 700; }

  /* Verification notice — visible but visually secondary; NOT part of the table. */
  .notice { margin-top: 14px; padding: 8px 10px; border-top: 1px dashed #9ca3af; font-size: 9.5px; line-height: 1.5; color: #6b7280; font-style: italic; break-inside: avoid; }
  .notice b { font-style: normal; font-weight: 700; color: #4b5563; }

  .foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 26px; font-size: 11px; break-inside: avoid; }
  .sig { text-align: center; }
  .sig .line { border-top: 0.8px solid #111; width: 200px; padding-top: 3px; margin-top: 24px; }
</style></head><body>
  ${copy("Customer Copy")}
  ${copy("Merchant Copy")}
</body></html>`;
  printHtml(html);
}
