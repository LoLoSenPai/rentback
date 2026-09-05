// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BuilderLinks } from "./builder-links";
afterEach(cleanup);
it("shows icon links and safe external builder attribution", () => {
  render(<BuilderLinks />);
  for (const [name, url] of [["View source on GitHub", "https://github.com/LoLoSenPai/rentback"], ["Follow on X", "https://x.com/LoicDlugosz"], ["codersenpai", "https://portfolio.lololabs.xyz/"]]) {
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("href")).toBe(url); expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  }
  expect(screen.getByRole("link", { name: "View source on GitHub" }).querySelector("svg[aria-hidden=true]")).toBeTruthy();
});
