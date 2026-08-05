// Offline tests: node index.test.mjs
import assert from "node:assert";
import { guardedSend, screen, ScreenBlockedError } from "./index.js";

let fails = 0;
const ok = (name, fn) =>
  fn().then(
    () => console.log(`  PASS  ${name}`),
    (e) => {
      fails++;
      console.log(`  FAIL  ${name} — ${e.message}`);
    },
  );

// A fake x402 fetch that returns a fixed verdict, or throws (screen failure).
const fetchReturning = (verdict) => async () => ({ ok: true, json: async () => verdict });
const fetchFailing = () => async () => ({ ok: false, status: 402 });

const RECIPIENT = "0x1111111111111111111111111111111111111111";
let sent; // set by the send thunk so we can assert it ran (or didn't)
const send = () => {
  sent = true;
  return "tx-hash";
};

const run = async () => {
  await ok("allow → send runs, returns the send result", async () => {
    sent = false;
    const r = await guardedSend(RECIPIENT, send, { fetchImpl: fetchReturning({ recommendation: "allow", risk_score: 0, wallet: RECIPIENT }) });
    assert.equal(sent, true);
    assert.equal(r, "tx-hash");
  });

  await ok("block → throws ScreenBlockedError, send does NOT run", async () => {
    sent = false;
    await assert.rejects(
      () => guardedSend(RECIPIENT, send, { fetchImpl: fetchReturning({ recommendation: "block", risk_score: 100, wallet: RECIPIENT }) }),
      (e) => e instanceof ScreenBlockedError && e.verdict.recommendation === "block",
    );
    assert.equal(sent, false);
  });

  await ok("review → holds by default (fail-closed), send does NOT run", async () => {
    sent = false;
    await assert.rejects(
      () => guardedSend(RECIPIENT, send, { fetchImpl: fetchReturning({ recommendation: "review", risk_score: 40, wallet: RECIPIENT }) }),
      (e) => e instanceof ScreenBlockedError && e.verdict.recommendation === "review",
    );
    assert.equal(sent, false);
  });

  await ok("review + blockOn:['block'] → send runs (caller opted to proceed on review)", async () => {
    sent = false;
    await guardedSend(RECIPIENT, send, { blockOn: ["block"], fetchImpl: fetchReturning({ recommendation: "review", risk_score: 40, wallet: RECIPIENT }) });
    assert.equal(sent, true);
  });

  await ok("screen error + onError:'block' (default) → throws, send does NOT run", async () => {
    sent = false;
    await assert.rejects(
      () => guardedSend(RECIPIENT, send, { fetchImpl: fetchFailing() }),
      (e) => e instanceof ScreenBlockedError && e.verdict.recommendation === "error",
    );
    assert.equal(sent, false);
  });

  await ok("screen error + onError:'allow' → send runs (fail-open opt-in)", async () => {
    sent = false;
    const r = await guardedSend(RECIPIENT, send, { onError: "allow", fetchImpl: fetchFailing() });
    assert.equal(sent, true);
    assert.equal(r, "tx-hash");
  });

  await ok("screen() surfaces the raw verdict for callers who branch themselves", async () => {
    const v = await screen(RECIPIENT, { fetchImpl: fetchReturning({ recommendation: "allow", risk_score: 3, wallet: RECIPIENT }) });
    assert.equal(v.recommendation, "allow");
    assert.equal(v.risk_score, 3);
  });

  console.log(fails ? `\n${fails} FAILED` : "\nall safe-pay (js) checks OK");
  if (fails) process.exit(1);
};
run();
