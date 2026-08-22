// Official Receipt — printed after a deposit/balance collection and reprintable
// from the Customer and Finance pages. Mirrors the company's pre-printed
// receipt book and uses the uploaded company logo. Kept in one place so both
// pages render an identical document.

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
  // One receipt copy. Both copies on the page are identical except the corner
  // tag (Customer Copy / Office Copy), so they can be torn apart after printing.
  const copy = (tag) => `
  <div class="copy">
    ${voided ? `<div class="void">VOID</div>` : ""}
    <div class="head">
      ${company.logo ? `<img src="${esc(company.logo)}" class="logo" alt="logo">` : ""}
      <div class="hmeta">
        <div class="cn">${esc(company.name || "")}</div>
        <div class="cmeta">${company.reg ? esc(company.reg) + "<br>" : ""}${company.address ? esc(company.address) + "<br>" : ""}${contactLine}</div>
      </div>
      <div class="copytag">${tag}</div>
    </div>
    <div class="title">OFFICIAL RECEIPT</div>
    <div class="no">No: ${esc(receiptNo || "")}${kindLabel ? ` · ${esc(kindLabel)}` : ""}</div>
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
    <div class="foot">
      <div>for ${esc(company.name || "")}</div>
      <div class="sig"><div class="line">Company Chop &amp; Signature</div></div>
    </div>
  </div>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Official Receipt ${esc(receiptNo || "")}</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; margin: 0; }
  /* Two copies stacked on one A4 sheet, split by a dashed cut line. */
  .copy { position: relative; padding: 4px 6px 6px; height: 140mm; overflow: hidden; }
  .copy:first-child { border-bottom: 1.5px dashed #9ca3af; }
  .void { position: absolute; top: 38%; left: 0; right: 0; text-align: center; font-size: 74px; font-weight: 900; color: rgba(220,38,38,.16); transform: rotate(-22deg); letter-spacing: 8px; pointer-events: none; z-index: 9; }
  .head { display: flex; align-items: flex-start; gap: 12px; border-bottom: 2px solid #111; padding-bottom: 6px; }
  .hmeta { flex: 1; }
  .logo { height: 42px; max-width: 180px; object-fit: contain; }
  .cn { font-size: 15px; font-weight: 800; letter-spacing: .3px; }
  .cmeta { font-size: 10px; color: #374151; line-height: 1.4; margin-top: 2px; }
  .copytag { align-self: flex-start; border: 1px solid #6b7280; border-radius: 4px; padding: 2px 8px; font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #374151; white-space: nowrap; }
  .title { text-align: center; font-size: 17px; font-weight: 800; letter-spacing: 3px; margin: 8px 0 2px; }
  .no { text-align: center; color: #dc2626; font-weight: 700; font-size: 13px; margin-bottom: 8px; }
  .fields { font-size: 12px; line-height: 1.7; margin-bottom: 6px; }
  .fields b { display: inline-block; min-width: 120px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { border: 0.8px solid #6b7280; padding: 4px 6px; font-size: 11px; }
  th { background: #f3f4f6; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }
  td.r, th.r { text-align: right; }
  .totals { margin-top: 8px; width: 60%; margin-left: auto; }
  .totals .row { display: flex; justify-content: space-between; border-bottom: 0.8px solid #9ca3af; padding: 4px 2px; }
  .totals .row b { font-weight: 700; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 20px; font-size: 11px; }
  .sig { text-align: center; }
  .sig .line { border-top: 0.8px solid #111; width: 190px; padding-top: 3px; margin-top: 22px; }
</style></head><body>
  ${copy("Customer Copy")}
  ${copy("Office Copy")}
</body></html>`;
  const w = window.open("", "_blank"); if (!w) return;
  w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 600);
}
