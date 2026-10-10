import { StripeApiError, stripeRequest } from "./stripe";

/**
 * What Stripe says about the customer id stored on an agency row:
 *   - "ours": it exists and was made for this agency;
 *   - "gone": Stripe has no such customer, or it was deleted;
 *   - "not-ours": it exists, but was made for some other agency, or by hand.
 */
export type StoredCustomer = "ours" | "gone" | "not-ours";

/**
 * Asked before a stored customer id is used for checkout or the billing
 * portal (10 Oct 2026).
 *
 * "gone" is a sandbox id left behind once the keys are live, or a duplicate
 * cleaned out of the Stripe dashboard. Since 0060 records the id at the first
 * checkout, including one that was abandoned, such an id would otherwise stay
 * on the row and fail every checkout after it with "No such customer".
 *
 * "not-ours" is the one that matters. Every member of an office can read the
 * agency's customer id, so the row is not proof of whose customer it is. Every
 * customer this app makes carries the agency's id in its metadata
 * (createCustomer in lib/actions/billing.ts, since 2 Sep 2026), and Stripe is
 * the one place nobody but us can write it. A billing page is never opened on
 * a customer whose metadata names another agency.
 *
 * Any other refusal from Stripe is thrown, for the caller's existing handling.
 */
export async function checkStoredCustomer(customerId: string, agencyId: string): Promise<StoredCustomer> {
  let customer: { deleted?: boolean; metadata?: Record<string, string> | null };
  try {
    customer = await stripeRequest("GET", `/customers/${encodeURIComponent(customerId)}`);
  } catch (e) {
    if (e instanceof StripeApiError && e.code === "resource_missing") return "gone";
    throw e;
  }
  if (customer.deleted) return "gone";
  return customer.metadata?.agency_id === agencyId ? "ours" : "not-ours";
}
