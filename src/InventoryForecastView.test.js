// Inventory → Forecast product list: NEEDS REVIEW flag + filter, upper case, model → name → size order,
// search (model / SKU / name / size, case-insensitive) working together with the filter and pagination,
// quantities and negative balances shown exactly as the backend computed them.
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import InventoryForecastView, { FORECAST_PAGE_SIZE } from "./InventoryForecastView";

const month = (m, opening, closing, events = []) => ({ month: m, opening, closing, events });
const row = (id, product, months, extra = {}) => ({ product_id: id, product, on_hand: months[0].opening, months, first_negative: null, ...extra });

const DATA = [
  row("p1", { id: "p1", code: "kayla", name: "Gub Dining Table", size: "6ft" },
    [month("2026-11", 0, -2, [{ date: "2026-11-10", type: "out", qty: 2, ref: "7001", balance: -2 }])], { first_negative: { date: "2026-11-10", balance: -2 } }),
  row("p2", { id: "p2", code: "BC7000", name: "bench chair", size: null },
    [month("2026-11", 0, 4, [{ date: "2026-11-05", type: "in", qty: 5, ref: "PO-1", balance: 5 }, { date: "2026-11-10", type: "out", qty: 1, ref: "7001", balance: 4 }])]),
  row("p3", { id: "p3", product_missing: true }, [month("2026-11", 0, -1, [{ date: "2026-11-10", type: "out", qty: 1, ref: "7001", balance: -1 }])], { first_negative: { date: "2026-11-10", balance: -1 } }),
  row("p4", { id: "p4", code: "LP", name: "Product", size: "" }, [month("2026-11", 3, 3)]),
  row("p5", { id: "p5", code: "", name: "", size: "queen" }, [month("2026-11", 1, 1)]),
];

const rows = () => screen.queryAllByTestId("forecast-row");
const cellText = r => within(r).getByTestId("product-cell").textContent;
const search = q => fireEvent.change(screen.getByLabelText("Search product"), { target: { value: q } });

test("product names are shown in UPPER CASE, model → name → size", () => {
  render(<InventoryForecastView projection={DATA} />);
  const kayla = rows().find(r => cellText(r).includes("KAYLA"));
  const parts = [...within(kayla).getByTestId("product-cell").querySelectorAll("[data-part]")].map(e => [e.dataset.part, e.textContent]);
  expect(parts).toEqual([["model", "KAYLA"], ["name", "GUB DINING TABLE"], ["size", "6FT"]]);
  expect(screen.queryByText("Gub Dining Table")).toBeNull();
});

test("rows without a real product name are flagged NEEDS REVIEW; a generic 'Product' label is never shown as a name", () => {
  render(<InventoryForecastView projection={DATA} />);
  const flagged = rows().filter(r => cellText(r).includes("NEEDS REVIEW"));
  expect(flagged).toHaveLength(3); // record missing (p3), "Product" placeholder (p4), blank name (p5)
  for (const r of flagged) expect(within(r).getByText("No product name")).toBeTruthy();
  expect(screen.queryByText(/^PRODUCT$/)).toBeNull();
  expect(screen.getByText("LP")).toBeTruthy();      // existing model still shown
  expect(screen.getByText("QUEEN")).toBeTruthy();   // existing size still shown, nothing invented
});

test("Needs Review filter shows only flagged rows, with counts", () => {
  render(<InventoryForecastView projection={DATA} />);
  expect(screen.getByRole("button", { name: /^All\s*5$/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Needs Review\s*3/ }));
  expect(rows()).toHaveLength(3);
  expect(rows().every(r => cellText(r).includes("NEEDS REVIEW"))).toBe(true);
});

test("search covers model, SKU code, name and size, case-insensitive, and combines with the filter", () => {
  render(<InventoryForecastView projection={DATA} />);
  search("bench");   expect(rows().map(cellText).join()).toMatch(/BC7000BENCH CHAIR/);  expect(rows()).toHaveLength(1);
  search("bc7000");  expect(rows()).toHaveLength(1);
  search("6FT");     expect(rows().map(cellText).join()).toMatch(/KAYLA/);              expect(rows()).toHaveLength(1);
  search("Queen");   expect(rows()).toHaveLength(1);
  search("kayla 6ft"); expect(rows()).toHaveLength(1);
  search("lp");
  fireEvent.click(screen.getByRole("button", { name: /Needs Review/ }));
  expect(rows()).toHaveLength(1);   // LP is both a search hit and needs review
  search("kayla");
  expect(rows()).toHaveLength(0);   // a hit, but not one that needs review
  expect(screen.getByText("No products match this search.")).toBeTruthy();
});

test("quantities and negative balances are shown unchanged", () => {
  render(<InventoryForecastView projection={DATA} />);
  const kayla = rows().find(r => cellText(r).includes("KAYLA"));
  expect(within(kayla).getByTestId("closing").textContent).toBe("-2");
  expect(within(kayla).getByTestId("closing").className).toMatch(/text-red-600/);
  expect(within(kayla).getByText("−2")).toBeTruthy();
  const bench = rows().find(r => cellText(r).includes("BC7000"));
  expect(within(bench).getByText("+5")).toBeTruthy();
  expect(within(bench).getByTestId("closing").textContent).toBe("4");
  expect(screen.getByText("2 products run out")).toBeTruthy();
});

test("pagination pages the filtered list and resets to page 1 when the search changes", () => {
  const many = Array.from({ length: FORECAST_PAGE_SIZE + 7 }, (_, i) =>
    row(`m${i}`, { id: `m${i}`, code: `M${String(i).padStart(3, "0")}`, name: i % 2 ? "Chair" : "", size: "" }, [month("2026-11", 1, 1)]));
  render(<InventoryForecastView projection={many} />);
  expect(rows()).toHaveLength(FORECAST_PAGE_SIZE);
  expect(screen.getByText(`1–${FORECAST_PAGE_SIZE} of ${many.length} products`)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(rows()).toHaveLength(7);
  search("chair"); // 28 hits → one page, back on page 1
  expect(rows()).toHaveLength(28);
  expect(screen.queryByTestId("pager")).toBeNull();
  search("");
  fireEvent.click(screen.getByRole("button", { name: /Needs Review/ })); // 29 unnamed rows
  expect(rows()).toHaveLength(29);
});

test("switching company clears the search and filter", () => {
  const { rerender } = render(<InventoryForecastView projection={DATA} resetKey="A" />);
  search("kayla");
  fireEvent.click(screen.getByRole("button", { name: /Needs Review/ }));
  rerender(<InventoryForecastView projection={DATA} resetKey="B" />);
  expect(screen.getByLabelText("Search product").value).toBe("");
  expect(rows()).toHaveLength(5);
});
