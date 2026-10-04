// PATCH /service-cases/:id answers { service, pending_date_request }. A real reschedule of a Service date that
// the 10-day Delivery Date Approval rule gates is QUEUED, not applied: the operational date intentionally stays
// on the old day until an approver decides. The UI must say so — otherwise the detail re-renders on the old
// date and the edit looks like a silent no-op. This never fakes the new date locally.

// → null (nothing to tell the user) | { type: "success" | "info", message }
export function serviceDateUpdateNotice(body) {
  const req = body && body.pending_date_request;
  if (!req) return null;
  if (req.status === "approved") return null; // applied immediately — the refreshed detail shows it
  const date = req.requested_date ? ` to ${req.requested_date}` : "";
  return { type: "info", message: `Date change${date} submitted for approval — the current date stays until it is approved` };
}
