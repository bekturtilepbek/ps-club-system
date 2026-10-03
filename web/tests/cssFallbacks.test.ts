import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A browser that does not understand color-mix() (Chrome before 111, i.e. the last Chrome that runs
// on Windows 7/8) drops the whole declaration. The loud card states ("скоро конец", "переигрыш")
// have no other background, so the alert would silently vanish on an old till PC. Each color-mix()
// therefore needs an ordinary declaration of the same property just before it.
const css = readFileSync(path.resolve(__dirname, "../src/index.css"), "utf8");

function declarationsOf(block: string): { property: string; value: string }[] {
  return block
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes(":"))
    .map((part) => {
      const at = part.indexOf(":");
      return { property: part.slice(0, at).trim(), value: part.slice(at + 1).trim() };
    });
}

describe("index.css", () => {
  it("gives every color-mix() a plain fallback declaration of the same property before it", () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const unprotected: string[] = [];
    for (const [, selector, body] of rules) {
      const declarations = declarationsOf(body);
      declarations.forEach((declaration, index) => {
        if (!declaration.value.includes("color-mix(")) return;
        const hasFallback = declarations
          .slice(0, index)
          .some((earlier) => earlier.property === declaration.property && !earlier.value.includes("color-mix("));
        if (!hasFallback) unprotected.push(`${selector.trim()} { ${declaration.property} }`);
      });
    }

    expect(unprotected).toEqual([]);
  });
});
