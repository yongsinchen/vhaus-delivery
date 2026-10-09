// Stale SO edit form guard: a payment recorded by someone else while the edit
// form is open must never rewrite the original deposit on save. Since
// 2026-10-09 this holds structurally — Edit Order sends NO money fields at all
// (the deposit has its own audited editor with its own stale-form check, and
// new money is Collect Payment), and the backend refuses an old client that
// still sends a changed deposit (409 deposit_edit_separately).
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "OrdersPage.js"), "utf8").replace(/\r\n/g, "\n");

describe("Sales Order edit — money is never part of an order edit", () => {
  test("edits strip deposit, payment method and proofs from the request", () => {
    expect(src).toMatch(/if \(editId\) \{ delete body\.deposit; delete body\.payment_method; delete body\.payment_proofs; \}/);
  });

  test("…before the PUT request is sent", () => {
    const strip = src.indexOf("if (editId) { delete body.deposit;");
    const send = src.indexOf("const res = await fetch(url, { method, headers, body: JSON.stringify(body) });");
    expect(strip).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(strip);
  });

  test("editingOrder is the order loaded when the drawer opened", () => {
    expect(src).toMatch(/setEditingOrder\(fullOrder\);/);
  });
});
