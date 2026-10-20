// Product labels (presentation only): missing names flagged, upper case, model → name → size, search.
import { productLabel, matchesProductSearch } from "./productLabel";

describe("productLabel", () => {
  test("upper-cases model, name and size for display without changing the input", () => {
    const p = { id: "p1", code: "kayla", name: "  GUB   dining Table ", size: "6ft" };
    const copy = JSON.stringify(p);
    const l = productLabel(p);
    expect([l.model, l.name, l.size]).toEqual(["KAYLA", "GUB DINING TABLE", "6FT"]);
    expect(l.needsReview).toBe(false);
    expect(JSON.stringify(p)).toBe(copy); // stored data untouched
  });

  test("a missing name is flagged NEEDS REVIEW — never replaced by a generic 'Product'", () => {
    for (const name of [null, undefined, "", "   "]) {
      const l = productLabel({ id: "p1", code: "BC7000", name });
      expect(l.needsReview).toBe(true);
      expect(l.reviewReason).toBe("name_missing");
      expect(l.name).toBe("");
      expect(l.model).toBe("BC7000"); // what exists is still shown
    }
  });

  test("a stored name that is only 'Product' is a placeholder, not a product name", () => {
    for (const name of ["Product", "product", " PRODUCT "]) {
      const l = productLabel({ id: "p1", code: "", name });
      expect(l.needsReview).toBe(true);
      expect(l.reviewReason).toBe("placeholder_name");
      expect(l.name).toBe("");
    }
    expect(productLabel({ name: "Product Display Shelf" }).needsReview).toBe(false);
  });

  test("a product record missing for this company is flagged; nothing is invented", () => {
    const l = productLabel({ id: "abc", product_missing: true });
    expect(l).toMatchObject({ needsReview: true, reviewReason: "record_missing", model: "", name: "", size: "" });
    expect(productLabel(null)).toMatchObject({ needsReview: true, reviewReason: "name_missing", model: "", name: "", size: "" });
  });
});

describe("matchesProductSearch", () => {
  const l = productLabel({ code: "KAYLA-01", name: "Gub Dining Table", size: "6FT" });
  test.each([["kayla"], ["KAYLA-01"], ["dining"], ["GUB DINING"], ["6ft"], ["kayla 6FT"], [""], ["  "]])("matches %p (case-insensitive)", q => {
    expect(matchesProductSearch(l, q)).toBe(true);
  });
  test.each([["sofa"], ["kayla 7ft"], ["product"]])("does not match %p", q => {
    expect(matchesProductSearch(l, q)).toBe(false);
  });
});
