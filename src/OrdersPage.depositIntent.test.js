// Stale SO edit form guard: editing a Sales Order must send the Deposit value
// the form LOADED (deposit_loaded) so the backend can tell an untouched
// Deposit field from a real change. Without it, a payment recorded by someone
// else while the form was open would rewrite initial_deposit on save.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "OrdersPage.js"), "utf8").replace(/\r\n/g, "\n");

describe("Sales Order edit — Deposit intent token", () => {
  test("edits send deposit_loaded from the order the form loaded", () => {
    expect(src).toMatch(/if \(editId\) body\.deposit_loaded = editingOrder\?\.deposit != null \? Number\(editingOrder\.deposit\) : null;/);
  });

  test("the token is set before the PUT request is sent", () => {
    const token = src.indexOf("body.deposit_loaded =");
    const send = src.indexOf("const res = await fetch(url, { method, headers, body: JSON.stringify(body) });");
    expect(token).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(token);
  });

  test("editingOrder is the order loaded when the drawer opened", () => {
    expect(src).toMatch(/setEditingOrder\(fullOrder\);/);
  });
});
