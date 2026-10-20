import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ConfirmDeliveredItemsModal, { initialConfirmState, buildConfirmLines, summariseConfirm, doLineKey, confirmEndpoints } from "./ConfirmDeliveredItemsModal";
import { statusOptionsFor } from "./OrdersPage";

// Context as GET …/delivery-confirmation returns it.
const item = (id, name, quantity, extra = {}) => ({ id, product_name: name, product_code: name.toUpperCase(), quantity, delivered_qty: 0, remaining: quantity, on_open_do: 0, on_failed_do: 0, without_do: quantity, ...extra });
const ctxOneDo = {
  items: [item("i1", "Chair", 4, { on_open_do: 4, without_do: 0 }), item("i2", "Table", 1, { on_open_do: 1, without_do: 0 })],
  open_delivery_orders: [{ id: "d1", do_number: "DO2610-0001", status: "scheduled", delivery_date: "2026-10-25",
    lines: [{ sales_order_item_id: "i1", quantity: 4, delivered_qty: 0 }, { sales_order_item_id: "i2", quantity: 1, delivered_qty: 0 }] }],
  failed_delivery_orders: [],
};
const ctxTwoDos = {
  items: [item("i1", "Chair", 6, { on_open_do: 6, without_do: 0 })],
  open_delivery_orders: [
    { id: "d1", do_number: "DO-A", status: "scheduled", delivery_date: "2026-10-25", lines: [{ sales_order_item_id: "i1", quantity: 2, delivered_qty: 0 }] },
    { id: "d2", do_number: "DO-B", status: "draft", delivery_date: "2026-11-05", lines: [{ sales_order_item_id: "i1", quantity: 4, delivered_qty: 0 }] }],
  failed_delivery_orders: [],
};
const ctxNoDo = { items: [item("i1", "Sofa", 3), item("i2", "Pillow", 1)], open_delivery_orders: [], failed_delivery_orders: [{ id: "f1", do_number: "DO-F" }] };

describe("Confirm Delivered Items — rules", () => {
  test("one open DO is pre-selected at full quantity", () => {
    const s = initialConfirmState(ctxOneDo);
    expect([...s.selected]).toEqual(["d1"]);
    expect(s.qty[doLineKey("d1", "i1")]).toBe("4");
    const { lines, problems } = buildConfirmLines(ctxOneDo, s.selected, s.qty);
    expect(problems).toEqual([]);
    expect(lines).toEqual([{ sales_order_item_id: "i1", delivery_order_id: "d1", quantity: 4 }, { sales_order_item_id: "i2", delivery_order_id: "d1", quantity: 1 }]);
    expect(summariseConfirm(ctxOneDo, lines).status).toBe("Delivered");
  });

  test("several open DOs: none pre-selected — never assume every DO was delivered", () => {
    const s = initialConfirmState(ctxTwoDos);
    expect(s.selected.size).toBe(0);
    expect(buildConfirmLines(ctxTwoDos, s.selected, s.qty).lines).toEqual([]);
    const one = buildConfirmLines(ctxTwoDos, new Set(["d1"]), s.qty);
    expect(one.lines).toEqual([{ sales_order_item_id: "i1", delivery_order_id: "d1", quantity: 2 }]);
    expect(summariseConfirm(ctxTwoDos, one.lines).status).toBe("Partially Delivered");
  });

  test("partial quantity on a DO; a ticked DO with nothing entered is a problem; over the DO line is a problem", () => {
    const s = initialConfirmState(ctxOneDo);
    let r = buildConfirmLines(ctxOneDo, s.selected, { ...s.qty, [doLineKey("d1", "i1")]: "3", [doLineKey("d1", "i2")]: "0" });
    expect(r.lines).toEqual([{ sales_order_item_id: "i1", delivery_order_id: "d1", quantity: 3 }]);
    expect(summariseConfirm(ctxOneDo, r.lines).status).toBe("Partially Delivered");
    r = buildConfirmLines(ctxOneDo, s.selected, { [doLineKey("d1", "i1")]: "0", [doLineKey("d1", "i2")]: "0" });
    expect(r.problems.join()).toMatch(/ticked but no quantity/);
    r = buildConfirmLines(ctxOneDo, s.selected, { ...s.qty, [doLineKey("d1", "i1")]: "5" });
    expect(r.problems.join()).toMatch(/at most 4/);
    r = buildConfirmLines(ctxOneDo, s.selected, { ...s.qty, [doLineKey("d1", "i1")]: "-1" });
    expect(r.problems.join()).toMatch(/valid quantity/);
  });

  test("no open DO: items pre-filled under 'without a Delivery Order'; capped at what is not on a DO", () => {
    const s = initialConfirmState(ctxNoDo);
    expect(s.qty[doLineKey(null, "i1")]).toBe("3");
    let r = buildConfirmLines(ctxNoDo, s.selected, s.qty);
    expect(r.lines).toEqual([{ sales_order_item_id: "i1", delivery_order_id: null, quantity: 3 }, { sales_order_item_id: "i2", delivery_order_id: null, quantity: 1 }]);
    r = buildConfirmLines(ctxNoDo, s.selected, { ...s.qty, [doLineKey(null, "i2")]: "2" });
    expect(r.problems.join()).toMatch(/at most 1/);
  });

  test("items not on any DO stay at 0 when the order also has an open DO (never guessed)", () => {
    const ctx = { ...ctxOneDo, items: [...ctxOneDo.items, item("i3", "Lamp", 1)] };
    const s = initialConfirmState(ctx);
    expect(s.qty[doLineKey(null, "i3")]).toBe("0");
  });

  test("endpoints per entry point", () => {
    expect(confirmEndpoints("X", "sales_order", "so1")).toEqual({ contextUrl: "X/sales-orders/so1/delivery-confirmation", confirmUrl: "X/sales-orders/so1/confirm-delivered-items" });
    expect(confirmEndpoints("X", "driver", "s1").confirmUrl).toBe("X/driver/schedule/s1/confirm-delivered-items");
    expect(confirmEndpoints("X", "schedule", "s1").contextUrl).toBe("X/delivery-schedules/s1/delivery-confirmation");
  });

  test("edit-form / list status options: a delivery status is only offered by the list (it opens the dialog)", () => {
    expect(statusOptionsFor("confirmed")).toContain("delivered");
    expect(statusOptionsFor("confirmed", { allowDelivery: false })).not.toContain("delivered");
    expect(statusOptionsFor("partially_delivered")).toContain("partially_delivered");
    expect(statusOptionsFor("delivered", { allowDelivery: false })).toContain("delivered");
  });
});

describe("Confirm Delivered Items — dialog", () => {
  test("loads once, shows the DO, confirms with one idempotency key and reports the result", async () => {
    const load = jest.fn().mockResolvedValue(ctxOneDo);
    const submit = jest.fn().mockResolvedValue({ ok: true, body: { confirmation: { sales_order_status: "delivered" } } });
    const onDone = jest.fn();
    const { rerender } = render(<ConfirmDeliveredItemsModal title="Confirm Delivered Items — SO 5001" load={load} submit={submit} onClose={() => {}} onDone={onDone} />);
    expect(await screen.findByText("DO2610-0001")).toBeInTheDocument();
    rerender(<ConfirmDeliveredItemsModal title="Confirm Delivered Items — SO 5001" load={jest.fn()} submit={submit} onClose={() => {}} onDone={onDone} />);
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/After confirming:/).textContent).toMatch(/Delivered/);
    fireEvent.change(screen.getByLabelText("Delivered Chair on DO2610-0001"), { target: { value: "3" } });
    expect(screen.getByText(/After confirming:/).textContent).toMatch(/Partially Delivered/);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Delivered Items" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ sales_order_status: "delivered" }));
    const body = submit.mock.calls[0][0];
    expect(body.lines).toEqual([{ sales_order_item_id: "i1", delivery_order_id: "d1", quantity: 3 }, { sales_order_item_id: "i2", delivery_order_id: "d1", quantity: 1 }]);
    expect(body.idempotency_key).toMatch(/^cdi-/);
  });

  test("a retry after a failure re-sends the SAME key (never counted twice); the server error is shown", async () => {
    const submit = jest.fn()
      .mockResolvedValueOnce({ ok: false, body: { error: "Delivery Order DO2610-0001 is completed and cannot be confirmed" } })
      .mockResolvedValueOnce({ ok: true, body: { confirmation: { sales_order_status: "delivered" } } });
    render(<ConfirmDeliveredItemsModal load={() => Promise.resolve(ctxOneDo)} submit={submit} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText("DO2610-0001");
    fireEvent.click(screen.getByRole("button", { name: "Confirm Delivered Items" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/completed and cannot be confirmed/);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Delivered Items" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0].idempotency_key).toBe(submit.mock.calls[0][0].idempotency_key);
  });

  test("several DOs: nothing ticked → the button stays disabled; ticking one enables it", async () => {
    render(<ConfirmDeliveredItemsModal load={() => Promise.resolve(ctxTwoDos)} submit={jest.fn()} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText("DO-A");
    expect(screen.getByText(/tick only the ones that were delivered/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Confirm Delivered Items" });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Delivered on DO-A"));
    expect(btn).not.toBeDisabled();
  });

  test("failed DO is explained; a load error is shown", async () => {
    render(<ConfirmDeliveredItemsModal load={() => Promise.resolve(ctxNoDo)} submit={jest.fn()} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText(/DO-F: reschedule or cancel it first/)).toBeInTheDocument();
    expect(screen.getByText(/Delivered without a Delivery Order/)).toBeInTheDocument();
  });

  test("load failure", async () => {
    render(<ConfirmDeliveredItemsModal load={() => Promise.reject(new Error("Sales order not found"))} submit={jest.fn()} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText("Sales order not found")).toBeInTheDocument();
  });
});

// Sofa + BILL "Full Bill Amount" (+ an ambiguous TOP UP line), as GET …/delivery-confirmation returns it.
const bill = { ...item("b1", "Full Bill Amount", 1), product_code: "BILL", remaining: 0, without_do: 0, non_goods: true, non_goods_rule: "bill_full_amount" };
const ctxBill = {
  items: [item("s1", "Sofa", 1, { on_open_do: 1, without_do: 0 }), bill, item("t1", "TOP UP SOFA", 1, { non_goods: false })],
  open_delivery_orders: [{ id: "d1", do_number: "DO-S", status: "scheduled", delivery_date: "2026-10-25",
    lines: [{ sales_order_item_id: "s1", quantity: 1, delivered_qty: 0, non_goods: false }, { sales_order_item_id: "b1", quantity: 1, delivered_qty: 0, non_goods: true }] }],
  failed_delivery_orders: [], goods_count: 2, only_non_goods: false,
};
const ctxOnlyBill = { items: [bill, { ...bill, id: "b2", product_name: "Delivery Fee", product_code: "CUSTOM" }], open_delivery_orders: [], failed_delivery_orders: [], goods_count: 0, only_non_goods: true };

describe("Confirm Delivered Items — billing / charge lines (owner decision 2026-10-20)", () => {
  test("a BILL line is never entered: no quantity key, never sent, not in the summary", () => {
    const s = initialConfirmState(ctxBill);
    expect(s.qty[doLineKey("d1", "b1")]).toBeUndefined();
    expect(s.qty[doLineKey(null, "b1")]).toBeUndefined();
    const { lines } = buildConfirmLines(ctxBill, s.selected, { ...s.qty, [doLineKey("d1", "b1")]: "1", [doLineKey(null, "b1")]: "1" });
    expect(lines.some(l => l.sales_order_item_id === "b1")).toBe(false);
    expect(summariseConfirm(ctxBill, lines).rows.map(r => r.id)).toEqual(["s1", "t1"]);
  });

  test("the BILL never holds the order back: sofa + the ambiguous TOP UP confirmed → Delivered", () => {
    const s = initialConfirmState(ctxBill);
    const { lines } = buildConfirmLines(ctxBill, s.selected, { ...s.qty, [doLineKey(null, "t1")]: "1" });
    expect(summariseConfirm(ctxBill, lines).status).toBe("Delivered");
  });

  test("an ambiguous line (TOP UP) is still goods: without it the order is only Partially Delivered", () => {
    const s = initialConfirmState(ctxBill);
    expect(s.qty[doLineKey(null, "t1")]).toBe("0");
    expect(summariseConfirm(ctxBill, buildConfirmLines(ctxBill, s.selected, s.qty).lines).status).toBe("Partially Delivered");
  });

  test("dialog: BILL shown read-only on the DO and in the billing list, no input for it", async () => {
    render(<ConfirmDeliveredItemsModal load={() => Promise.resolve(ctxBill)} submit={jest.fn()} onClose={() => {}} onDone={() => {}} />);
    await screen.findByText("DO-S");
    expect(screen.getByTestId("do-line-non-goods")).toHaveTextContent("billing / charge line — not delivered");
    expect(screen.queryByLabelText("Delivered Full Bill Amount on DO-S")).toBeNull();
    expect(screen.queryByLabelText("Delivered Full Bill Amount without a Delivery Order")).toBeNull();
    expect(screen.getByTestId("non-goods-lines")).toHaveTextContent("Full Bill Amount");
    expect(screen.getByLabelText("Delivered TOP UP SOFA without a Delivery Order")).toBeInTheDocument();
  });

  test("dialog: an order with only billing / charge lines — nothing to deliver, flagged for review, button disabled", async () => {
    render(<ConfirmDeliveredItemsModal load={() => Promise.resolve(ctxOnlyBill)} submit={jest.fn()} onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByTestId("only-non-goods")).toHaveTextContent(/flagged for review/);
    expect(screen.getByRole("button", { name: "Confirm Delivered Items" })).toBeDisabled();
    expect(buildConfirmLines(ctxOnlyBill, new Set(), {}).problems[0]).toMatch(/only billing \/ charge lines/);
  });
});
