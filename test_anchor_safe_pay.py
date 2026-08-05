"""Offline tests: python3 test_anchor_safe_pay.py"""
import sys

from anchor_safe_pay import ScreenBlocked, guarded_send, screen, screen_allows

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

print(f"\n{_fails} FAILED" if _fails else "\nall safe-pay (python) checks OK")
sys.exit(1 if _fails else 0)
