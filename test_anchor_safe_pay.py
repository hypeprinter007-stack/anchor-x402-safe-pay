"""Offline tests: python3 test_anchor_safe_pay.py"""
import sys

from anchor_safe_pay import ScreenBlocked, compose_cap_with_screen, guarded_send, screen, screen_allows

RECIPIENT = "0x1111111111111111111111111111111111111111"
_fails = 0


def ok(name, cond):
    global _fails
    if cond:
        print(f"  PASS  {name}")
    else:
        _fails += 1
        print(f"  FAIL  {name}")


def fetch_returning(verdict):
    return lambda _url, _body: verdict


def fetch_failing():
    def _f(_url, _body):
        raise RuntimeError("HTTP 402")

    return _f


state = {"sent": False}


def send():
    state["sent"] = True
    return "tx-hash"


# allow → send runs, returns result
state["sent"] = False
r = guarded_send(RECIPIENT, send, fetch=fetch_returning({"recommendation": "allow", "risk_score": 0, "wallet": RECIPIENT}))
ok("allow → send runs, returns the send result", state["sent"] and r == "tx-hash")

# block → raises, send does NOT run
state["sent"] = False
try:
    guarded_send(RECIPIENT, send, fetch=fetch_returning({"recommendation": "block", "risk_score": 100, "wallet": RECIPIENT}))
    ok("block → raises ScreenBlocked", False)
except ScreenBlocked as e:
    ok("block → raises ScreenBlocked, send does NOT run", e.verdict["recommendation"] == "block" and not state["sent"])

# review → holds by default
state["sent"] = False
try:
    guarded_send(RECIPIENT, send, fetch=fetch_returning({"recommendation": "review", "risk_score": 40, "wallet": RECIPIENT}))
    ok("review → holds by default", False)
except ScreenBlocked as e:
    ok("review → holds by default (fail-closed), send does NOT run", e.verdict["recommendation"] == "review" and not state["sent"])

# review + block_on=("block",) → send runs
state["sent"] = False
guarded_send(RECIPIENT, send, block_on=("block",), fetch=fetch_returning({"recommendation": "review", "risk_score": 40, "wallet": RECIPIENT}))
ok("review + block_on=('block',) → send runs", state["sent"])

# screen error + on_error='block' (default) → raises, send does NOT run
state["sent"] = False
try:
    guarded_send(RECIPIENT, send, fetch=fetch_failing())
    ok("screen error default → raises", False)
except ScreenBlocked as e:
    ok("screen error + on_error='block' → raises, send does NOT run", e.verdict["recommendation"] == "error" and not state["sent"])

# screen error + on_error='allow' → send runs
state["sent"] = False
r = guarded_send(RECIPIENT, send, on_error="allow", fetch=fetch_failing())
ok("screen error + on_error='allow' → send runs", state["sent"] and r == "tx-hash")

# unknown recommendation → error verdict, send does NOT run
state["sent"] = False
unknown_fetch = fetch_returning({"recommendation": "pending", "wallet": RECIPIENT})
unknown_ok, unknown_v = screen_allows(RECIPIENT, fetch=unknown_fetch)
unknown_decision_is_safe = (
    unknown_ok is False
    and unknown_v["recommendation"] == "error"
    and "invalid screen response: unknown recommendation 'pending'" in unknown_v["notes"]
)
try:
    guarded_send(RECIPIENT, send, fetch=unknown_fetch)
    unknown_send_blocked = False
except ScreenBlocked as e:
    unknown_send_blocked = e.verdict["recommendation"] == "error" and not state["sent"]
ok(
    "unknown recommendation → error verdict, send does NOT run",
    unknown_decision_is_safe and unknown_send_blocked,
)

# missing recommendation → error verdict, send does NOT run
state["sent"] = False
missing_fetch = fetch_returning({"risk_score": 42, "wallet": RECIPIENT})
missing_ok, missing_v = screen_allows(RECIPIENT, fetch=missing_fetch)
missing_decision_is_safe = (
    missing_ok is False
    and missing_v["recommendation"] == "error"
    and "invalid screen response: missing recommendation" in missing_v["notes"]
)
try:
    guarded_send(RECIPIENT, send, fetch=missing_fetch)
    missing_send_blocked = False
except ScreenBlocked as e:
    missing_send_blocked = e.verdict["recommendation"] == "error" and not state["sent"]
ok(
    "missing recommendation → error verdict, send does NOT run",
    missing_decision_is_safe and missing_send_blocked,
)

# non-dictionary verdict → error verdict, send does NOT run
state["sent"] = False
non_dict_fetch = fetch_returning(None)
non_dict_ok, non_dict_v = screen_allows(RECIPIENT, fetch=non_dict_fetch)
try:
    guarded_send(RECIPIENT, send, fetch=non_dict_fetch)
    non_dict_send_blocked = False
except ScreenBlocked as e:
    non_dict_send_blocked = e.verdict["recommendation"] == "error" and not state["sent"]
ok(
    "non-dictionary verdict → error verdict, send does NOT run",
    non_dict_ok is False
    and non_dict_v["recommendation"] == "error"
    and non_dict_send_blocked,
)

# unknown recommendation + on_error='allow' → send runs
state["sent"] = False
r = guarded_send(
    RECIPIENT,
    send,
    on_error="allow",
    fetch=fetch_returning({"recommendation": "pending", "wallet": RECIPIENT}),
)
ok(
    "unknown recommendation + on_error='allow' → send runs",
    state["sent"] and r == "tx-hash",
)

# screen() surfaces the raw verdict
v = screen(RECIPIENT, fetch=fetch_returning({"recommendation": "allow", "risk_score": 3, "wallet": RECIPIENT}))
ok("screen() returns the raw verdict", v["recommendation"] == "allow" and v["risk_score"] == 3)

# screen_allows: decision primitive for hook wiring (no raise)
allow_ok, _ = screen_allows(RECIPIENT, fetch=fetch_returning({"recommendation": "allow", "wallet": RECIPIENT}))
ok("screen_allows: allow -> (True, ...)", allow_ok is True)
block_ok, block_v = screen_allows(RECIPIENT, fetch=fetch_returning({"recommendation": "block", "wallet": RECIPIENT}))
ok("screen_allows: block -> (False, verdict)", block_ok is False and block_v["recommendation"] == "block")
err_ok, err_v = screen_allows(RECIPIENT, fetch=fetch_failing())
ok("screen_allows: screen error default -> (False, error verdict)", err_ok is False and err_v["recommendation"] == "error")
err2_ok, _ = screen_allows(RECIPIENT, on_error="allow", fetch=fetch_failing())
ok("screen_allows: screen error + on_error='allow' -> (True, ...)", err2_ok is True)

# compose_cap_with_screen: per-send amount cap composed with the verdict at the
# pre-payment hook, against the REAL challenge amount (closes the plan-time TOCTOU).
_clean = fetch_returning({"recommendation": "allow", "risk_score": 0, "wallet": RECIPIENT})

gate = compose_cap_with_screen(max_amount="1000000", fetch=_clean)  # $0.01 cap
bump = gate(RECIPIENT, "10000000")  # $0.10 demanded by the 402
ok("cap: challenge-time amount bump over cap -> abort exceeds_cap",
   bump["abort"] is True and bump["reason"] == "exceeds_cap" and bump["amount"] == "10000000" and bump["cap"] == "1000000")

at_cap = gate(RECIPIENT, "1000000")
ok("cap: amount exactly at cap -> allow (inclusive max)", at_cap["abort"] is False)

under = gate(RECIPIENT, "500000")
ok("cap: amount under cap -> allow", under["abort"] is False)

flagged_gate = compose_cap_with_screen(
    max_amount="1000000", fetch=fetch_returning({"recommendation": "block", "risk_score": 100, "wallet": RECIPIENT}))
flagged = flagged_gate(RECIPIENT, "100")
ok("cap: flagged recipient under cap -> abort flagged_recipient (verdict wins)",
   flagged["abort"] is True and flagged["reason"] == "flagged_recipient")

err_gate = compose_cap_with_screen(max_amount="1000000", fetch=fetch_failing())
err_cap = err_gate(RECIPIENT, "100")
ok("cap: screen failure under cap -> abort (on_error default fail-closed)",
   err_cap["abort"] is True and err_cap["reason"] == "flagged_recipient")

allow_err_over = compose_cap_with_screen(max_amount="1000000", on_error="allow", fetch=fetch_failing())
over = allow_err_over(RECIPIENT, "10000000")
ok("cap: on_error='allow' + over-cap -> still aborts on the cap", over["abort"] is True and over["reason"] == "exceeds_cap")

try:
    compose_cap_with_screen(fetch=_clean)  # type: ignore[call-arg]
    _missing_raised = False
except TypeError:
    _missing_raised = True
ok("cap: missing max_amount -> raises (misconfig, not silent no-cap)", _missing_raised)

print(f"\n{_fails} FAILED" if _fails else "\nall safe-pay (python) checks OK")
sys.exit(1 if _fails else 0)
