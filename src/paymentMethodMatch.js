// Map a stored Sales Order payment_method to the canonical print checkbox.
//
// The app records payment_method from several different label vocabularies
// (OrdersPage: Card / Online Transfer / E-Wallet; App.js & DriverPage:
// Bank Transfer / QR Pay / Credit Card / Touch n Go; CustomerPage: Credit Card
// / Debit Card / Touch n Go / 2C2P / eZbeli), plus historical/legacy spellings.
// The Sales Order print used an EXACT === match against its own six options, so
// anything stored under a different label never ticked a box. This normalises a
// stored value to one of the six printed options.
//
// Rules (per the fix spec):
//   - case/'n'/whitespace/punctuation insensitive
//   - NEVER infer from later payment transactions (callers pass the SO's own field)
//   - NEVER default to Cash (or anything) when the value is missing or unknown —
//     an unrecognised/blank value returns null and NO box is ticked.

// The six printed options, in print order. Kept in sync with OrdersPage's list.
const PAYMENT_METHOD_OPTIONS = ["Cash", "Card", "Online Transfer", "E-Wallet", "Cheque", "Instalment"];

// Normalise for matching: lowercase, strip punctuation to spaces, collapse spaces.
function norm(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Alias → canonical option. Keys are normalised (see norm()).
const ALIASES = {
  // Cash
  "cash": "Cash",
  // Card (credit/debit)
  "card": "Card",
  "credit card": "Card",
  "debit card": "Card",
  "credit debit card": "Card",         // "Credit Card / Debit Card"
  "credit card debit card": "Card",
  "visa": "Card", "mastercard": "Card", "master card": "Card",
  // Online bank transfer
  "online transfer": "Online Transfer",
  "bank transfer": "Online Transfer",
  "banktransfer": "Online Transfer",
  "bank in": "Online Transfer",
  "online banking": "Online Transfer",
  "ibg": "Online Transfer",
  "transfer": "Online Transfer",
  "duitnow transfer": "Online Transfer",
  // E-wallet / QR / contactless wallets
  "e wallet": "E-Wallet",
  "ewallet": "E-Wallet",
  "qr pay": "E-Wallet", "qr": "E-Wallet", "qrpay": "E-Wallet",
  "touch n go": "E-Wallet", "touchngo": "E-Wallet", "tng": "E-Wallet", "tng ewallet": "E-Wallet",
  "grabpay": "E-Wallet", "boost": "E-Wallet", "shopeepay": "E-Wallet",
  "duitnow qr": "E-Wallet", "duitnow": "E-Wallet",
  "2c2p": "E-Wallet", "ezbeli": "E-Wallet",
  // Cheque
  "cheque": "Cheque", "check": "Cheque",
  // Instalment
  "instalment": "Instalment", "installment": "Instalment",
  "instalments": "Instalment", "installments": "Instalment",
};

// Return the canonical printed option for a stored value, or null when the
// value is missing/blank/unrecognised (caller ticks nothing — never defaults).
function matchPaymentOption(stored) {
  const key = norm(stored);
  if (!key) return null;
  if (ALIASES[key]) return ALIASES[key];
  // Direct (normalised) equality with a canonical option, e.g. "e-wallet".
  const direct = PAYMENT_METHOD_OPTIONS.find(o => norm(o) === key);
  return direct || null;
}

module.exports = { PAYMENT_METHOD_OPTIONS, matchPaymentOption, _norm: norm };
