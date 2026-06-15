import { describe, it, expect } from "vitest";
import { injectHighlights } from "./highlight.js";
import type { ReconcileResult, ReconciledComment } from "./reconcile.js";
import type { CommentState, ParsedEntry } from "./types.js";

/** Minimal ParsedEntry for a given id (only the id is read by highlight.ts). */
function entry(id: string): ParsedEntry {
  return {
    id,
    author: "tester",
    provenance: "human",
    timestamp: "2026-06-14 12:00 +10:00",
    quote: "",
    body: "",
    rawStart: 0,
    rawEnd: 0,
  };
}

/** Build a ReconcileResult from a list of (id, state) pairs. */
function recon(...pairs: Array<[string, CommentState]>): ReconcileResult {
  const comments: ReconciledComment[] = pairs.map(([id, state]) => ({
    entry: entry(id),
    state,
    flags: [],
  }));
  const needsAttention = comments.filter(
    (c) => c.state === "orphan" || c.state === "content-removed",
  );
  return {
    comments,
    needsAttention,
    strayClosers: [],
    reviewBlockMisplaced: false,
    secondReviewBlock: false,
    attentionCount: needsAttention.length,
  };
}

describe("injectHighlights — spans", () => {
  it("wraps an intact span pair in a <mark> with id + state", () => {
    const html = `<p>Use <!--pmk:s abcdefgh-->high level<!--/pmk:s abcdefgh--> design.</p>`;
    const out = injectHighlights(html, recon(["abcdefgh", "intact"]));
    expect(out).toBe(
      `<p>Use <mark class="pmk-hl" data-pmk-id="abcdefgh" data-pmk-state="intact">high level</mark> design.</p>`,
    );
  });

  it("stamps data-pmk-state for a degraded-recovered span pair", () => {
    const html = `<p><!--pmk:s qrstuvwx-->edited text<!--/pmk:s qrstuvwx--></p>`;
    const out = injectHighlights(html, recon(["qrstuvwx", "degraded-recovered"]));
    expect(out).toContain(`data-pmk-state="degraded-recovered"`);
    expect(out).toContain(`<mark class="pmk-hl" data-pmk-id="qrstuvwx"`);
    expect(out).toContain(`>edited text</mark>`);
  });

  it("strips markers but keeps content for a content-removed span (no <mark>)", () => {
    // content-removed = empty extent (adjacent markers, §8.3): no highlight.
    const html = `<p>before <!--pmk:s aaaaaaaa--><!--/pmk:s aaaaaaaa--> after</p>`;
    const out = injectHighlights(html, recon(["aaaaaaaa", "content-removed"]));
    expect(out).toBe(`<p>before  after</p>`);
    expect(out).not.toContain("mark");
    expect(out).not.toContain("pmk:s");
  });

  it("strips a lone opener (degraded-recovered in production) leaving no <mark>", () => {
    // In production a degraded-recovered span has its closer destroyed, so only
    // the opener survives in the HTML — it cannot delimit an extent, so it is
    // stripped and the comment surfaces only in the drawer (D12).
    const html = `<p>some <!--pmk:s bbbbbbbb-->text with no closer</p>`;
    const out = injectHighlights(html, recon(["bbbbbbbb", "degraded-recovered"]));
    expect(out).toBe(`<p>some text with no closer</p>`);
    expect(out).not.toContain("mark");
    expect(out).not.toContain("pmk:s");
  });

  it("leaves no <mark> for an orphan id and strips a stray closer", () => {
    const html = `<p>text<!--/pmk:s cccccccc--> more</p>`;
    const out = injectHighlights(html, recon(["cccccccc", "orphan"]));
    expect(out).toBe(`<p>text more</p>`);
    expect(out).not.toContain("mark");
  });
});

describe("injectHighlights — blocks", () => {
  it("tags the next block element of an intact pmk:b marker", () => {
    const html = `<!--pmk:b ddddddff-->\n<table>\n<tr><td>a</td></tr>\n</table>`;
    const out = injectHighlights(html, recon(["ddddddff", "intact"]));
    expect(out).toContain(`<table data-pmk-id="ddddddff" data-pmk-state="intact" data-pmk-block="">`);
    expect(out).not.toContain("pmk:b");
  });

  it("strips a block marker whose comment is an orphan (no tagging)", () => {
    const html = `<!--pmk:b eeeeeeee-->\n<h2>Heading</h2>`;
    const out = injectHighlights(html, recon(["eeeeeeee", "orphan"]));
    expect(out).toBe(`\n<h2>Heading</h2>`);
    expect(out).not.toContain("pmk:b");
  });
});

describe("injectHighlights — ranges", () => {
  it("wraps the block run of an intact range pair in a div", () => {
    const html = `<!--pmk:r ffffffff o-->\n<p>one</p>\n<p>two</p>\n<!--pmk:r ffffffff c-->`;
    const out = injectHighlights(html, recon(["ffffffff", "intact"]));
    expect(out).toContain(`<div class="pmk-hl-range" data-pmk-id="ffffffff" data-pmk-state="intact">`);
    expect(out).toContain(`<p>one</p>`);
    expect(out).toContain(`<p>two</p>`);
    expect(out).toContain(`</div>`);
    expect(out).not.toContain("pmk:r");
  });

  it("strips an orphan range pair without wrapping", () => {
    const html = `<!--pmk:r gggggggg o-->\n<p>x</p>\n<!--pmk:r gggggggg c-->`;
    const out = injectHighlights(html, recon(["gggggggg", "orphan"]));
    expect(out).not.toContain("div");
    expect(out).not.toContain("pmk:r");
    expect(out).toContain(`<p>x</p>`);
  });
});

describe("injectHighlights — isolation", () => {
  it("never alters non-pmk HTML", () => {
    const html = `<h1>Title</h1>\n<p>A paragraph with <code>code</code> and <a href="https://x.test">a link</a>.</p>`;
    const out = injectHighlights(html, recon());
    expect(out).toBe(html);
  });

  it("handles multiple comments in one document", () => {
    const html = `<p><!--pmk:s 22222222-->a<!--/pmk:s 22222222--> and <!--pmk:s 33333333-->b<!--/pmk:s 33333333--></p>`;
    const out = injectHighlights(html, recon(["22222222", "intact"], ["33333333", "intact"]));
    expect(out).toBe(
      `<p><mark class="pmk-hl" data-pmk-id="22222222" data-pmk-state="intact">a</mark> and <mark class="pmk-hl" data-pmk-id="33333333" data-pmk-state="intact">b</mark></p>`,
    );
  });

  it("strips a marker whose id is unknown to the reconcile result", () => {
    const html = `<p><!--pmk:s 44444444-->x<!--/pmk:s 44444444--></p>`;
    const out = injectHighlights(html, recon());
    expect(out).toBe(`<p>x</p>`);
  });
});
