// jsdom layer: stub acquireVsCodeApi so webview code can call it without a real host.
// The stub records postMessage calls for inspection in tests.

interface VsCodeApiMock {
  postMessage: (msg: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
  _messages: unknown[];
}

const mock: VsCodeApiMock = {
  _messages: [],
  postMessage(msg: unknown) {
    this._messages.push(msg);
  },
  getState() {
    return undefined;
  },
  setState(state: unknown) {
    void state; // no-op in tests; parameter kept to satisfy VsCodeApiMock interface
  },
};

(globalThis as Record<string, unknown>)["acquireVsCodeApi"] = () => mock;
(globalThis as Record<string, unknown>)["__vsCodeApiMock"] = mock;
