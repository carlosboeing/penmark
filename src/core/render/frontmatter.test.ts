import { describe, it, expect } from "vitest";
import { parseFrontmatterFields } from "./frontmatter.js";

describe("parseFrontmatterFields", () => {
  it("parses a block sequence into a string array", () => {
    const fields = parseFrontmatterFields("authors:\n  - Carlos Boeing\n  - claude-opus-5\n");
    expect(fields.authors).toEqual(["Carlos Boeing", "claude-opus-5"]);
  });

  it("ends a block sequence at the next key", () => {
    const fields = parseFrontmatterFields("scope:\n  - webview\n  - responsive\nstatus: draft\n");
    expect(fields.scope).toEqual(["webview", "responsive"]);
    expect(fields.status).toBe("draft");
  });

  it("leaves a key with no items as an empty string", () => {
    const fields = parseFrontmatterFields("authors:\nstatus: draft\n");
    expect(fields.authors).toBe("");
    expect(fields.status).toBe("draft");
  });

  it("still parses inline lists", () => {
    const fields = parseFrontmatterFields("tags: [alpha, beta]\n");
    expect(fields.tags).toEqual(["alpha", "beta"]);
  });

  it("strips quotes from sequence items", () => {
    const fields = parseFrontmatterFields('authors:\n  - "Carlos Boeing"\n');
    expect(fields.authors).toEqual(["Carlos Boeing"]);
  });
});
