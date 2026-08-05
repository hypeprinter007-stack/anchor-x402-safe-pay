# Register safe-pay on the OFFICIAL python x402 client's pre-pay hook.
#
# The client calls `on_before_payment_creation(req)` before signing; `req.pay_to`
# is the recipient. Return an abort decision to block (shape per the client's
# hook contract; abort/continue below is illustrative).
#
# Reference snippet — `paid_post(url, json_body) -> dict` is your x402-capable POST.
from anchor_safe_pay import screen_allows


def on_before_payment_creation(req):
    ok, verdict = screen_allows(req.pay_to, fetch=paid_post)
    if not ok:
        return {"abort": True, "reason": f"recipient {verdict['recommendation']}"}
    return None  # continue
