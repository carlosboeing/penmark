import { describe, it, expect } from "vitest";
import * as vscode from "vscode";
import { renderDocument } from "./render.js";
import { analyzeComments } from "./comments.js";

/** A webview stub exposing only asWebviewUri (used for image src rewriting). */
const fakeWebview = {
  asWebviewUri: (u: unknown) => u,
} as unknown as vscode.Webview;

function render(source: string): Extract<ReturnType<typeof renderDocument>, { type: "render" }> {
  return renderDocument(
    source,
    vscode.Uri.file("/tmp/d.md"),
    "d.md",
    "light",
    fakeWebview,
    undefined,
    true,
    analyzeComments(source),
  );
}

describe("renderDocument — comment-aware highlight injection (R13)", () => {
  const intactDoc =
    "Hello <!--pmk:s abcdefgh-->world<!--/pmk:s abcdefgh-->.\n\n" +
    "<!-- pmk:review v1 -->\n" +
    "<!--pmk:c abcdefgh\nA (human) · 2026-06-14 12:00 +10:00\n> world\n\nnote\n-->\n" +
    "<!-- /pmk:review -->\n";

  it("wraps an intact comment's extent in a <mark data-pmk-id> in the posted HTML", () => {
    const msg = render(intactDoc);
    expect(msg.html).toContain('<mark class="pmk-hl" data-pmk-id="abcdefgh"');
    expect(msg.html).toContain('data-pmk-state="intact"');
    // …and the marker comments are consumed (rewritten), not left as raw HTML.
    expect(msg.html).not.toContain("<!--pmk:s abcdefgh-->");
    // The wire payload still carries the comment for the drawer/popover.
    expect(msg.comments).toHaveLength(1);
    expect(msg.comments[0]!.id).toBe("abcdefgh");
  });

  it("emits no highlight markup for a comment-free document", () => {
    const msg = render("# Title\n\nJust prose, no comments.\n");
    expect(msg.html).not.toContain("data-pmk-id");
    expect(msg.html).not.toContain("pmk-hl");
    expect(msg.comments).toHaveLength(0);
  });

  it("deterministically strips leftover anchor markers whose entry is gone", () => {
    // A body span pair with no matching review-block entry (corruption / hand
    // edit). It is neither a live comment nor a stray closer, so the render must
    // still clean the raw markers out instead of leaking them into the webview.
    const msg = render("A <!--pmk:s deadbeef-->word<!--/pmk:s deadbeef--> here.\n");
    expect(msg.html).not.toContain("pmk:s deadbeef"); // markers stripped
    expect(msg.html).not.toContain("<mark"); // no entry → not highlighted
    expect(msg.html).toContain("word"); // content preserved
  });
});
