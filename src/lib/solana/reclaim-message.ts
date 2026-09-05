import { getCompiledTransactionMessageDecoder, type ReadonlyUint8Array } from "@solana/kit";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS, getSetComputeUnitLimitInstructionDataDecoder, getSetComputeUnitPriceInstructionDataDecoder } from "@solana-program/compute-budget";
import { equalBytes, RECLAIM_PROGRAMS } from "./reclaim";

// Accept MESSAGE bytes only: signatures, wallet/provider objects and wire
// transactions must never enter diagnostics. No raw arbitrary instruction data
// is logged, since a wallet-added instruction could contain sensitive material.
export function describeReclaimMessage(bytes: ReadonlyUint8Array) {
  const message = getCompiledTransactionMessageDecoder().decode(bytes);
  if (message.version !== 0) throw new Error("Unexpected transaction version");
  if (message.addressTableLookups?.length) throw new Error("Unexpected address lookup tables");
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = message.header;
  const accountMetas = message.staticAccounts.map((address, index) => ({
    address,
    signer: index < numSignerAccounts,
    writable: index < numSignerAccounts ? index < numSignerAccounts - numReadonlySignerAccounts : index < message.staticAccounts.length - numReadonlyNonSignerAccounts,
  }));
  const instructions = message.instructions.map((instruction, index) => {
    const program = message.staticAccounts[instruction.programAddressIndex];
    const data = instruction.data ?? new Uint8Array();
    let decoded: { kind: string; units?: number; microLamports?: string } = { kind: "Unrecognized instruction (data redacted)" };
    if (program === COMPUTE_BUDGET_PROGRAM_ADDRESS && data[0] === 2 && data.length === 5) decoded = { kind: "SetComputeUnitLimit", units: getSetComputeUnitLimitInstructionDataDecoder().decode(data).units };
    if (program === COMPUTE_BUDGET_PROGRAM_ADDRESS && data[0] === 3 && data.length === 9) decoded = { kind: "SetComputeUnitPrice", microLamports: getSetComputeUnitPriceInstructionDataDecoder().decode(data).microLamports.toString() };
    if ((RECLAIM_PROGRAMS as readonly string[]).includes(program) && data.length === 1 && data[0] === 38) decoded = { kind: "WithdrawExcessLamports" };
    return { index, program, accounts: (instruction.accountIndices ?? []).map((i) => accountMetas[i]), dataLength: data.length, ...decoded };
  });
  return { version: message.version, feePayer: message.staticAccounts[0], recentBlockhash: message.lifetimeToken, accountMetas, instructionCount: instructions.length, instructions };
}

export function compareReclaimMessages(preparedBytes: ReadonlyUint8Array, returnedBytes: ReadonlyUint8Array) {
  const identical = equalBytes(preparedBytes, returnedBytes);
  try {
    const prepared = describeReclaimMessage(preparedBytes);
    const returned = describeReclaimMessage(returnedBytes);
    const differences: string[] = [];
    if (prepared.feePayer !== returned.feePayer) differences.push("fee payer changed");
    if (prepared.recentBlockhash !== returned.recentBlockhash) differences.push("recent blockhash changed");
    if (JSON.stringify(prepared.accountMetas) !== JSON.stringify(returned.accountMetas)) {
      const byAddress = (metas: typeof prepared.accountMetas) =>
        [...metas].sort((left, right) => left.address < right.address ? -1 : left.address > right.address ? 1 : 0);
      differences.push(
        JSON.stringify(byAddress(prepared.accountMetas)) === JSON.stringify(byAddress(returned.accountMetas))
          ? "account table reordered (same addresses and privileges)"
          : "account addresses or privileges changed",
      );
    }
    if (prepared.instructionCount !== returned.instructionCount) differences.push(`instruction count changed (${prepared.instructionCount} to ${returned.instructionCount})`);
    const budgets = (m: typeof prepared) => m.instructions.filter((i) => i.program === COMPUTE_BUDGET_PROGRAM_ADDRESS);
    if (JSON.stringify(budgets(prepared)) !== JSON.stringify(budgets(returned))) {
      // Safe mobile diagnostics: no signatures, raw payloads or wallet addresses.
      // Positions are one-based; price stays an exact decimal string.
      const summarize = (message: typeof prepared) => {
        const instructions = budgets(message);
        const summary = instructions.slice(0, 2).map((instruction) => {
          const value = instruction.kind === "SetComputeUnitLimit"
            ? `limit=${instruction.units} CU`
            : instruction.kind === "SetComputeUnitPrice"
              ? `price=${instruction.microLamports} microLamports/CU`
              : "unrecognized instruction";
          return `${value}@${instruction.index + 1}`;
        }).join(", ");
        return (summary || "none") + (instructions.length > 2 ? `, +${instructions.length - 2} more` : "");
      };
      differences.push(`Compute Budget instructions changed (prepared: ${summarize(prepared)}; wallet: ${summarize(returned)})`);
    }
    const withdrawals = (m: typeof prepared) => m.instructions.filter((i) => i.kind === "WithdrawExcessLamports").map(({ index: _index, ...i }) => i);
    if (JSON.stringify(withdrawals(prepared)) !== JSON.stringify(withdrawals(returned))) differences.push("withdrawal source, destination, authority, program or ordering changed");
    if (!identical && !differences.length) differences.push("instruction data, ordering or message encoding changed");
    return { identical, differences, prepared, returned };
  } catch {
    return { identical, differences: ["wallet returned an unsupported or undecodable message"] };
  }
}

export function assertSignedMessageUnchanged(prepared: ReadonlyUint8Array, returned: ReadonlyUint8Array) {
  if (equalBytes(prepared, returned)) return;
  const diagnostic = compareReclaimMessages(prepared, returned);
  // Never enable investigation logging in a production build, including local
  // production previews. Strict message validation remains enabled everywhere.
  if (process.env.NODE_ENV === "development") console.warn("RentBack rejected wallet message mutation", diagnostic);
  throw new Error(`Your wallet changed the transaction instructions: ${diagnostic.differences.join("; ")}. Nothing was submitted by RentBack.`);
}
