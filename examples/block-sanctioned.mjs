// Felt-risk demo: safe-pay refuses to pay a sanctioned recipient.
//
// An AI agent is about to send USDC to a Tornado Cash address (OFAC SDN).
// guardedSend screens the recipient first and FAILS CLOSED — the send thunk
// never runs, the funds stay put.
//
//   node examples/block-sanctioned.mjs                 # free, simulated verdict
//   PRIVATE_KEY=0x... node examples/block-sanctioned.mjs   # live $0.02 real screen
//
// The address below is a real OFAC-SDN Tornado Cash router (sanctioned Aug 2022).
import { guardedSend, ScreenBlockedError } from "anchor-x402-safe-pay";

const SANCTIONED = "0x8589427373D6D84E98730D7795D8f6f8731FDA16";

// Your x402-capable fetch. With a funded Base key this hits the live $0.02
// /v1/screen; without one, we return the *documented* block verdict for this
// address so the demo runs free and still shows the exact fail-closed path.
let paidFetch;
if (process.env.PRIVATE_KEY) {
  const { createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { base } = await import("viem/chains");
  const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
  const { ExactEvmScheme } = await import("@x402/evm");
  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain: base, transport: http() });
  const signer = { address: account.address, signTypedData: (m) => wallet.signTypedData({ account, ...m }) };
  paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(signer) }],
  });
  console.log("mode: LIVE — paying $0.02 for a real anchor-x402 screen\n");
} else {
  paidFetch = async () =>
    new Response(
      JSON.stringify({
        wallet: SANCTIONED,
        recommendation: "block",
        risk_score: 90,
        sanctions_match: true,
        sanctioned_lists: ["OFAC SDN", "Tornado Cash"],
        signals: [{ type: "sanctions", severity: "critical", detail: "On a sanctions list" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  console.log("mode: SIMULATED (set PRIVATE_KEY for a live $0.02 check)\n");
}

let sent = false;
try {
  await guardedSend(
    SANCTIONED,
    () => {
      sent = true; // the real USDC transfer — must never run here
      return "0xreal_usdc_transfer_hash";
    },
    { fetchImpl: paidFetch },
  );
  console.log("⚠️  payment went through — this should NOT happen for a sanctioned address");
  process.exitCode = 1;
} catch (e) {
  if (e instanceof ScreenBlockedError) {
    console.log(`🛑 BLOCKED before send — recipient ${SANCTIONED}`);
    console.log(`   recommendation : ${e.verdict.recommendation}`);
    console.log(`   risk_score     : ${e.verdict.risk_score}`);
    console.log(`   lists          : ${(e.verdict.sanctioned_lists || []).join(", ")}`);
    console.log(`   send thunk ran : ${sent}   → funds safe`);
  } else {
    throw e;
  }
}
