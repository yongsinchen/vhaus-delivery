// Same-customer stops on the schedule (2026-10-12): the manager "Link same-customer stops" action previews, then links.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "DeliverySchedule.js"), "utf8").replace(/\r\n/g, "\n");

test("manager-only button on the board", () => {
  expect(src).toMatch(/const canLinkSchedule = \["master", "manager"\]\.includes/);
  expect(src).toMatch(/!readOnly && canLinkSchedule && <button onClick=\{linkSameCustomer\} data-testid="link-same-customer"/);
});
test("always a dry run first; links only after confirmation; reloads the board", () => {
  const dry = src.indexOf("const preview = await run(true);");
  const confirm = src.indexOf("window.confirm(`Link these as one customer stop each");
  const apply = src.indexOf("const done = await run(false);");
  expect(dry).toBeGreaterThan(-1);
  expect(confirm).toBeGreaterThan(dry);
  expect(apply).toBeGreaterThan(confirm);
  expect(src).toMatch(/\/delivery-links\/auto-link-sweep/);
});
