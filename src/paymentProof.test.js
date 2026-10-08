// Edit / add payment proof from the Customer Profile — proof only.
const { TextEncoder, TextDecoder } = require("util");
Object.assign(global, { TextEncoder, TextDecoder });
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "./UIComponents";
import PaymentProofModal from "./PaymentProofModal";
import { proofEditPolicy, proofList } from "./paymentProofPolicy";

jest.mock("./AuthContext", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

const U1 = "https://x.supabase.co/storage/v1/object/public/order-attachments/order-attachments/co/old.jpg";
const U2 = "https://x.supabase.co/storage/v1/object/public/order-attachments/order-attachments/co/new.jpg";
const pend = (over = {}) => ({ id: "p1", or_number: 1265, amount: 8938, payment_method: "2C2P", approval_status: "pending", recorded_by: "jimmy", proof_url: U1, ...over });

describe("proofEditPolicy — which proof action is offered, by status and role", () => {
  test("pending: the recorder, a manager and Finance may replace; a different salesman gets nothing", () => {
    expect(proofEditPolicy(pend(), { id: "jimmy", role: "salesman", base_role: "part_time" })).toMatchObject({ mode: "replace", label: "Edit proof" });
    expect(proofEditPolicy(pend(), { id: "m", role: "manager" }).mode).toBe("replace");
    expect(proofEditPolicy(pend(), { id: "f", role: "finance" }).mode).toBe("replace");
    expect(proofEditPolicy(pend(), { id: "other", role: "salesman" }).mode).toBe("none");
  });
  test("approved: append-only for managers / Finance; nothing for a salesman — even the recorder", () => {
    expect(proofEditPolicy(pend({ approval_status: "approved" }), { id: "m", role: "manager" })).toMatchObject({ mode: "append", label: "Add proof" });
    expect(proofEditPolicy(pend({ approval_status: "approved" }), { id: "f", role: "finance" }).mode).toBe("append");
    expect(proofEditPolicy(pend({ approval_status: "approved" }), { id: "jimmy", role: "salesman" }).mode).toBe("none");
    expect(proofEditPolicy(pend({ approval_status: null }), { id: "m", role: "manager" }).mode).toBe("append");   // legacy row = approved
  });
  test("rejected: locked with the next step; a deposit row with no payment id: no action", () => {
    const p = proofEditPolicy(pend({ approval_status: "rejected" }), { id: "m", role: "manager" });
    expect(p.mode).toBe("locked"); expect(p.reason).toMatch(/new payment/i);
    expect(proofEditPolicy({ amount: 1 }, { id: "m", role: "manager" }).mode).toBe("none");
  });
  test("proofList keeps submission order (the last one is the latest)", () => {
    expect(proofList({ proof_url: `${U1}, ${U2}` })).toEqual([U1, U2]);
    expect(proofList({ proof_url: null })).toEqual([]);
  });
});

describe("PaymentProofModal", () => {
  let originalFetch, calls;
  beforeEach(() => {
    originalFetch = global.fetch; calls = [];
    global.fetch = jest.fn(async (url, opts = {}) => {
      const u = String(url); calls.push({ url: u, method: opts.method || "GET", body: opts.body });
      if (u.includes("/proof-history")) return { ok: true, json: async () => ({ history: [{ id: "e1", at: "2026-10-01T02:00:00Z", by_name: "Jimmy", status_at_time: "pending", added: [U2], superseded: [U1] }] }) };
      if (u.includes("/sales-orders/upload-attachment")) return { ok: true, json: async () => ({ url: U2 }) };
      if (opts.method === "PATCH") return { ok: true, json: async () => ({ payment: { id: "p1" }, added: [U2], superseded: [U1] }) };
      return { ok: true, json: async () => ({}) };
    });
  });
  afterEach(() => { global.fetch = originalFetch; });
  const open = (payment, mode, extra = {}) => render(<ToastProvider><PaymentProofModal payment={payment} mode={mode} onClose={() => {}} onSaved={extra.onSaved || (() => {})} /></ToastProvider>);

  test("the EXISTING proof is shown and can be previewed", async () => {
    open(pend(), "replace");
    expect(screen.getByText(/Proof 1 · old\.jpg/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Proof 1 · old\.jpg/));
    expect(screen.getByTestId("proof-preview")).toBeInTheDocument();
    expect(screen.getByAltText("Payment proof").getAttribute("src")).toBe(U1);
  });

  test("pending: upload a replacement → the NEW proof is displayed as 'Latest', the old one can be removed, Save sends the full new list as a proof-only PATCH", async () => {
    const onSaved = jest.fn();
    open(pend(), "replace", { onSaved });
    expect(screen.getByRole("button", { name: "Save proof" })).toBeDisabled();           // nothing changed yet
    fireEvent.change(screen.getByTestId("proof-file"), { target: { files: [new File(["x"], "n.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(screen.getAllByTestId("proof-row")).toHaveLength(2));
    const rows = screen.getAllByTestId("proof-row");
    expect(rows[1]).toHaveTextContent("new.jpg"); expect(rows[1]).toHaveTextContent("Latest"); expect(rows[1]).toHaveTextContent("New — not saved yet");
    expect(rows[0]).not.toHaveTextContent("Latest");
    fireEvent.click(rows[0].querySelector('button[title="Remove"]'));
    expect(screen.getByTestId("superseded-note")).toHaveTextContent(/kept on record as superseded/);
    fireEvent.click(screen.getByRole("button", { name: "Save proof" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const patch = calls.find(c => c.method === "PATCH");
    expect(patch.url).toMatch(/\/payments\/p1\/proof$/);
    expect(JSON.parse(patch.body)).toEqual({ proof_url: U2 });                           // ONLY proof_url — no amount / date / allocation
  });

  test("pending: the rule text says the payment stays pending and the old proof is kept", () => {
    open(pend(), "replace");
    expect(screen.getByTestId("proof-rule")).toHaveTextContent(/stays Pending approval/);
    expect(screen.getByTestId("proof-rule")).toHaveTextContent(/kept on record/);
  });

  test("approved: append-only — existing evidence has no remove button, the rule says so, new proofs can be added", async () => {
    open(pend({ approval_status: "approved" }), "append");
    expect(screen.getByTestId("proof-rule")).toHaveTextContent(/cannot be replaced or removed/);
    expect(screen.getByText("Approved evidence")).toBeInTheDocument();
    expect(screen.queryByTitle("Remove")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("proof-file"), { target: { files: [new File(["x"], "n.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(screen.getAllByTestId("proof-row")).toHaveLength(2));
    expect(screen.getAllByTitle("Remove")).toHaveLength(1);                              // only the unsaved new one
    fireEvent.click(screen.getByRole("button", { name: "Save proof" }));
    await waitFor(() => expect(calls.some(c => c.method === "PATCH")).toBe(true));
    expect(JSON.parse(calls.find(c => c.method === "PATCH").body).proof_url).toBe(`${U1}, ${U2}`);   // original first, supplementary after
  });

  test("a double click on Save sends ONE request", async () => {
    open(pend(), "replace");
    fireEvent.change(screen.getByTestId("proof-file"), { target: { files: [new File(["x"], "n.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(screen.getAllByTestId("proof-row")).toHaveLength(2));
    const save = screen.getByRole("button", { name: "Save proof" });
    fireEvent.click(save); fireEvent.click(save); fireEvent.click(save);
    await new Promise(r => setTimeout(r, 80));
    expect(calls.filter(c => c.method === "PATCH")).toHaveLength(1);
  });

  test("a server refusal shows its exact reason and does not report success", async () => {
    global.fetch = jest.fn(async (url, opts = {}) => {
      if (String(url).includes("/proof-history")) return { ok: true, json: async () => ({ history: [] }) };
      if (String(url).includes("upload-attachment")) return { ok: true, json: async () => ({ url: U2 }) };
      return { ok: false, json: async () => ({ error: "This payment changed while you were editing it (it may have just been approved). Reload and try again.", code: "payment_changed" }) };
    });
    const onSaved = jest.fn();
    open(pend(), "replace", { onSaved });
    fireEvent.change(screen.getByTestId("proof-file"), { target: { files: [new File(["x"], "n.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(screen.getAllByTestId("proof-row")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Save proof" }));
    await waitFor(() => expect(screen.getByText(/may have just been approved/)).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
  });

  test("the audit history (superseded originals) is shown and previewable", async () => {
    open(pend({ proof_url: U2 }), "replace");
    await waitFor(() => expect(screen.getByTestId("proof-history")).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Proof history \(1\)/));
    fireEvent.click(screen.getByText(/superseded: old\.jpg/));
    expect(screen.getByAltText("Payment proof").getAttribute("src")).toBe(U1);
  });
});

describe("Customer Profile wiring", () => {
  const read = (n) => require("fs").readFileSync(require("path").join(__dirname, n), "utf8");
  const src = read("CustomerPage.js"), row = read("PaymentLedgerRow.js"), modal = read("RecordPaymentModal.js");
  test("the payments list renders each line through PaymentLedgerRow; proof actions come from the policy; the latest proof is marked", () => {
    expect(src).toMatch(/<PaymentLedgerRow /);
    expect(src).toMatch(/onEditProof=\{\(pay, mode\) => setProofEdit\(\{ payment: pay, mode \}\)\}/);
    expect(src).toMatch(/onEdit=\{\(pay\) => openAmend\(pay\)\}/);                     // the existing Edit/Amend workflow is still the pending path
    expect(src).toMatch(/PaymentProofModal payment=\{proofEdit\.payment\} mode=\{proofEdit\.mode\}/);
    expect(row).toMatch(/ledgerActions\(p, user\)/);
    expect(row).toMatch(/data-testid="edit-proof-btn"/);
    expect(row).toMatch(/\{all\.length > 1 && i === all\.length - 1 \? " · latest" : ""\}/);
  });
  test("Edit Payment reuses the Record Payment form (no second form) and the backend-enforced edit route", () => {
    expect(row).toMatch(/data-testid="edit-payment-btn"/);
    expect(src).toMatch(/<RecordPaymentModal[\s\S]{0,400}amendPayment=\{payModal\.amend \|\| null\}/);   // same modal as Record Payment
    expect(modal).toMatch(/amending \? "Edit Payment" : "Record Payment"/);
    expect(modal).toMatch(/`\$\{API\}\/payments\/\$\{amendPayment\.id\}`, \{ method: "PATCH"/);
    expect(modal).not.toMatch(/proof_cleanup_warning/);                                                    // the server no longer deletes proofs
  });
});
