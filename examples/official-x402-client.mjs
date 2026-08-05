// Register safe-pay on the OFFICIAL @x402 client's pre-pay hook.
//
// `beforePaymentCreation` fires with the selected payment requirements
// (including `payTo`) BEFORE anything is signed; return {abort, reason} to
// block. Works with wrapFetchWithPayment / wrapAxios unchanged.
//
// Reference snippet — assumes you've built `x402Client` and have a paid fetch.
import { screenAllows } from "anchor-x402-safe-pay";

// `paidFetch` is your x402-capable fetch used ONLY to settle the $0.02 screen
// call — keep it separate from the client being guarded so screening a payment
// never recurses into itself.
x402Client.onBeforePaymentCreation(async (req) => {
  const { ok, verdict } = await screenAllows(req.payTo, { fetchImpl: paidFetch });
  return ok
    ? undefined // continue
    : { abort: true, reason: `recipient ${verdict.recommendation} (risk ${verdict.risk_score})` };
});
