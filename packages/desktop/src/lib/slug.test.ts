// packages/desktop/src/lib/slug.test.ts
import { describe, it, expect } from "vitest";
import { slugifySegment } from "./slug";

describe("slugifySegment", () => {
  it("passes a clean name through", () => {
    expect(slugifySegment("Admin")).toBe("Admin");
  });
  it("replaces whitespace runs with a single dash", () => {
    expect(slugifySegment("Studio  Mini")).toBe("Studio-Mini");
  });
  it("strips apostrophes and other punctuation", () => {
    expect(slugifySegment("Apple's MacBook Pro")).toBe("Apples-MacBook-Pro");
  });
  it("keeps dots, dashes, underscores", () => {
    expect(slugifySegment("dev_box-1.2")).toBe("dev_box-1.2");
  });
  it("trims leading/trailing separators", () => {
    expect(slugifySegment("  -.box.-  ")).toBe("box");
  });
  it("returns empty string when nothing usable remains", () => {
    expect(slugifySegment("   ")).toBe("");
    expect(slugifySegment("💻")).toBe("");
  });
});
