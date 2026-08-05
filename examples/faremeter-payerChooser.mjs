// Register safe-pay via faremeter's `payerChooser`.
//
// faremeter runs `payerChooser(possiblePayers)` immediately before `.exec()`
// signs. A chooser can inspect the recipient (`payer.requirements.payTo`) and
// throw to abort — no signature is produced.
//
// Reference snippet — pass as the `payerChooser` wrap option.
import { screenAllows } from "anchor-x402-safe-pay";

export const payerChooser = async (execers) => {
  const chosen = execers[0]; // your normal selection logic
  const { ok, verdict } = await screenAllows(chosen.requirements.payTo, { fetchImpl: paidFetch });
  if (!ok) throw new Error(`safe-pay: recipient ${verdict.recommendation} (risk ${verdict.risk_score})`);
  return chosen;
};
