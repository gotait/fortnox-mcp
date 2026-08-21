/**
 * Numeric coercion for Fortnox payloads.
 *
 * Fortnox does not type its money consistently across resources. The published
 * spec declares `Total`, `Balance`, `VAT`, `Freight`, `RoundOffValue`,
 * `AdministrationFee` and `CurrencyRate` as **strings** on the supplier-invoice
 * schemas (`fortnox_SupplierInvoice`, `fortnox_SupplierInvoiceListItem`) while
 * declaring the same logical fields as `double` on `fortnox_Invoice`,
 * `fortnox_Order` and `fortnox_Offer`. Row-level amounts are numbers even on
 * supplier invoices. `DeliveredQuantity` is a string on every invoice/order/
 * offer/contract row schema in the file.
 *
 * That divergence is the same one that produced the `DatabaseNumber` bug: an
 * output schema said `string`, the endpoint sent an int32, and the SDK rejected
 * the response. Untyped arithmetic on a string field fails worse than a
 * validation error — `0 + "1500" + "200"` is `"01500200"`, and a subtraction
 * downstream turns that into NaN, so a report returns confident nonsense.
 *
 * We cannot verify which reading the live API follows without a live token, and
 * we do not need to: coercing on read is correct under both. Use toNumber() at
 * every boundary where a Fortnox amount enters arithmetic or a `z.number()`
 * output field.
 */

/**
 * Coerce a Fortnox numeric field to a number.
 *
 * Accepts the number the field may already be, the decimal string the spec says
 * it is, or nothing at all. Returns `fallback` for null/undefined/empty and for
 * anything that does not parse, so the result is always finite — never NaN,
 * which `z.number()` rejects and which silently poisons every sum it reaches.
 */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    // Fortnox sends "1234.50"; tolerate the decimal comma and thin/plain
    // spaces of a Swedish-formatted figure in case a field ever arrives that way.
    const normalised = value.trim().replace(/[\s  ]/g, "").replace(",", ".");
    if (normalised === "") return fallback;
    const parsed = Number(normalised);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** A Fortnox amount as it may actually arrive on the wire. */
export type FortnoxNumeric = number | string | undefined | null;
