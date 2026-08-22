// anchor-x402-safe-pay — screen a recipient before an agent sends funds.
//
// The embed: instead of being a catalog endpoint an agent has to choose,
// wrap the payment the agent already makes. `guardedSend` screens the
// recipient via anchor-x402 (/v1/screen) and only runs your send on `allow`.
//
// Wallet-agnostic by design: you pass your own send as a thunk, so this
// works with viem, ethers, x402-fetch, a Solana signer — anything.

const DEFAULT_ENDPOINT = "https://api.anchor-x402.com/v1/screen";
const VALID_RECOMMENDATIONS = new Set(["allow", "review", "block"]);

export class ScreenBlockedError extends Error {
  constructor(verdict) {
    super(
      `anchor-x402: send blocked — recommendation=${verdict.recommendation}` +
        (verdict.risk_score != null ? ` (risk ${verdict.risk_score})` : "") +
        ` for ${verdict.wallet}`,
    );
    this.name = "ScreenBlockedError";
    this.verdict = verdict; // full verdict: recommendation, risk_score, signals, notes, partial …
  }
}

/**
 * Fetch the anchor-x402 risk verdict for an address.
 *
 * `/v1/screen` is a paid x402 route ($0.02), so pass your x402-capable fetch
 * as `fetchImpl` (e.g. the fetch from @x402/fetch's wrapFetchWithPayment) —
 * it settles the call transparently. Plain fetch will get a 402 and throw.
 *
 * @returns {Promise<object>} { recommendation, risk_score, signals, sanctions_match, address_type, partial, notes, … }
 */
export async function screen(address, opts = {}) {
  const { fetchImpl = globalThis.fetch, endpoint = DEFAULT_ENDPOINT, timeoutMs = 4000 } = opts;
  if (typeof fetchImpl !== "function") {
    throw new Error("safe-pay: no fetch available — pass opts.fetchImpl (your x402-capable fetch)");
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: address }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`screen HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Screen `recipient` and return a decision — no throw, no send. The building
 * block for registering on a client's existing pre-pay hook (`beforePayment
 * Creation`, `onBeforePayment`, `payerChooser`, …): call it with the x402
 * `payTo` and map `.ok` to whatever the hook expects (a boolean, an `{abort}`,
 * or a throw). See the examples/ directory.
 *
 * @param {object} [opts]
 *   blockOn  {string[]}  recommendations that mean "don't pay". Default ["block","review"].
 *   onError  {"block"|"allow"}  decision if the screen call itself fails. Default "block".
 *   plus any `screen` opts (fetchImpl, endpoint, timeoutMs).
 * @returns {Promise<{ok: boolean, verdict: object}>} ok=true ⇒ safe to pay.
 */
export async function screenAllows(recipient, opts = {}) {
  const { blockOn = ["block", "review"], onError = "block", ...screenOpts } = opts;
  try {
    const verdict = await screen(recipient, screenOpts);
    if (verdict === null || typeof verdict !== "object" || Array.isArray(verdict)) {
      throw new Error("invalid screen response: expected an object");
    }
    const recommendation = verdict.recommendation;
    if (!VALID_RECOMMENDATIONS.has(recommendation)) {
      const detail =
        recommendation === undefined
          ? "missing recommendation"
          : typeof recommendation === "string"
            ? `unknown recommendation ${JSON.stringify(recommendation.slice(0, 64))}`
            : `recommendation must be a string (received ${recommendation === null ? "null" : typeof recommendation})`;
      throw new Error(`invalid screen response: ${detail}`);
    }
    return { ok: !blockOn.includes(verdict.recommendation), verdict };
  } catch (err) {
    return {
      ok: onError === "allow",
      verdict: {
        wallet: recipient,
        recommendation: "error",
        risk_score: null,
        notes: `screen failed: ${err && err.message ? err.message : String(err)}`,
      },
    };
  }
}

/**
 * Screen `recipient`, then run `send()` only if the verdict permits. The
 * wrap-your-own-send model; for registering on a client's existing hook, use
 * `screenAllows` instead. Same options as `screenAllows`.
 * @returns whatever `send()` returns. Throws ScreenBlockedError otherwise.
 */
export async function guardedSend(recipient, send, opts = {}) {
  const { ok, verdict } = await screenAllows(recipient, opts);
  if (!ok) throw new ScreenBlockedError(verdict);
  return await send();
}

/**
 * Compose recipient screening with a stateless per-send amount cap, for use at
 * a client's pre-payment hook — the seat where the real 402 challenge `amount`
 * and `payTo` are both known at send time (matches the `beforePayment` context
 * in coinbase/agentkit#1454). This closes a TOCTOU a plan-time cap can't: with
 * x402 the amount is payee-set in the 402, so a cap checked when the agent
 * *plans* the call can be bypassed by a challenge-time bump — the hook sees the
 * amount that will actually be paid.
 *
 * Stateless by design: no budget/rate engine (cumulative windows belong in the
 * wallet/agent layer). Fail-closed — a flagged recipient, an over-cap amount,
 * or a screen failure all abort; the recipient verdict wins (a flagged payee
 * aborts even under cap). `maxAmount` is the maximum *allowed* (atomic units),
 * so paying exactly the cap is permitted; strictly-greater aborts.
 *
 * @param {object} opts
 *   maxAmount {string|bigint|number}  cap in the asset's atomic units (required).
 *   plus any `screenAllows` opts (blockOn, onError, fetchImpl, endpoint, timeoutMs).
 * @returns {(ctx: {payTo: string, amount: string|bigint|number}) => Promise<{abort: boolean, reason?: "flagged_recipient"|"exceeds_cap", verdict: object, amount?: string, cap?: string}>}
 *   A hook callback: `{abort:false}` ⇒ pay; `{abort:true, reason}` ⇒ refuse.
 */
export function composeCapWithScreen(opts = {}) {
  const { maxAmount, ...screenOpts } = opts;
  if (maxAmount === undefined || maxAmount === null) {
    throw new Error("safe-pay: composeCapWithScreen requires opts.maxAmount");
  }
  const max = BigInt(maxAmount);
  return async ({ payTo, amount }) => {
    const { ok, verdict } = await screenAllows(payTo, screenOpts);
    if (!ok) return { abort: true, reason: "flagged_recipient", verdict };
    if (BigInt(amount) > max) {
      return { abort: true, reason: "exceeds_cap", amount: String(amount), cap: String(max), verdict };
    }
    return { abort: false, verdict };
  };
}
