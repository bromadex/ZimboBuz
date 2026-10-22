import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { checkCustomers, checkProducts, parseCurrency, parseTaxCode, phoneKey, templateCsv } from "./import";

const noProducts = { skus: new Set<string>(), barcodes: new Set<string>() };
const noCustomers = { emails: new Set<string>(), phoneKeys: new Set<string>() };

describe("product import checks", () => {
  it("accepts the template as it is", () => {
    const check = checkProducts(parseCsv(templateCsv("products", "USD")), noProducts, "USD");
    expect(check.fileErrors).toEqual([]);
    expect(check.errorRows).toBe(0);
    expect(check.rows.map((r) => r.value)).toEqual([
      {
        sku: "CEM-50",
        name: "Cement 50kg",
        priceCents: 1250,
        unit: "bag",
        taxCode: "standard",
        barcode: "6001234567890",
        reorderLevel: "20",
        openingQty: "100",
        unitCostCents: 980,
      },
      {
        sku: "DELIVERY",
        name: "Delivery within town",
        priceCents: 500,
        unit: "each",
        taxCode: "exempt",
        barcode: null,
        reorderLevel: null,
        openingQty: null,
        unitCostCents: null,
      },
    ]);
  });

  it("recognises column names in any case, order and with a currency in brackets", () => {
    const quoted = checkProducts(parseCsv('Selling Price (ZiG),Product Name,SKU,VAT,Colour\n"1,250.00",Nails,N1,Zero-rated,red'), noProducts, "ZWG");
    expect(quoted.rows[0].value).toMatchObject({ sku: "N1", name: "Nails", priceCents: 125000, taxCode: "zero_rated", unit: "each" });
    expect(quoted.ignored).toEqual(["Colour"]);
  });

  it("refuses a file without the required columns", () => {
    const check = checkProducts(parseCsv("name,price\nNails,1"), noProducts, "USD");
    expect(check.fileErrors).toEqual([expect.stringContaining('including "code"')]);
    expect(check.rows).toEqual([]);
    expect(checkProducts([], noProducts, "USD").fileErrors[0]).toMatch(/file is empty/);
    expect(checkProducts(parseCsv("code,name,price\n\n"), noProducts, "USD").fileErrors[0]).toMatch(/no rows/);
    expect(checkProducts(parseCsv("code,name,price,sku\nA,B,1,C"), noProducts, "USD").fileErrors[0]).toMatch(/appears twice/);
  });

  it("explains each problem on each row", () => {
    const csv = [
      "code,name,price,vat type,barcode,reorder level,opening quantity,unit cost",
      "OLD-1,Old thing,1.00,standard,,,,", // exists already
      "A1,Thing,abc,standard,,,,",
      "A2,,-3,luxury,,lots,,",
      "a1,Duplicate code,2,exempt,,,,",
      "B1,Barcoded,2,,600111,,,",
      "B2,Barcoded again,2,,600111,,,",
      "B3,Existing barcode,2,,600999,,,",
      "Q1,Opening without cost,2,,,,5,",
      "Q2,Bad quantity,2,,,,1.2345,x",
      "Q3,Zero opening,2,,,,0,",
      ",,,,,,,", // blank row: skipped
    ].join("\n");
    const check = checkProducts(parseCsv(csv), { skus: new Set(["old-1"]), barcodes: new Set(["600999"]) }, "USD");
    const errors = Object.fromEntries(check.rows.map((r) => [r.row, r.errors]));
    expect(errors[2]).toEqual(["A product with the code OLD-1 already exists."]);
    expect(errors[3]).toEqual(['The price "abc" is not a valid amount. Write it like 12.50.']);
    expect(errors[4]).toEqual([
      "The name is missing.",
      'The price "-3" is not a valid amount. Write it like 12.50.',
      'The VAT type "luxury" is not known. Use standard, zero-rated or exempt.',
      'The reorder level "lots" is not a valid quantity.',
    ]);
    expect(errors[5]).toEqual(["The code a1 is also used on row 3."]);
    expect(errors[6]).toEqual([]);
    expect(errors[7]).toEqual(["The barcode 600111 is also used on row 6."]);
    expect(errors[8]).toEqual(["Another product already has the barcode 600999."]);
    expect(errors[9]).toEqual(["Give the unit cost (in USD) of the opening stock, so stock is valued correctly."]);
    expect(errors[10]).toEqual([
      'The opening quantity "1.2345" is not a valid quantity.',
      'The unit cost "x" is not a valid amount. Write it like 9.80.',
    ]);
    expect(errors[11]).toEqual([]);
    expect(check.rows.find((r) => r.row === 11)?.value?.openingQty).toBeNull();
    expect(check.rows).toHaveLength(10);
    expect(check.errorRows).toBe(8);
  });

  it("accepts prices with a dollar sign and quantities with thousands separators", () => {
    const check = checkProducts(parseCsv('code,name,price,opening quantity,unit cost\nP,Paint,$15.5,"1,200",US$ 7'), noProducts, "USD");
    expect(check.rows[0].value).toMatchObject({ priceCents: 1550, openingQty: "1200", unitCostCents: 700 });
  });
});

describe("customer import checks", () => {
  it("accepts the template as it is", () => {
    const check = checkCustomers(parseCsv(templateCsv("customers", "ZWG")), noCustomers, "ZWG");
    expect(check.errorRows).toBe(0);
    expect(check.rows.map((r) => r.value)).toEqual([
      { name: "Tendai Moyo", companyName: null, phone: "077 123 4567", whatsapp: null, email: "tendai@example.com", currency: "ZWG" },
      { name: "Rudo Chikore", companyName: "Chikore Builders", phone: "+263 71 234 5678", whatsapp: "+263 71 234 5678", email: null, currency: "USD" },
    ]);
  });

  it("finds duplicates by email and phone, in the file and already saved", () => {
    const csv = [
      "name,business name,phone,email,currency",
      "Tendai,,0771234567,t@x.co,",
      "Tendai again,,+263 77 123 4567,,",
      "Rudo,,,T@X.CO,",
      "Farai,,0712000000,,usd",
      "Old,,,old@x.co,",
      ",Builders Ltd,,,ZiG",
      ",,,,", // blank
      "Bad,,12ab,nope,EUR",
    ].join("\r\n");
    const check = checkCustomers(parseCsv(csv), { emails: new Set(["old@x.co"]), phoneKeys: new Set(["712000000"]) }, "USD");
    const errors = Object.fromEntries(check.rows.map((r) => [r.row, r.errors]));
    expect(errors[2]).toEqual([]);
    expect(errors[3]).toEqual(["The phone number +263 77 123 4567 is also used on row 2."]);
    expect(errors[4]).toEqual(["The email t@x.co is also used on row 2."]);
    expect(errors[5]).toEqual(["A customer with the phone number 0712000000 already exists."]);
    expect(errors[6]).toEqual(["A customer with the email old@x.co already exists."]);
    expect(errors[7]).toEqual([]);
    expect(check.rows.find((r) => r.row === 7)?.value).toMatchObject({ name: "Builders Ltd", companyName: "Builders Ltd", currency: "ZWG" });
    expect(errors[9]).toEqual([
      'The email address "nope" does not look right.',
      'The phone number "12ab" looks too short or has letters in it.',
      'The currency "EUR" is not known. Use USD, ZiG or ZAR.',
    ]);
  });

  it("needs a name column", () => {
    expect(checkCustomers(parseCsv("phone\n0771234567"), noCustomers, "USD").fileErrors[0]).toMatch(/including "name"/);
  });
});

describe("value readers", () => {
  it("reads VAT types, currencies and phone keys", () => {
    expect(parseTaxCode("")).toBe("standard");
    expect(parseTaxCode("Standard VAT")).toBe("standard");
    expect(parseTaxCode("zero_rated")).toBe("zero_rated");
    expect(parseTaxCode("Zero rated")).toBe("zero_rated");
    expect(parseTaxCode("EXEMPT")).toBe("exempt");
    expect(parseTaxCode("15%")).toBeNull();
    expect(parseCurrency("zig")).toBe("ZWG");
    expect(parseCurrency("ZWG")).toBe("ZWG");
    expect(parseCurrency("rand")).toBe("ZAR");
    expect(parseCurrency("GBP")).toBeNull();
    expect(phoneKey("+263 77 123 4567")).toBe("771234567");
    expect(phoneKey("0771234567")).toBe("771234567");
    expect(phoneKey("")).toBeNull();
  });
});
