# Service Request Flow — Salesman → Approval

How a salesman raises a service case and how a manager approves it in the current
PulseOS system. A request holds in a queue and **creates nothing until an approver
signs off** — the same gate as delivery-date approvals.

**Roles**

- 🟣 **Salesman acts**
- 🟢 **Approver acts** — Master · Manager · Operation Manager · Company Admin

---

## 1. Salesman — Open “New Service Case” and fill it in

On the **Services** page, click **+ New Service Case**. Pick the service type,
optionally link the source order (search SO number or customer), and enter the
customer details, the issue description, and any line items — each with a name,
quantity, and an optional arrival date.

Service types:

| Type | |
| :-- | :-- |
| 🔧 Warranty Repair | 🪛 Assembly / Installation |
| 🔄 Exchange / Replacement | 🚚 Delivery (Missing Item) |
| 📦 Delivery | |

Set the **Service Creation Date** and a wanted **Schedule Date** — or tick **TBC**
to leave it unscheduled.

## 2. Salesman — Submit for approval

Because a salesman isn’t an approver, the button reads **“Submit for approval.”**
This files a **pending request only** — no service case, no legs, nothing enters
the operations, warehouse, or delivery pool yet.

The request appears under the salesman’s **My Requests** tab so they can track its
status.

## 3. Approver — Request lands in the Approvals queue

Every approver sees it under the **Approvals** tab on the Services page, with a red
count badge showing how many are pending. Salesmen see only their own requests;
approvers see the whole company queue.

## 4. Approver — Open the request and review full details

Click the request to open the detail view: customer, contact, address, the full
description, every line item with its arrival date, the requested and wanted dates,
and who submitted it.

## 5. Approver — Decide, and optionally propose another date

From the same detail view the approver sets the schedule date. They can keep the
salesman’s wanted date, **propose a different date**, or mark it **TBC** — then take
one of three actions:

| Action | What happens |
| :-- | :-- |
| ✅ **Approve** | The real service case is created on the approver’s chosen date and attributed to the salesman. |
| 🟠 **Propose date** | Approve with a new schedule date (or TBC) instead of the requested one. |
| ⛔ **Reject** | Nothing is created. An optional reason is saved and shown to the salesman. |

On approve, the backend builds the full case in one step — **service record +
service legs + an inert delivery order + line items**. It now enters the pool and
shows under **Service Cases** (or the **Delivery** tab for a plain Delivery type).
On reject, the salesman sees it as **Rejected** under My Requests.

## After approval — automatic

The approved case carries a **Warehouse → Customer delivery leg** that flows onto
the delivery board for its scheduled date. Once that delivery route is completed,
the service case **resolves on its own** — no manual close-off needed.

---

_Reflects the current build: service requests mirror the delivery-date approval
gate. Approver roles — `master · manager · operation_manager · company_admin`.
Nothing takes effect until an approver signs off._
