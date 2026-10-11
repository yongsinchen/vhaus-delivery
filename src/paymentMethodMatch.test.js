/**
 * Sales Order print — payment method checkbox mapping.
 *
 * Root cause under test: the SO print ticked a box only on EXACT ===
 * equality with its six option labels, but payment_method is stored under
 * several label vocabularies across the app (OrdersPage vs App.js/DriverPage
 * vs CustomerPage) plus legacy spellings, so most values ticked nothing.
 * matchPaymentOption() maps any of them to one of the six printed options,
 * returns null for missing/unknown (never defaults to Cash), and ignores
 * later payment transactions (it only sees the SO's own field).
 */
import { matchPaymentOption, PAYMENT_METHOD_OPTIONS } from "./paymentMethodMatch";

describe("matchPaymentOption", () => {
  test("canonical options map to themselves", () => {
    for (const o of PAYMENT_METHOD_OPTIONS) expect(matchPaymentOption(o)).toBe(o);
  });

  test("Card aliases", () => {
    for (const v of ["Card", "Credit Card", "Debit Card", "Credit Card / Debit Card", "VISA", "mastercard"])
      expect(matchPaymentOption(v)).toBe("Card");
  });

  test("Online Transfer aliases", () => {
    for (const v of ["Online Transfer", "Bank Transfer", "bank transfer", "Bank-in", "Online Banking", "IBG", "DuitNow Transfer", "Transfer"])
      expect(matchPaymentOption(v)).toBe("Online Transfer");
  });

  test("E-Wallet aliases (QR / contactless wallets)", () => {
    for (const v of ["E-Wallet", "E Wallet", "ewallet", "QR Pay", "QR", "Touch n Go", "Touch 'n Go", "TnG", "GrabPay", "Boost", "ShopeePay", "DuitNow QR", "2C2P", "eZbeli"])
      expect(matchPaymentOption(v)).toBe("E-Wallet");
  });

  test("Cheque aliases", () => {
    for (const v of ["Cheque", "cheque", "Check"]) expect(matchPaymentOption(v)).toBe("Cheque");
  });

  test("Instalment aliases (incl. US spelling)", () => {
    for (const v of ["Instalment", "Installment", "installments"]) expect(matchPaymentOption(v)).toBe("Instalment");
  });

  test("Cash", () => {
    for (const v of ["Cash", "cash", "  CASH  "]) expect(matchPaymentOption(v)).toBe("Cash");
  });

  test("case / whitespace / punctuation insensitive", () => {
    expect(matchPaymentOption("  Bank   Transfer ")).toBe("Online Transfer");
    expect(matchPaymentOption("e-wallet")).toBe("E-Wallet");
    expect(matchPaymentOption("ONLINE TRANSFER")).toBe("Online Transfer");
  });

  test("missing / blank → null (never defaults to Cash)", () => {
    for (const v of ["", null, undefined, "   "]) {
      expect(matchPaymentOption(v)).toBeNull();
    }
  });

  test("unknown value → null (no guess, no default)", () => {
    for (const v of ["Cash Rebate", "Barter", "Crypto", "Foo"]) {
      const r = matchPaymentOption(v);
      expect(r).toBeNull();
      expect(r).not.toBe("Cash");
    }
  });
});
