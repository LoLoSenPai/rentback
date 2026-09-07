import { readFileSync, writeFileSync } from 'node:fs';

const originalPath = "src/app/reclaim-panel.tsx";
const original = readFileSync(originalPath, "utf8");

// Step 1: Add useMemo and useSearchParams to imports
const withNewImports = original.replace(
  'import { useEffect, useRef, useState } from "react";',
  'import { useEffect, useMemo, useRef, useState } from "react";\nimport { useSearchParams } from "next/navigation";'
);

// Step 2: Add parseDiagSignLimit function before ReclaimPanel
const diagParser = `
function parseDiagSignLimit(raw: string | null) {
  if (!raw) return undefined;
  const limit = Number(raw);
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) return undefined;
  return limit;
}
`;
const withParser = original.replace(
  'export function ReclaimPanel(',
  diagParser + '\nexport function ReclaimPanel('
);

// Step 3: Add useSearchParams and queryDiagLimit after connection
const withSearchParams = withParser.replace(
  'const connection = useConnectedWallet(walletClient);',
  `const connection = useConnectedWallet(walletClient);
  const searchParams = useSearchParams();
  const queryDiagLimit = useMemo(() => parseDiagSignLimit(searchParams.get("rbDiagSignLimit")), [searchParams]);`
);

// Step 4: Add diagnostics arg and check after executeReviewedBatch call
const withDiagArg = withSearchParams.replace(
  `        submit: (receipt, wire) =>
          reclaimRequest({
            action: "submit",
            owner,
            scannedWallet: owner,
            batch: receipt.batch,
            wire,
          }),
      });`,
  `        submit: (receipt, wire) =>
          reclaimRequest({
            action: "submit",
            owner,
            scannedWallet: owner,
            batch: receipt.batch,
            wire,
          }),
      }, {
        signerTransactionLimit: queryDiagLimit,
        noSubmit: Boolean(queryDiagLimit),
      });
      if (queryDiagLimit) {
        setProgress(\`Diagnostic mode active (${queryDiagLimit}). Signing finished without submission.\`);
        return;
      }`
);

writeFileSync(originalPath, withDiagArg);
console.log("DONE - reclaim-panel.tsx updated");