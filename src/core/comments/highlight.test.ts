import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { createRenderer } from "../render/markdown.js";
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
    unreadableReviewData: [],
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

describe("injectHighlights — a span crossing block boundaries", () => {
  // A bullet list is ONE block, so selecting some of its items is a span, not a
  // range. A single <mark> spanning `</li><li>` is invalid nesting, and since
  // <mark> is not an HTML formatting element the parser closes it at `</li>` and
  // discards the stray closer — every item after the first loses its highlight.
  // The extent must therefore become one <mark> per inline run.
  const listHtml =
    `<ul>\n` +
    `<li><!--pmk:s abcdefgh--><strong>Bold lead.</strong> first item</li>\n` +
    `<li>second with <code>code</code> here</li>\n` +
    `<li>third with <em>italic</em> text<!--/pmk:s abcdefgh--></li>\n` +
    `</ul>`;

  it("emits one <mark> per list item, all carrying the same id", () => {
    const out = injectHighlights(listHtml, recon(["abcdefgh", "intact"]));
    const marks = out.match(/<mark class="pmk-hl" data-pmk-id="abcdefgh"/g) ?? [];
    expect(marks).toHaveLength(3);
    expect(out.match(/<\/mark>/g) ?? []).toHaveLength(3);
  });

  it("never lets a <mark> straddle a block tag", () => {
    const out = injectHighlights(listHtml, recon(["abcdefgh", "intact"]));
    for (const [, body] of out.matchAll(/<mark\b[^>]*>([\s\S]*?)<\/mark>/g)) {
      expect(body).not.toMatch(/<\/?(?:li|ul|ol|p|div|blockquote)\b/);
    }
  });

  it("keeps every word of the extent inside a highlight", () => {
    const out = injectHighlights(listHtml, recon(["abcdefgh", "intact"]));
    const bodies = [...out.matchAll(/<mark\b[^>]*>([\s\S]*?)<\/mark>/g)].map((m) => m[1]!);
    for (const phrase of ["Bold lead.", "first item", "second with", "third with", "text"]) {
      expect(bodies.some((body) => body.includes(phrase))).toBe(true);
    }
  });

  it("does not wrap the whitespace between block tags", () => {
    const out = injectHighlights(listHtml, recon(["abcdefgh", "intact"]));
    expect(out).not.toMatch(/<mark\b[^>]*>\s*<\/mark>/);
    expect(out).toContain("</li>\n<li>");
  });

  it("still emits exactly one <mark> for an extent inside a single block", () => {
    const html = `<p>Use <!--pmk:s abcdefgh-->high <em>level</em><!--/pmk:s abcdefgh--> design.</p>`;
    const out = injectHighlights(html, recon(["abcdefgh", "intact"]));
    expect(out.match(/<mark\b/g) ?? []).toHaveLength(1);
    expect(out).toContain(
      `<mark class="pmk-hl" data-pmk-id="abcdefgh" data-pmk-state="intact">high <em>level</em></mark>`,
    );
  });

  it("does not mistake a '>' inside a quoted attribute for the end of a tag", () => {
    // Raw HTML flows through markdown-it (html:true), so an extent can contain
    // an attribute value holding '>'. Ending the tag at the first '>' would
    // splice the <mark> into the attribute and destroy the element.
    const html =
      `<li><!--pmk:s abcdefgh-->before</li>\n` +
      `<li><div data-x=">">raw</div></li>\n` +
      `<li>after<!--/pmk:s abcdefgh--></li>`;
    const out = injectHighlights(html, recon(["abcdefgh", "intact"]));
    expect(out).toContain(`<div data-x=">">`);
    expect(out).not.toContain(`<div data-x="><mark`);
    expect(out.match(/<mark\b/g) ?? []).toHaveLength(3);
  });

  it("does not scan tag-looking text inside a raw-text element", () => {
    // Inside <textarea>/<title>/<script>/<style> a "<div>" is text, not markup.
    // Splitting there rewrites the element's own value.
    const html =
      `<li><!--pmk:s abcdefgh-->before</li>\n` +
      `<li><textarea>literal <div> text</textarea></li>\n` +
      `<li>after<!--/pmk:s abcdefgh--></li>`;
    const out = injectHighlights(html, recon(["abcdefgh", "intact"]));
    expect(out).toContain(`<textarea>literal <div> text</textarea>`);
    expect(out).not.toMatch(/<textarea>[^<]*<\/mark>/);
  });

  it("treats <textarea/> as an opening tag, the way a browser does", () => {
    // The '/' in an HTML start tag is ignored, so <textarea/> still opens RCDATA.
    // Honouring it would resume scanning inside the element's own text.
    const html =
      `<li><!--pmk:s abcdefgh-->before</li>\n` +
      `<li><textarea/>literal <div> text</textarea></li>\n` +
      `<li>after<!--/pmk:s abcdefgh--></li>`;
    const out = injectHighlights(html, recon(["abcdefgh", "intact"]));
    expect(out).toContain(`<textarea/>literal <div> text</textarea>`);
    expect(out).not.toMatch(/<textarea\/>[^<]*<\/mark>/);
  });

  it("lets <plaintext> run to the end of the extent without splicing marks", () => {
    // <plaintext> has no end tag: everything after it is text, `</plaintext>`
    // included. Nothing after it can be highlighted, so the run simply ends.
    const html =
      `<li><!--pmk:s abcdefgh-->before</li>\n` +
      `<li><plaintext>x</plaintext><div>y</div>after<!--/pmk:s abcdefgh--></li>`;
    const out = injectHighlights(html, recon(["abcdefgh", "intact"]));
    expect(out).toContain(`<plaintext>x</plaintext><div>y</div>after`);
    expect(out.slice(out.indexOf("<plaintext>"))).not.toContain("<mark");
    expect(out.slice(out.indexOf("<plaintext>"))).not.toContain("</mark>");
  });

  it.each(["svg", "template"])(
    "ignores a fake end tag inside a comment in a <%s> subtree",
    (tag) => {
      const html =
        `<li><!--pmk:s abcdefgh-->before</li>\n` +
        `<li><${tag}><!-- </${tag}> --><i>kept</i></${tag}></li>\n` +
        `<li>after<!--/pmk:s abcdefgh--></li>`;
      const out = injectHighlights(html, recon(["abcdefgh", "intact"]));
      expect(out).toContain(`<${tag}><!-- </${tag}> --><i>kept</i></${tag}>`);
      // The mark must not close inside the subtree it opened outside of.
      expect(out).not.toMatch(new RegExp(`<!-- </${tag}> --></mark>`));
    },
  );

  it("keeps a self-contained subtree whole instead of splitting inside it", () => {
    const html = `<p><!--pmk:s abcdefgh-->a<svg viewBox="0 0 1 1"><title>t</title><rect/></svg>b<!--/pmk:s abcdefgh--></p>`;
    const out = injectHighlights(html, recon(["abcdefgh", "intact"]));
    expect(out).toContain(`<svg viewBox="0 0 1 1"><title>t</title><rect/></svg>`);
    expect(out.match(/<mark\b/g) ?? []).toHaveLength(1);
  });

  it.each(["dialog", "menu", "search", "address", "x-custom"])(
    "treats <%s> as a boundary so its children are not torn out",
    (tag) => {
      const html =
        `<li><!--pmk:s abcdefgh-->before</li>\n` +
        `<li><${tag}><p>inner</p></${tag}></li>\n` +
        `<li>after<!--/pmk:s abcdefgh--></li>`;
      const out = injectHighlights(html, recon(["abcdefgh", "intact"]));
      // The container's open tag must never sit inside a <mark> that closes
      // before the container does — that is the crossing the browser repairs by
      // relocating the child out of its parent.
      expect(out).toContain(`<${tag}><p>`);
      expect(out).not.toMatch(new RegExp(`<${tag}></mark>`));
      for (const [, body] of out.matchAll(/<mark\b[^>]*>([\s\S]*?)<\/mark>/g)) {
        expect(body).not.toContain(`<${tag}>`);
      }
    },
  );

  it("ignores block-looking tags inside an HTML comment", () => {
    const html = `<p><!--pmk:s abcdefgh-->a<!-- note <div> inside -->b<!--/pmk:s abcdefgh--></p>`;
    const out = injectHighlights(html, recon(["abcdefgh", "intact"]));
    expect(out.match(/<mark\b/g) ?? []).toHaveLength(1);
    expect(out).toContain(`<!-- note <div> inside -->`);
  });

  it("splits a span that crosses paragraphs inside one list item", () => {
    const html = `<li><!--pmk:s abcdefgh--><p>first para</p>\n<p>second para<!--/pmk:s abcdefgh--></p></li>`;
    const out = injectHighlights(html, recon(["abcdefgh", "intact"]));
    expect(out.match(/<mark\b/g) ?? []).toHaveLength(2);
    expect(out).toContain(
      `<p><mark class="pmk-hl" data-pmk-id="abcdefgh" data-pmk-state="intact">first para</mark></p>`,
    );
  });
});

describe("injectHighlights — blocks", () => {
  it("tags the next block element of an intact pmk:b marker", () => {
    const html = `<!--pmk:b ddddddff-->\n<table>\n<tr><td>a</td></tr>\n</table>`;
    const out = injectHighlights(html, recon(["ddddddff", "intact"]));
    expect(out).toContain(
      `<table data-pmk-id="ddddddff" data-pmk-state="intact" data-pmk-block="">`,
    );
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
    expect(out).toContain(
      `<div class="pmk-hl-range" data-pmk-id="ffffffff" data-pmk-state="intact">`,
    );
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

describe("injectHighlights — the browser's view of a split span", () => {
  // The string assertions above pin the markup; these pin what a browser
  // actually builds from it, which is where the original truncation bug and the
  // raw-text corruption both showed up.
  function domOf(markdown: string): Document {
    const html = injectHighlights(
      createRenderer({}).render(markdown),
      recon(["abcdefgh", "intact"]),
    );
    return new JSDOM(`<body>${html}</body>`).window.document;
  }

  const listSpan = (raw: string): string =>
    `- <!--pmk:s abcdefgh-->before\n\n  ${raw}\n\n  after<!--/pmk:s abcdefgh-->\n`;

  it("leaves a textarea's value exactly as authored", () => {
    const doc = domOf(listSpan(`<textarea>literal <div> text</textarea>`));
    expect(doc.querySelector("textarea")!.textContent).toBe("literal <div> text");
  });

  it("keeps a dialog's paragraph inside the dialog", () => {
    const doc = domOf(listSpan(`<dialog><p>raw dialog text</p></dialog>`));
    const dialog = doc.querySelector("dialog")!;
    expect(dialog.querySelector("p")?.textContent).toBe("raw dialog text");
  });

  it("keeps a rect inside an svg whose comment holds a fake end tag", () => {
    const doc = domOf(listSpan(`<svg viewBox="0 0 1 1"><!-- </svg> --><rect/></svg>`));
    const svg = doc.querySelector("svg")!;
    expect(svg.querySelector("rect")).not.toBeNull();
  });

  it("does not change a self-closed textarea's value relative to rendering alone", () => {
    // markdown-it has no HTML parser, so `<textarea/>` goes down its INLINE path
    // and the renderer's own per-text-node spans land inside the element's text.
    // That predates comments entirely (it reproduces with none in the document),
    // so the contract here is narrower: injecting a highlight must not make the
    // value any worse than the renderer already left it.
    const markdown = listSpan(`<textarea/>literal <div> text</textarea>`);
    // Removing the anchors shifts every source offset, so compare without them.
    const value = (doc: Document): string =>
      doc.querySelector("textarea")!.textContent!.replace(/ data-pmk-soff="\d+"/g, "");
    const plain = new JSDOM(
      `<body>${createRenderer({}).render(markdown.replace(/<!--[\s\S]*?-->/g, ""))}</body>`,
    ).window.document;
    expect(value(domOf(markdown))).toBe(value(plain));
    expect(value(domOf(markdown))).not.toContain("mark");
  });

  it("highlights every item of a span across list items", () => {
    const doc = domOf(
      `- <!--pmk:s abcdefgh-->**Bold.** one\n- two with \`code\`\n- three<!--/pmk:s abcdefgh-->\n`,
    );
    const marks = [...doc.querySelectorAll("mark[data-pmk-id='abcdefgh']")];
    expect(marks).toHaveLength(3);
    expect(doc.querySelectorAll("li")).toHaveLength(3);
    for (const li of doc.querySelectorAll("li")) {
      expect(li.querySelector("mark[data-pmk-id='abcdefgh']")).not.toBeNull();
    }
  });
});
