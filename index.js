// anchor-x402-safe-pay — screen a recipient before an agent sends funds.
//
// The embed: instead of being a catalog endpoint an agent has to choose,
// wrap the payment the agent already makes. `guardedSend` screens the
// recipient via anchor-x402 (/v1/screen) and only runs your send on `allow`.
//
// Wallet-agnostic by design: you pass your own send as a thunk, so this
// works with viem, ethers, x402-fetch, a Solana signer — anything.

const DEFAULT_ENDPOINT = "https://api.anchor-x402.com/v1/screen";

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
 * Screen `recipient`, then run `send()` only if the verdict permits.
 *
 * @param {string} recipient  EVM 0x… or Solana base58 address you're about to pay.
 * @param {() => any} send     Your actual send (sync or async). Runs only when allowed.
 * @param {object} [opts]
 *   blockOn  {string[]}  recommendations that refuse the send. Default ["block","review"]
 *                        (fail-closed: a `review` verdict needs a human, so it holds by default).
 *   onError  {"block"|"allow"}  what to do if the screen call itself fails (network / 402 /
 *                        anchor down). Default "block" — a safety guard fails safe. Set "allow"
 *                        if you'd rather anchor downtime never blocks your payments.
 *   plus any `screen` opts (fetchImpl, endpoint, timeoutMs).
 * @returns whatever `send()` returns. Throws ScreenBlockedError otherwise.
 */
export async function guardedSend(recipient, send, opts = {}) {
  const { blockOn = ["block", "review"], onError = "block", ...screenOpts } = opts;
  let verdict;
  try {
    verdict = await screen(recipient, screenOpts);
  } catch (err) {
    if (onError === "allow") return await send();
    const blocked = new ScreenBlockedError({
      wallet: recipient,
      recommendation: "error",
      risk_score: null,
      notes: `screen failed: ${err && err.message ? err.message : String(err)}`,
    });
    blocked.cause = err;
    throw blocked;
  }
  if (blockOn.includes(verdict.recommendation)) {
    throw new ScreenBlockedError(verdict);
  }
  return await send();
}
