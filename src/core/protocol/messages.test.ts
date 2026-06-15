import { describe, it, expect } from "vitest";
import { PROTOCOL_VERSION } from "./messages.js";
import type {
  HostToWebview,
  WebviewToHost,
  WireComment,
  WireExtent,
} from "./messages.js";

describe("protocol/messages", () => {
  it("PROTOCOL_VERSION is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("WireExtent carries line/col bounds", () => {
    const extent: WireExtent = {
      startLine: 1,
      startCol: 0,
      endLine: 1,
      endCol: 10,
    };
    expect(extent.endCol).toBe(10);
  });

  it("WireComment models a review comment with a nullable extent", () => {
    const intact: WireComment = {
      id: "c1",
      state: "intact",
      provenance: "human",
      author: "carlos",
      timestamp: "2026-06-14T00:00:00Z",
      quote: "the quoted span",
      body: "looks good",
      extent: { startLine: 2, startCol: 4, endLine: 2, endCol: 19 },
    };
    const orphan: WireComment = {
      id: "c2",
      state: "orphan",
      provenance: "agent",
      author: "claude",
      timestamp: "2026-06-14T00:01:00Z",
      quote: "",
      body: "context removed",
      extent: null,
    };
    expect(intact.extent).not.toBeNull();
    expect(orphan.extent).toBeNull();
  });

  it("render message carries comments and attention", () => {
    const msg: HostToWebview = {
      v: 1,
      type: "render",
      html: "<p>hi</p>",
      theme: "auto",
      docName: "doc.md",
      comments: [],
      attention: 0,
    };
    if (msg.type === "render") {
      expect(msg.comments).toEqual([]);
      expect(msg.attention).toBe(0);
    }
  });

  it("comments message is a reconcile-only update", () => {
    const msg: HostToWebview = {
      v: 1,
      type: "comments",
      comments: [],
      attention: 3,
    };
    if (msg.type === "comments") {
      expect(msg.attention).toBe(3);
    }
  });

  it("WebviewToHost has the new mutation messages", () => {
    const add: WebviewToHost = {
      v: 1,
      type: "addComment",
      range: { start: 0, end: 12 },
      quote: "hi",
      body: "note",
    };
    const resolve: WebviewToHost = { v: 1, type: "resolveComment", id: "c1" };
    const jump: WebviewToHost = { v: 1, type: "jumpToSource", id: "c1" };
    const exportReview: WebviewToHost = { v: 1, type: "exportReview" };
    expect([add.type, resolve.type, jump.type, exportReview.type]).toEqual([
      "addComment",
      "resolveComment",
      "jumpToSource",
      "exportReview",
    ]);
  });

  it("exhaustively narrows every HostToWebview variant", () => {
    const assertNever = (x: never): never => {
      throw new Error(`unexpected host message: ${JSON.stringify(x)}`);
    };
    const handle = (msg: HostToWebview): string => {
      switch (msg.type) {
        case "render":
          return msg.type;
        case "comments":
          return msg.type;
        case "setTheme":
          return msg.type;
        case "setContentWidth":
          return msg.type;
        case "revealLine":
          return msg.type;
        case "copied":
          return msg.type;
        default:
          return assertNever(msg);
      }
    };
    expect(handle({ v: 1, type: "comments", comments: [], attention: 0 })).toBe(
      "comments",
    );
  });

  it("exhaustively narrows every WebviewToHost variant", () => {
    const assertNever = (x: never): never => {
      throw new Error(`unexpected webview message: ${JSON.stringify(x)}`);
    };
    const handle = (msg: WebviewToHost): string => {
      switch (msg.type) {
        case "ready":
          return msg.type;
        case "scrolled":
          return msg.type;
        case "copyCode":
          return msg.type;
        case "openLink":
          return msg.type;
        case "themeSelected":
          return msg.type;
        case "addComment":
          return msg.type;
        case "resolveComment":
          return msg.type;
        case "jumpToSource":
          return msg.type;
        case "exportReview":
          return msg.type;
        default:
          return assertNever(msg);
      }
    };
    expect(handle({ v: 1, type: "exportReview" })).toBe("exportReview");
  });
});
