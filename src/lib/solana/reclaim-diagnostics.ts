export type ReclaimDiagnosticsMode =
  | { mode: "normal" }
  | { mode: "invalid" }
  | { mode: "diagnostic"; options: { signerTransactionLimit: number; noSubmit: true } };

export function parseReclaimDiagnostics(search: string): ReclaimDiagnosticsMode {
  const values = new URLSearchParams(search).getAll("rbDiagSignLimit");
  if (values.length === 0) return { mode: "normal" };
  if (values.length !== 1 || !["1", "2", "6"].includes(values[0])) return { mode: "invalid" };
  return { mode: "diagnostic", options: { signerTransactionLimit: Number(values[0]), noSubmit: true } };
}
