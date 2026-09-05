import { describe, expect, it } from "vitest";
import {
  appendTransactionMessageInstructions, createSolanaRpc, createTransactionMessage,
  generateKeyPairSigner, getBase64EncodedWireTransaction, lamports,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners, type Instruction, type Signature,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import { getInitializeAccount3Instruction, getInitializeMint2Instruction, getMintToInstruction, fetchToken, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { buildWithdrawInstructions } from "./reclaim";

// Opt-in only. Hardcoded devnet endpoint and genesis guard; no supplied keypair,
// production RPC configuration or mainnet wallet can enter this fixture.
describe.skipIf(process.env.RENTBACK_DEVNET_INTEGRATION !== "1")("devnet overfunded token-account fixture", () => {
  it.each([TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS])("withdraws only excess from %s", async (program) => {
    const rpc = createSolanaRpc("https://api.devnet.solana.com");
    expect(await rpc.getGenesisHash().send()).toBe("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
    const payer = await generateKeyPairSigner();
    const mint = await generateKeyPairSigner();
    const token = await generateKeyPairSigner();
    async function confirm(sig: Signature) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const { value: [status] } = await rpc.getSignatureStatuses([sig]).send();
        if (status?.err) throw new Error("Devnet fixture transaction failed.");
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error("Devnet confirmation timed out.");
    }
    const funding = await rpc.requestAirdrop(payer.address, lamports(100_000_000n)).send();
    await confirm(funding);
    async function send(instructions: Instruction[]) {
      const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      const message = appendTransactionMessageInstructions(instructions,
        setTransactionMessageLifetimeUsingBlockhash(blockhash,
          setTransactionMessageFeePayerSigner(payer, createTransactionMessage({ version: 0 }))));
      const transaction = await signTransactionMessageWithSigners(message);
      const wire = getBase64EncodedWireTransaction(transaction);
      const simulated = await rpc.simulateTransaction(wire, { encoding: "base64", sigVerify: true, commitment: "confirmed" }).send();
      expect(simulated.value.err).toBeNull();
      const sig = await rpc.sendTransaction(wire, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }).send();
      await confirm(sig);
      return sig;
    }
    const mintRent = await rpc.getMinimumBalanceForRentExemption(82n).send();
    const tokenRent = await rpc.getMinimumBalanceForRentExemption(165n).send();
    const excess = 1_000_000n;
    await send([
      getCreateAccountInstruction({ payer, newAccount: mint, lamports: mintRent, space: 82n, programAddress: program }),
      getInitializeMint2Instruction({ mint: mint.address, decimals: 0, mintAuthority: payer.address }, { programAddress: program }),
      getCreateAccountInstruction({ payer, newAccount: token, lamports: tokenRent + excess, space: 165n, programAddress: program }),
      getInitializeAccount3Instruction({ account: token.address, mint: mint.address, owner: payer.address }, { programAddress: program }),
      getMintToInstruction({ mint: mint.address, token: token.address, mintAuthority: payer, amount: 7n }, { programAddress: program }),
    ]);
    const before = await fetchToken(rpc, token.address, { commitment: "confirmed" });
    const walletBefore = (await rpc.getBalance(payer.address, { commitment: "confirmed" }).send()).value;
    const sig = await send(buildWithdrawInstructions([{ address: token.address, program }], payer.address, payer));
    const after = await fetchToken(rpc, token.address, { commitment: "confirmed" });
    const walletAfter = (await rpc.getBalance(payer.address, { commitment: "confirmed" }).send()).value;
    const details = await rpc.getTransaction(sig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }).send();
    expect(after.address).toBe(token.address);
    expect(after.data.amount).toBe(7n);
    expect(after.data.amount).toBe(before.data.amount);
    expect(before.lamports - after.lamports).toBe(excess);
    expect(walletAfter - walletBefore + details!.meta!.fee).toBe(excess);
    expect(after.programAddress).toBe(program);
  }, 180_000);
});
