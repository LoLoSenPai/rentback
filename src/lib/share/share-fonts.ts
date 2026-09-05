import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Node runtime, local OFL-licensed fonts, no external font/image fetch or SSRF.
let fonts: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" }[]> | undefined;
export function loadShareFonts() {
  fonts ??= Promise.all([
    ["Barlow", "Barlow-Regular.ttf", 400] as const,
    ["Barlow Condensed", "BarlowCondensed-SemiBold.ttf", 600] as const,
  ].map(async ([name, file, weight]) => {
    const data = await readFile(join(process.cwd(), "public", "fonts", file));
    return { name, data: Uint8Array.from(data).buffer, weight, style: "normal" as const };
  }));
  return fonts;
}
