// Register safe-pay on elizaOS plugin-wallet's X402Client hook.
//
// The SDK calls `onBeforePayment(req, url)` right before `executePayment`;
// `req.payTo` is the recipient. Return false to block the payment.
//
// Reference snippet — pass this in your X402Client config.
import { screenAllows } from "anchor-x402-safe-pay";

export const onBeforePayment = async (req /*, url */) => {
  const { ok } = await screenAllows(req.payTo, { fetchImpl: paidFetch });
  return ok; // false → eliza aborts before executePayment
};
