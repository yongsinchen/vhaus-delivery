// The customer phone lookup fills the order form from a saved customer, but
// `customers` stores no country and no I/C-vs-passport flag — both have to be
// inferred. These lock in that inference.
//
// detectCountryFromAddress was lifted out of the Billing Address field's inline
// handler so the autofill reaches the same answer as typing the address by
// hand. The cases below are the behaviour that handler already had.
import { detectCountryFromAddress, inferIdType } from "./OrdersPage";

describe("detectCountryFromAddress", () => {
  test("5-digit postcode is Malaysian", () => {
    expect(detectCountryFromAddress("12 Jalan Bukit, 11900 Bayan Lepas")).toBe("MY");
  });

  test("6-digit postcode inside the Singapore range is Singaporean", () => {
    expect(detectCountryFromAddress("Blk 123 Ang Mo Kio Ave 3, 560123")).toBe("SG");
  });

  test("6-digit number outside the Singapore range is not SG", () => {
    // 900000 is past the 829999 ceiling — must not be read as a postcode.
    expect(detectCountryFromAddress("Lot 900000 somewhere")).toBeNull();
  });

  test("place name carries it when there is no postcode", () => {
    expect(detectCountryFromAddress("15 Jalan Sultan, Kuala Lumpur")).toBe("MY");
    expect(detectCountryFromAddress("30 Orchard Road, Singapore")).toBe("SG");
  });

  test("'SG ARA' is Malaysian, not Singapore", () => {
    // The word-boundary guard: SG ARA is a Selangor township.
    expect(detectCountryFromAddress("22 Jalan SG ARA, Penang")).toBe("MY");
  });

  test("postcode wins over a place name", () => {
    expect(detectCountryFromAddress("1 Raffles Place Singapore 049315")).toBe("SG");
  });

  test("a house number is not mistaken for a postcode", () => {
    expect(detectCountryFromAddress("12345 Main")).toBe("MY"); // standalone 5-digit
    expect(detectCountryFromAddress("No.7A, Some Road")).toBeNull();
  });

  test("nothing conclusive returns null so the country is left alone", () => {
    expect(detectCountryFromAddress("")).toBeNull();
    expect(detectCountryFromAddress(null)).toBeNull();
    expect(detectCountryFromAddress("abc")).toBeNull(); // too short to inspect
    expect(detectCountryFromAddress("Some Street, Somewhere")).toBeNull();
  });
});

describe("inferIdType", () => {
  test("digits only is a Malaysian I/C", () => {
    expect(inferIdType("901231-07-5544")).toBe("ic");
    expect(inferIdType("900101075544")).toBe("ic");
  });

  test("anything containing letters is a passport", () => {
    expect(inferIdType("A12345678")).toBe("passport");
    expect(inferIdType("E1234567X")).toBe("passport");
  });

  test("empty falls back to I/C, the form's default", () => {
    expect(inferIdType("")).toBe("ic");
    expect(inferIdType(null)).toBe("ic");
  });
});
