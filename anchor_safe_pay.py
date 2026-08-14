"""anchor-x402-safe-pay — screen a recipient before an agent sends funds.

The embed: instead of being a catalog endpoint an agent has to choose, wrap the
payment the agent already makes. `guarded_send` screens the recipient via
anchor-x402 (/v1/screen) and only runs your send on `allow`.

Wallet-agnostic by design: you pass your own send as a callable, so this works
with web3.py, an x402 client, a Solana signer — anything.
"""
from __future__ import annotations

import json
import urllib.request
from typing import Any, Callable

DEFAULT_ENDPOINT = "https://api.anchor-x402.com/v1/screen"
VALID_RECOMMENDATIONS = frozenset({"allow", "review", "block"})


class ScreenBlocked(Exception):
    """Raised when the verdict refuses the send. Carries the full verdict."""

    def __init__(self, verdict: dict):
        self.verdict = verdict
        rec = verdict.get("recommendation")
        risk = verdict.get("risk_score")
        risk_txt = f" (risk {risk})" if risk is not None else ""
        super().__init__(
            f"anchor-x402: send blocked — recommendation={rec}{risk_txt} for {verdict.get('wallet')}"
        )


def screen(
    address: str,
    *,
    fetch: Callable[[str, dict], dict] | None = None,
    endpoint: str = DEFAULT_ENDPOINT,
    timeout: float = 4.0,
) -> dict:
    """Return the anchor-x402 risk verdict for `address`.

    `/v1/screen` is a paid x402 route ($0.02). Pass `fetch(url, json_body) -> dict`,
    an x402-capable POST that settles the call. Without it, this does a plain
    urllib POST that will get a 402 and raise.
    """
    if fetch is not None:
        return fetch(endpoint, {"wallet": address})
    req = urllib.request.Request(
        endpoint,
        data=json.dumps({"wallet": address}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (fixed host)
        return json.loads(resp.read())


def screen_allows(
    recipient: str,
    *,
    block_on: tuple[str, ...] = ("block", "review"),
    on_error: str = "block",
    **screen_kwargs: Any,
) -> tuple[bool, dict]:
    """Screen `recipient` and return a decision — no raise, no send. The building
    block for registering on a client's existing pre-pay hook (e.g.
    `on_before_payment_creation`): call with the x402 `pay_to` and map the bool.

    block_on : recommendations that mean "don't pay". Default ("block", "review").
    on_error : "block" (default) or "allow" — decision if the screen call fails.
    Returns (ok, verdict); ok=True ⇒ safe to pay.
    """
    try:
        verdict = screen(recipient, **screen_kwargs)
        if not isinstance(verdict, dict):
            raise ValueError("invalid screen response: expected a dictionary")
        recommendation = verdict.get("recommendation")
        if not isinstance(recommendation, str) or recommendation not in VALID_RECOMMENDATIONS:
            if "recommendation" not in verdict:
                detail = "missing recommendation"
            elif isinstance(recommendation, str):
                detail = f"unknown recommendation {recommendation[:64]!r}"
            else:
                detail = (
                    "recommendation must be a string "
                    f"(received {type(recommendation).__name__})"
                )
            raise ValueError(f"invalid screen response: {detail}")
        return (verdict.get("recommendation") not in block_on, verdict)
    except Exception as err:  # noqa: BLE001 — any screen failure is a policy decision
        return (
            on_error == "allow",
            {"wallet": recipient, "recommendation": "error", "risk_score": None,
             "notes": f"screen failed: {err}"},
        )


def guarded_send(
    recipient: str,
    send: Callable[[], Any],
    *,
    block_on: tuple[str, ...] = ("block", "review"),
    on_error: str = "block",
    **screen_kwargs: Any,
) -> Any:
    """Screen `recipient`, then run `send()` only if the verdict permits. The
    wrap-your-own-send model; to register on a client's existing hook, use
    `screen_allows` instead. Returns `send()`'s result; raises ScreenBlocked otherwise.
    """
    ok, verdict = screen_allows(recipient, block_on=block_on, on_error=on_error, **screen_kwargs)
    if not ok:
        raise ScreenBlocked(verdict)
    return send()
