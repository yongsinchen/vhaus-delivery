// Single-boundary normalizers for data that crosses into the app from a place
// whose shape we do not control: the API (/auth/profile, /permissions/effective,
// /auth/switch-company), a DB row (orders.items), or long-lived browser storage
// (pulseActiveCompanyId). Everything downstream (.some/.map/.filter/.has) then
// receives a stable, correctly-typed value instead of whatever a stale device or
// a mis-encoded row happened to hold — the class of bug behind the production
// "t.some is not a function" login crash.
//
// SECURITY: these helpers are FAIL-CLOSED. A malformed permission/company/role
// value is never turned into a permissive default — it normalizes to "nothing"
// (empty list / null), and callers then fall back to the canonical server data.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// orders.items / order-shaped item collections -> a real array, always.
// Accepts an array, or a JSON string that decodes to one (the common legacy
// encoding). Anything else (a double-encoded string that decodes to a STRING,
// an object, a number, corrupt JSON) is []. Warns once so a genuine
// data-quality anomaly stays visible instead of silently swallowed.
export function normalizeOrderItems(raw, orderId) {
  let v = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v || "[]"); } catch { v = []; }
  }
  if (!Array.isArray(v)) {
    if (v != null) console.warn(`[fromDb] order ${orderId ?? "?"} has a non-array items value after parsing — defaulting to []`, v);
    return [];
  }
  return v;
}

// effectivePermissions / permissions list -> array of non-empty permission-key
// strings. The server contract is an array of action keys. A bare string, an
// object, null, or an array containing non-strings yields only the valid
// string keys (or nothing) — NEVER a guess. In particular a string is not
// spread into characters and an object's keys are not promoted to permissions.
export function normalizePermissionKeys(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(k => typeof k === "string" && k.trim() !== "");
}

// /permissions/effective historically returned either an array of keys or an
// object map { KEY: {allowed}|true }. Only an array or a plain object map is
// understood; an object entry counts only if it is explicitly allowed.
export function normalizePermissionResponse(raw) {
  if (Array.isArray(raw)) return normalizePermissionKeys(raw);
  if (raw && typeof raw === "object") {
    return Object.keys(raw).filter(k => {
      const v = raw[k];
      return v === true || (v && typeof v === "object" && v.allowed === true);
    });
  }
  return [];
}

// availableCompanies -> array of { companyId (UUID string), ... } entries.
// A wrapper object, string, null, or malformed entries (no usable companyId)
// are dropped — an unusable entry must not appear as a company the user can
// switch into. The server still authorizes every company switch.
export function normalizeAvailableCompanies(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(c => c && typeof c === "object" && typeof c.companyId === "string" && UUID_RE.test(c.companyId));
}

// A company id is a UUID string. Anything else (null/"null"/"undefined"/""/
// "{}"/"[object Object]"/a JSON blob) is not an id and must not be sent as an
// X-Company-ID header or used in a company_id filter.
export function isValidCompanyId(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

// Read the persisted active company. A malformed/stale stored value is removed
// (so it cannot poison every later request on this device) and treated as "no
// stored company"; the server then supplies the canonical active company.
export function readStoredCompanyId(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    const v = storage ? storage.getItem("pulseActiveCompanyId") : null;
    if (v == null) return null;
    if (isValidCompanyId(v)) return v;
    try { storage.removeItem("pulseActiveCompanyId"); } catch {}
    return null;
  } catch { return null; }
}
