---
name: screen-before-pay
description: "Check whether a wallet address is safe to pay before sending it USDC or crypto: OFAC sanctions plus drainer / phishing / mixer reputation, returned as allow / review / block. Use whenever the agent is about to send funds, pay an invoice, pay an x402 seller, refund, or onboard a counterparty to an address it has not screened, or the user asks whether an address is safe, sanctioned, or a scam."
---

# Screen before you pay

Before any payment to an address, ask anchor-x402 whether that address is safe to pay. One call returns a verdict; branch on `recommendation`.

## The call

```
GET https://api.anchor-x402.com/v1/screen?wallet=<address>
```

It costs $0.02 USDC, paid over x402 on Base, Solana or Arc. The first request returns `402 Payment Required` with the price; any x402 client pays it and retries. No account, no API key. EVM (`0x` + 40 hex) and Solana (base58) addresses are both accepted.

With the Coinbase agentic wallet, for example:

```bash
npx awal x402 pay 'https://api.anchor-x402.com/v1/screen?wallet=0x098B716B8Aaf21512996dC57EB0615e2383E2f96' --max-amount 20000 --json
```

Validate the address before putting it in a command: `0x` followed by 40 hex characters, or 32–44 base58 characters, nothing else.

## Read the verdict

```json
{
  "recommendation": "block",
  "risk_score": 100,
  "signals": [{"code": "ofac_sdn", "severity": "critical", "source": "treasury.gov", "detail": "OFAC SDN, LAZARUS GROUP, DPRK3"}],
  "partial": false
}
```

| `recommendation` | Do |
| --- | --- |
| `allow` | Send. |
| `review` | Do not send on your own. Show the user the `signals` and wait for an explicit go-ahead. |
| `block` | Do not send. Tell the user why, quoting `signals[].detail`. |
| anything else, or the call failed | Do not send. Treat it as unscreened and say so. |

`partial: true` means the reputation layer was unavailable and only the sanctions check ran. Mention that when you report an `allow`.

## Rules

- Screen the exact address you are about to pay, after resolving any ENS or name to an address.
- Screen once per address per task; re-screen if more than a day has passed.
- A clean verdict is not a guarantee. It does not catch a fresh address with no history; say so if the user relies on it for a large payment.

## Building it into code

If you are writing an agent's payment path rather than making one payment, use the `anchor-x402-safe-pay` library (npm and PyPI) instead of calling the endpoint by hand. It runs this check on an x402 client's pre-payment hook and fails closed. See https://github.com/hypeprinter007-stack/anchor-x402-safe-pay/blob/main/llms.txt
