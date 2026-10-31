// One Delivery Order line as a single description: name, size, colour and the
// item's custom specs ("Col: Natural / G04 Beige", "Main Col: MOLLY-04 | Motor:
// …"). A delivery_order_item's own snapshot columns never carried the specs —
// they live on the source sales_order_item, joined in as `sales_order_items`
// (see vhaus-bot lib/selects.js). Same field order as the legacy whole-order
// stop's itemName (vhaus-bot lib/sync-sales-order.js), so DO stops and legacy
// stops read alike on the board, Print Schedule, PDF, Excel and the driver app.
// Repeated values (a colour also typed into the specs) appear once.
export function doItemCustomDimensions(it) {
  return (it.custom_dimensions || it.sales_order_items?.custom_dimensions || "").trim();
}

export function doItemLabel(it) {
  const parts = [it.product_name, it.size, it.color, doItemCustomDimensions(it)]
    .map(s => String(s ?? "").trim()).filter(Boolean);
  return [...new Set(parts)].join(" ");
}
