import { beforeEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { activate } from "./extension.js";

const seam = vscode as unknown as {
  commands: {
    _registrations: Array<{ command: string; callback: (...args: unknown[]) => unknown }>;
  };
  window: {
    _registerCustomEditorProviderCalls: Array<{
      viewType: string;
      provider: unknown;
      options: unknown;
    }>;
  };
};

beforeEach(() => {
  seam.commands._registrations.length = 0;
  seam.window._registerCustomEditorProviderCalls.length = 0;
});

describe("activate — custom editor native Find", () => {
  it("registers the stable in-preview find command", () => {
    const subscriptions: vscode.Disposable[] = [];

    activate({ subscriptions } as unknown as vscode.ExtensionContext);

    expect(seam.commands._registrations.map((registration) => registration.command)).toContain(
      "penmark.find",
    );
  });

  it("enables native Find without retaining hidden custom-editor webviews", () => {
    const subscriptions: vscode.Disposable[] = [];

    activate({ subscriptions } as unknown as vscode.ExtensionContext);

    expect(seam.window._registerCustomEditorProviderCalls).toHaveLength(1);
    const registration = seam.window._registerCustomEditorProviderCalls[0];
    expect(registration?.viewType).toBe("penmark.previewEditor");
    expect(registration?.options).toEqual({
      webviewOptions: {
        enableFindWidget: true,
        retainContextWhenHidden: false,
      },
      supportsMultipleEditorsPerDocument: true,
    });
  });
});
