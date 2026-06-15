import { describe, it, expect } from "vitest";
// sentinel: verifies the webview test layer runs in jsdom and acquireVsCodeApi mock is present.

describe("webview sentinel", () => {
  it("runs in jsdom environment with DOM", () => {
    expect(typeof window).toBe("object");
    expect(typeof document).toBe("object");
  });

  it("acquireVsCodeApi mock is installed by setup file", () => {
    const acquire = (globalThis as Record<string, unknown>)["acquireVsCodeApi"];
    expect(typeof acquire).toBe("function");
    const api = (acquire as () => { postMessage: (m: unknown) => void })();
    expect(typeof api.postMessage).toBe("function");
  });

  it("postMessage calls are recorded on the mock", () => {
    const mock = (globalThis as Record<string, unknown>)["__vsCodeApiMock"] as {
      _messages: unknown[];
      postMessage: (m: unknown) => void;
    };
    const before = mock._messages.length;
    mock.postMessage({ type: "test-sentinel" });
    expect(mock._messages.length).toBe(before + 1);
    expect(mock._messages[mock._messages.length - 1]).toEqual({ type: "test-sentinel" });
  });

  it("importing src/webview/main posts a ready message", async () => {
    // Reset recorded messages before import so we can assert on just this call.
    const mock = (globalThis as Record<string, unknown>)["__vsCodeApiMock"] as {
      _messages: unknown[];
    };
    mock._messages.length = 0;
    await import("../../../src/webview/main.js");
    // main.ts calls vscode.postMessage({ v: 1, type: "ready" }) per the versioned protocol.
    expect(mock._messages).toContainEqual({ v: 1, type: "ready" });
  });
});
