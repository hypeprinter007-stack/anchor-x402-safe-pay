# anchor-x402-safe-pay

**Screen a recipient before your agent sends funds.** A one-line, wallet-agnostic wrapper that runs an [anchor-x402](https://anchor-x402.com) risk pre-flight (`allow` / `review` / `block`) on the counterparty and only lets the payment through if it's clean.

It wraps the payment your agent *already makes* — you don't call a new "service", you decorate your send. Works with viem, ethers, x402-fetch, a Solana signer, anything: you pass your own send as a thunk.

## Why

Autonomous agents move USDC without a human watching the recipient. `safe-pay` puts a sanctions + address-reputation check (drainer / phishing / mixer) in the send path, so a payment to a flagged address fails closed instead of draining a wallet.

## Install

```bash
npm install anchor-x402-safe-pay      # or: pip install anchor-x402-safe-pay
```

## Use — JavaScript / TypeScript

```js
import { guardedSend } from "anchor-x402-safe-pay";

// `paidFetch` is your x402-capable fetch (e.g. from @x402/fetch's
// wrapFetchWithPayment) — it settles the $0.02 screen call for you.
await guardedSend(
  recipient,
  () => wallet.sendUsdc(recipient, amount),   // your real send, runs only if allowed
  { fetchImpl: paidFetch },
);
```

If the recipient is flagged, `guardedSend` throws `ScreenBlockedError` (carrying the full verdict) and your send never runs.

## Use — Python

```python
from anchor_safe_pay import guarded_send

# `paid_post(url, json_body) -> dict` is your x402-capable POST (pays the $0.02).
guarded_send(
    recipient,
    lambda: wallet.send_usdc(recipient, amount),   # runs only if allowed
    fetch=paid_post,
)
```

## Register on your client's existing pre-pay hook

Most x402 clients already expose a hook that fires with the recipient (`payTo`) **before** signing — you don't need the wrapper, just a decision. `screenAllows()` is that decision (never throws; folds `blockOn`/`onError` so the hook stays a one-liner). Full snippets in [`examples/`](./examples):

**Official `@x402` client** (`beforePaymentCreation`):
```js
x402Client.onBeforePaymentCreation(async (req) => {
  const { ok, verdict } = await screenAllows(req.payTo, { fetchImpl: paidFetch });
  return ok ? undefined : { abort: true, reason: verdict.recommendation };
});
```

**elizaOS plugin-wallet** (`onBeforePayment` → return `false` to block):
```js
const onBeforePayment = async (req) => (await screenAllows(req.payTo, { fetchImpl: paidFetch })).ok;
```

**faremeter** (`payerChooser` → throw to abort), **qntx/r402** (`before_payment_creation`), and the **Python** client (`on_before_payment_creation`) take the same shape — see [`examples/`](./examples). Use `paidFetch` *other* than the client you're guarding, so screening a payment never recurses.

## Verdict → action

`/v1/screen` returns a `recommendation` you branch on:

| recommendation | meaning | default |
|---|---|---|
| `allow` | clean | send runs |
| `review` | needs a human (elevated risk) | **held** (fail-closed) |
| `block` | sanctioned / drainer / phishing | **held** |

By default `blockOn: ["block", "review"]` — a `review` holds. To send on `review` (e.g. you have your own human-in-the-loop), set `blockOn: ["block"]` and inspect the thrown verdict:

```js
try {
  await guardedSend(recipient, send, { blockOn: ["block"], fetchImpl: paidFetch });
} catch (e) {
  if (e.verdict.recommendation === "review") await askAHuman(e.verdict);
  else throw e; // hard block
}
```

## Options

- `fetchImpl` (JS) / `fetch` (Py) — **required for real use**: your x402-capable fetch/POST, so the `$0.02` screen call settles. Without it you'll get a 402.
- `blockOn` — recommendations that refuse the send. Default `["block", "review"]`.
- `onError` — what to do if the screen call itself fails (network / 402 / anchor down): `"block"` (default — a safety guard fails safe) or `"allow"` (anchor downtime never blocks your payments). Choose deliberately.
- `timeoutMs` / `timeout`, `endpoint` — overridable.

Need the raw verdict without the send? Call `screen(address, { fetchImpl })` directly.

## Cost

Each guarded send makes one `$0.02` USDC `/v1/screen` call on Base — cheap insurance against a drained payment. The screen degrades to a `partial` verdict rather than erroring if the reputation layer is briefly unavailable.

MIT.
