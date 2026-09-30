import { describe, expect, it } from "vitest";
import config from "../tailwind.config";

describe("tailwind config", () => {
  // A non-string (raw/object) entry in theme.extend.screens makes Tailwind 3.4 silently
  // disable every max-* variant and every arbitrary min-[…]/max-[…] variant: the classes
  // stay in the markup but no CSS is generated. Custom media queries belong in a plugin
  // variant (see `short` in tailwind.config.ts).
  it("keeps theme.extend.screens simple (no raw or object entries)", () => {
    const screens = (config.theme?.extend as { screens?: Record<string, unknown> } | undefined)?.screens ?? {};
    const nonString = Object.entries(screens).filter(([, value]) => typeof value !== "string");
    expect(nonString).toEqual([]);
  });
});
