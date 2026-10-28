// My Orders → Download PDF: a real text PDF of the sales order's Customer Copy,
// built from the same figures as Print (salesOrderDoc.js).
// jsdom lacks TextEncoder/TextDecoder, which jsPDF needs — set them before
// the modules load (require, not import, so the order is guaranteed).
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
const fs = require("fs");
const path = require("path");
const { jsPDF } = require("jspdf");
const { autoTable } = require("jspdf-autotable");
const { buildSalesOrderPdf, salesOrderPdfFileName } = require("./salesOrderPdf");
const { salesOrderFigures } = require("./salesOrderDoc");
const { SCHEDULE_FONT_FILES } = require("./pdfFonts");

const fontB64 = f => fs.readFileSync(path.join(__dirname, "..", "public", "fonts", f)).toString("base64");
const fonts = { regular: fontB64(SCHEDULE_FONT_FILES.regular), bold: fontB64(SCHEDULE_FONT_FILES.bold) };
const OUT = process.env.SO_PDF_OUT; // set to a directory to write the fixture PDFs for visual checks

const company = { name: "Example Living Sdn Bhd", reg: "202001000001 (1234567-X)", address: "No. 1, Jalan Contoh 1/1, 81300 Skudai, Johor", hotline: "07-123 4567", bank: "Maybank 5512 3456 7890", branches_display: "Skudai · Kulai · Penang" };
const item = (i, extra = {}) => ({ product_name: `Product ${i + 1}`, product_code: `P-${100 + i}`, size: "King", color: "Grey", quantity: 1 + (i % 2), unit_price: 1000 + i * 50, ...extra });
const base = {
  order_number: "03306", customer_name: "Inglan Tan", customer_contact: "012-345 6789", customer_address: "12 Jalan Bukit Indah 3/5, 81200 Johor Bahru",
  customer_id_type: "ic", customer_id_no: "900101-01-1234", customer_email: "inglan@example.com", salesman_name: "Austin",
  order_date: "2026-09-20", delivery_date: "2026-11-02", delivery_type: "Delivery", payment_method: "Bank Transfer",
  subtotal: 5400, discount: 0, deposit: 1425, gst_rate: 0, gst_amount: 0, remark: "Call before delivery. 客户要求下午送货",
  items: [item(0, { product_name: "Chesterfield 3-Seater Sofa 真皮", notes: "Leg colour: walnut" }), item(1)],
};
const build = (order, extra = {}) => buildSalesOrderPdf({ jsPDF, autoTable, order, company, branchName: "Skudai", fonts, ...extra });
const save = (doc, name) => { if (OUT) fs.writeFileSync(path.join(OUT, name), Buffer.from(doc.output("arraybuffer"))); };

describe("Sales Order PDF", () => {
  test("normal order fits one A4 portrait page", () => {
    const doc = build(base);
    save(doc, "so-normal.pdf");
    expect(doc.getNumberOfPages()).toBe(1);
    const { width, height } = doc.internal.pageSize;
    expect(Math.round(width)).toBe(210);
    expect(Math.round(height)).toBe(297);
  });

  test("totals match the print's figures (shared salesOrderFigures)", () => {
    const fig = salesOrderFigures(base, "Skudai");
    expect(fig.total).toBe(5400);
    expect(fig.balance).toBe(3975);
    expect(fig.checkedPay).toBe("Online Transfer");
    expect(fig.lines[0]).toMatchObject({ no: 1, qty: 1, unitPrice: "1,000.00", amount: "1,000.00" });
  });

  test("GST and discount: GST on the full subtotal, discount after tax", () => {
    const fig = salesOrderFigures({ ...base, subtotal: 1000, gst_rate: 9, gst_amount: null, discount: 100, deposit: 0 });
    expect(fig.gst).toBe(90);
    expect(fig.total).toBe(990);
    expect(save(build({ ...base, subtotal: 1000, gst_rate: 9, gst_amount: null, discount: 100, deposit: 0, country: "SG" }), "so-gst.pdf")).toBeUndefined();
  });

  test("a long order continues onto further pages and keeps the closing section whole", () => {
    const doc = build({ ...base, items: Array.from({ length: 40 }, (_, i) => item(i)), subtotal: null });
    save(doc, "so-long.pdf");
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  test("staff-only internal remark never reaches the PDF", () => {
    // PDF text is glyph-encoded, so guard the sources instead: neither the
    // renderer nor the shared figures ever read the staff-only field.
    for (const f of ["salesOrderPdf.js", "salesOrderDoc.js"]) {
      expect(fs.readFileSync(path.join(__dirname, f), "utf8")).not.toMatch(/internal_remark/);
    }
  });

  test("blank / legacy order (no items, no company logo, nulls) still builds", () => {
    const doc = build({ order_number: null, items: [], customer_name: null }, { company: {} });
    expect(doc.getNumberOfPages()).toBe(1);
  });

  test("file name is filesystem-safe", () => {
    expect(salesOrderPdfFileName({ order_number: "03306", customer_name: "Inglan Tan / Mr." })).toBe("Sales-Order-03306-Inglan-Tan-Mr.pdf");
    expect(salesOrderPdfFileName({})).toBe("Sales-Order-draft.pdf");
  });
});
