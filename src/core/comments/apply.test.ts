import { describe, expect, it } from "vitest";
import {
  listComments,
  locateQuote,
  planFindings,
  planResolve,
  validateText,
  type PlanOptions,
} from "./apply.js";
import { parseDoc } from "./parser.js";

const OPTS: PlanOptions = {
  author: "Ada",
  provenance: "agent",
  timestamp: "2026-11-13 12:00:00 +00:00",
};

function plan(text: string, findings: { quote: string; body: string; start?: number; end?: number }[]) {
  return planFindings(text, findings, OPTS);
}

describe("planFindings", () => {
  it("places one anchor when the quote is unique", () => {
    const text = "The eventual consistency model waits.\n";
    const out = plan(text, [{ quote: "eventual consistency", body: "Name the failure mode." }]);
    expect(out.code).toBe(0);
    expect(out.results).toEqual([
      expect.objectContaining({ quote: "eventual consistency", action: "placed" }),
    ]);
    expect(out.results[0]?.id).toMatch(/^[a-z2-7]{8}$/);
    const doc = parseDoc(out.text ?? "");
    expect(doc.anchors.size).toBe(1);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0]?.body).toBe("Name the failure mode.");
    expect(out.text).toContain("<!--pmk:s");
  });

  it("replies when the quote matches a live root and adds no marker", () => {
    const first = plan("The eventual consistency model waits.\n", [
      { quote: "eventual consistency", body: "Name the failure mode." },
    ]);
    const placed = first.text ?? "";
    const markers = placed.match(/pmk:s/g)?.length ?? 0;
    const out = plan(placed, [{ quote: "eventual consistency", body: "Say what happens on timeout." }]);
    expect(out.code).toBe(0);
    expect(out.results[0]?.action).toBe("replied");
    expect(out.text).toContain(` re ${first.results[0]?.id}`);
    expect(out.text?.match(/pmk:s/g)?.length).toBe(markers);
    const root = parseDoc(out.text ?? "").entries.find((e) => e.id === first.results[0]?.id);
    expect(root?.quote).toBe("eventual consistency");
  });

  it("skips a repeated body and leaves the bytes unchanged", () => {
    const first = plan("The eventual consistency model waits.\n", [
      { quote: "eventual consistency", body: "Name the failure mode." },
    ]);
    const second = plan(first.text ?? "", [
      { quote: "eventual consistency", body: "Name the failure mode." },
    ]);
    expect(second.code).toBe(0);
    expect(second.results[0]?.action).toBe("skipped");
    expect(second.text).toBeNull();
  });

  it("rejects two passages and lists both matches", () => {
    const text = "See eventual consistency early.\n\nSee eventual consistency later.\n";
    const out = plan(text, [{ quote: "eventual consistency", body: "Which one?" }]);
    expect(out.code).toBe(2);
    expect(out.text).toBeNull();
    expect(out.results[0]?.reason).toBe("ambiguous-quote");
    expect(out.results[0]?.matches).toHaveLength(2);
    expect(out.results[0]?.id).toBeUndefined();
  });

  it("keeps a later explicit range on its original passage", () => {
    const text = "Alpha here.\n\nBeta target words stay.\n";
    const alpha = text.indexOf("Alpha");
    const target = text.indexOf("target words");
    const out = plan(text, [
      { quote: "Alpha", body: "First.", start: alpha, end: alpha + "Alpha".length },
      {
        quote: "target words",
        body: "Second.",
        start: target,
        end: target + "target words".length,
      },
    ]);
    expect(out.code).toBe(0);
    const written = out.text ?? "";
    const doc = parseDoc(written);
    expect(doc.corruption).toEqual([]);
    const second = doc.entries.find((e) => e.body === "Second.");
    const anchor = second === undefined ? undefined : doc.anchors.get(second.id);
    expect(anchor?.kind).toBe("span");
    expect(written.slice(anchor?.extentStart, anchor?.extentEnd)).toBe("target words");
  });

  it("keeps a third explicit range after the review block has grown", () => {
    const text = "Alpha here.\n\nBeta target words stay.\n";
    const at = (word: string) => ({
      quote: word,
      start: text.indexOf(word),
      end: text.indexOf(word) + word.length,
    });
    const out = plan(text, [
      { ...at("Alpha"), body: "First." },
      { ...at("target words"), body: "Second." },
      { ...at("stay"), body: "Third." },
    ]);
    expect(out.code).toBe(0);
    const written = out.text ?? "";
    const doc = parseDoc(written);
    expect(doc.corruption).toEqual([]);
    const third = doc.entries.find((e) => e.body === "Third.");
    const anchor = third === undefined ? undefined : doc.anchors.get(third.id);
    expect(anchor?.kind).toBe("span");
    expect(written.slice(anchor?.extentStart, anchor?.extentEnd)).toBe("stay");
  });

  it("keeps an explicit range that follows a reply in the same batch", () => {
    const text = "Alpha here.\n\nBeta target words stay.\n";
    const alpha = text.indexOf("Alpha");
    const stay = text.indexOf("stay");
    const out = plan(text, [
      { quote: "Alpha", body: "First.", start: alpha, end: alpha + "Alpha".length },
      { quote: "Alpha", body: "A reply.", start: alpha, end: alpha + "Alpha".length },
      { quote: "stay", body: "Third.", start: stay, end: stay + "stay".length },
    ]);
    expect(out.code).toBe(0);
    expect(out.results.map((r) => r.action)).toEqual(["placed", "replied", "placed"]);
    const written = out.text ?? "";
    const doc = parseDoc(written);
    expect(doc.corruption).toEqual([]);
    const third = doc.entries.find((e) => e.body === "Third.");
    const anchor = third === undefined ? undefined : doc.anchors.get(third.id);
    expect(written.slice(anchor?.extentStart, anchor?.extentEnd)).toBe("stay");
    expect(doc.anchors.has(out.results[1]?.id ?? "")).toBe(false);
  });

  it("does not extend an explicit end at the file end into the review block", () => {
    const text = "Alpha here.\n\nBeta target words stay.\n";
    const alpha = text.indexOf("Alpha");
    const out = plan(text, [
      { quote: "Alpha", body: "First.", start: alpha, end: alpha + "Alpha".length },
      { quote: "Alpha here.", body: "Whole.", start: 0, end: text.length },
    ]);
    expect(out.code).toBe(0);
    const written = out.text ?? "";
    const doc = parseDoc(written);
    expect(doc.corruption).toEqual([]);
    const whole = doc.entries.find((e) => e.body === "Whole.");
    const anchor = whole === undefined ? undefined : doc.anchors.get(whole.id);
    expect(anchor).toBeDefined();
    expect(written.slice(anchor?.extentStart, anchor?.extentEnd)).not.toContain("pmk:review");
  });

  it("does not match a quote that runs into the review block", () => {
    const text =
      "Ends with marker\n\n" +
      "<!-- pmk:review v1 -->\n" +
      "<!--pmk:c aaaaaaaa\nAda (agent) · 2026-11-13 12:00:00 +00:00\n> other\n\nnote\n-->\n" +
      "<!-- /pmk:review -->\n";
    const out = plan(text, [{ quote: "marker <!--", body: "No." }]);
    expect(out.code).toBe(2);
    expect(out.results[0]?.reason).toBe("no-match");
    expect(out.text).toBeNull();
  });

  it("rejects a quote that is not in the file", () => {
    const out = plan("Nothing relevant here.\n", [{ quote: "eventual consistency", body: "Missing." }]);
    expect(out.code).toBe(2);
    expect(out.text).toBeNull();
    expect(out.results[0]?.reason).toBe("no-match");
  });

  it("rejects an uncommentable range", () => {
    const text = "---\ntitle: secret\n---\n\nBody.\n";
    const start = text.indexOf("title");
    const out = plan(text, [
      { quote: "title: secret", body: "No.", start, end: start + "title: secret".length },
    ]);
    expect(out.code).toBe(2);
    expect(out.results[0]?.reason).toBe("uncommentable");
    expect(out.text).toBeNull();
  });

  it("writes nothing when one finding in the batch is rejected", () => {
    const text = "The eventual consistency model waits.\n";
    const out = plan(text, [
      { quote: "eventual consistency", body: "Keep this." },
      { quote: "not present", body: "Drop the batch." },
    ]);
    expect(out.code).toBe(2);
    expect(out.text).toBeNull();
    expect(out.results.map((r) => r.action)).toEqual(["placed", "rejected"]);
  });

  it("a later note on the same sentence replies to the root", () => {
    const text = "The eventual consistency model waits.\n";
    const root = plan(text, [{ quote: "eventual consistency", body: "First." }]);
    const once = plan(root.text ?? "", [{ quote: "eventual consistency", body: "Second." }]);
    const twice = plan(once.text ?? "", [{ quote: "eventual consistency", body: "Third." }]);
    expect(twice.results[0]?.action).toBe("replied");
    expect(twice.code).toBe(0);
  });

  it("matches a content-removed root only through its advisory quote", () => {
    const text =
      "Gone <!--pmk:s aaaaaaaa--><!--/pmk:s aaaaaaaa--> now.\n\n" +
      "<!-- pmk:review v1 -->\n" +
      "<!--pmk:c aaaaaaaa\nAda (human) · 2026-11-13 12:00:00 +00:00\n> removed phrase\n\nOriginal note.\n-->\n" +
      "<!-- /pmk:review -->\n";
    const out = plan(text, [{ quote: "removed phrase", body: "Still open." }]);
    expect(out.code).toBe(0);
    expect(out.results[0]?.action).toBe("replied");
    expect(out.text).not.toContain("pmk:s b");
    expect(out.text?.match(/<!--pmk:s/g)?.length).toBe(1);
  });

  it("rejects two roots that share a quote", () => {
    const text =
      "One <!--pmk:s aaaaaaaa-->shared phrase<!--/pmk:s aaaaaaaa-->.\n\n" +
      "Two <!--pmk:s bbbbbbbb-->shared phrase<!--/pmk:s bbbbbbbb-->.\n\n" +
      "<!-- pmk:review v1 -->\n" +
      "<!--pmk:c aaaaaaaa\nAda (human) · 2026-11-13 12:00:00 +00:00\n> shared phrase\n\nFirst.\n-->\n" +
      "<!--pmk:c bbbbbbbb\nAda (human) · 2026-11-13 12:00:00 +00:00\n> shared phrase\n\nSecond.\n-->\n" +
      "<!-- /pmk:review -->\n";
    const out = plan(text, [{ quote: "shared phrase", body: "Which thread?" }]);
    expect(out.code).toBe(2);
    expect(out.results[0]?.reason).toBe("duplicate-roots");
    expect(out.results[0]?.ids).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(out.text).toBeNull();
  });

  it("refuses an unreadable review block", () => {
    const text = "Body.\n\n<!-- pmk:review v2 -->\n<!-- /pmk:review -->\n";
    const out = plan(text, [{ quote: "Body", body: "Note." }]);
    expect(out.code).toBe(4);
    expect(out.text).toBeNull();
    expect(out.corruption).toBeTruthy();
  });
});

describe("locate, validate, list, resolve", () => {
  it("locate lists both passages and caps the excerpt", () => {
    const text = "See eventual consistency early.\n\nSee eventual consistency later.\n";
    const found = locateQuote(text, "eventual consistency");
    expect(found.truncated).toBe(false);
    expect(found.matches).toHaveLength(2);
    expect(found.matches[0]?.excerpt.length).toBeLessThanOrEqual(120);
  });

  it("validate lists an orphan and still succeeds", () => {
    const text =
      "No anchor left.\n\n<!-- pmk:review v1 -->\n" +
      "<!--pmk:c aaaaaaaa\nAda (human) · 2026-11-13 12:00:00 +00:00\n> missing\n\nOrphan note.\n-->\n" +
      "<!-- /pmk:review -->\n";
    expect(validateText(text)).toEqual({ ok: true, orphans: ["aaaaaaaa"] });
  });

  it("validate fails a second review block", () => {
    const text =
      "<!-- pmk:review v1 -->\n<!--pmk:c aaaaaaaa\nAda (human) · 2026-11-13 12:00:00 +00:00\n> q\n\nbody\n-->\n<!-- /pmk:review -->\n\n" +
      "Body.\n\n<!-- pmk:review v1 -->\n<!-- /pmk:review -->\n";
    const out = validateText(text);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.corruption).toBe("secondReviewBlock");
  });

  it("lists a reply under its parent", () => {
    const placed = plan("The eventual consistency model waits.\n", [
      { quote: "eventual consistency", body: "Name the failure mode." },
    ]);
    const replied = plan(placed.text ?? "", [
      { quote: "eventual consistency", body: "A follow-up." },
    ]);
    const listed = listComments(replied.text ?? "");
    expect("comments" in listed).toBe(true);
    if ("comments" in listed) {
      expect(listed.comments).toHaveLength(2);
      expect(listed.comments[1]?.parentId).toBe(listed.comments[0]?.id);
    }
  });

  it("resolve of a root removes the anchor and the replies", () => {
    const placed = plan("The eventual consistency model waits.\n", [
      { quote: "eventual consistency", body: "Name the failure mode." },
    ]);
    const replied = plan(placed.text ?? "", [
      { quote: "eventual consistency", body: "A follow-up." },
    ]);
    const rootId = placed.results[0]?.id ?? "";
    const out = planResolve(replied.text ?? "", rootId);
    expect(out.code).toBe(0);
    expect(out.removed[0]).toBe(rootId);
    expect(out.removed).toHaveLength(2);
    expect(out.text).toBe("The eventual consistency model waits.\n");
  });

  it("resolve of a reply leaves the root", () => {
    const placed = plan("The eventual consistency model waits.\n", [
      { quote: "eventual consistency", body: "Name the failure mode." },
    ]);
    const replied = plan(placed.text ?? "", [
      { quote: "eventual consistency", body: "A follow-up." },
    ]);
    const replyId = replied.results[0]?.id ?? "";
    const out = planResolve(replied.text ?? "", replyId);
    expect(out.code).toBe(0);
    expect(out.removed).toEqual([replyId]);
    expect(parseDoc(out.text ?? "").entries.map((e) => e.id)).toEqual([placed.results[0]?.id]);
    expect(parseDoc(out.text ?? "").anchors.size).toBe(1);
  });

  it("resolve of an unknown id removes nothing", () => {
    const out = planResolve("Plain.\n", "aaaaaaaa");
    expect(out.code).toBe(2);
    expect(out.text).toBeNull();
  });
});
