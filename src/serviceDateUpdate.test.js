import { serviceDateUpdateNotice } from "./serviceDateUpdate";

describe("serviceDateUpdateNotice — a gated Service date edit must be visible, never a silent no-op", () => {
  test("a pending request tells the user it awaits approval and that the old date stays", () => {
    const n = serviceDateUpdateNotice({ service: {}, pending_date_request: { status: "pending", requested_date: "2026-10-20" } });
    expect(n.type).toBe("info");
    expect(n.message).toMatch(/submitted for approval/);
    expect(n.message).toMatch(/2026-10-20/);
    expect(n.message).toMatch(/stays until it is approved/);
  });
  test("a request with no date still produces the notice", () => {
    expect(serviceDateUpdateNotice({ pending_date_request: { status: "pending" } }).message).toMatch(/submitted for approval/);
  });
  test("an already-approved (applied) request, no request, or no body → no notice", () => {
    expect(serviceDateUpdateNotice({ pending_date_request: { status: "approved", requested_date: "2026-10-20" } })).toBeNull();
    expect(serviceDateUpdateNotice({ service: {}, pending_date_request: null })).toBeNull();
    expect(serviceDateUpdateNotice({})).toBeNull();
    expect(serviceDateUpdateNotice(undefined)).toBeNull();
  });
  test("ServicePage.updateService reads the body, shows the notice, and does not write the date locally", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "ServicePage.js"), "utf8");
    expect(src).toMatch(/const body = await res\.json\(\)\.catch\(\(\) => \(\{\}\)\);/);
    expect(src).toMatch(/notice = serviceDateUpdateNotice\(body\)/);
    expect(src).toMatch(/if \(notice\) toast\[notice\.type\]\(notice\.message\)/);
    expect(src).not.toMatch(/detail\.service\.due_date\s*=/);
  });
});
