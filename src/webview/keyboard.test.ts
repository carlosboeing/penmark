import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeTopmostPenmarkSurface,
  registerPenmarkSurface,
} from "./keyboard.js";

describe("Penmark transient surface coordination", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("Escape closes exactly the topmost owned surface", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    document.body.append(first, second);
    registerPenmarkSurface(first, null, firstClose);
    registerPenmarkSurface(second, null, secondClose);
    second.tabIndex = -1;
    second.focus();

    second.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(secondClose).toHaveBeenCalledOnce();
    expect(firstClose).not.toHaveBeenCalled();
  });

  it("does not consume Escape when focus and event path are outside Penmark surfaces", () => {
    const surface = document.createElement("div");
    const outside = document.createElement("input");
    const close = vi.fn();
    document.body.append(surface, outside);
    registerPenmarkSurface(surface, null, close);
    outside.focus();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

    outside.dispatchEvent(event);

    expect(close).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("restores focus only to a connected focusable opener", () => {
    const opener = document.createElement("button");
    const surface = document.createElement("div");
    document.body.append(opener, surface);
    const unregister = registerPenmarkSurface(surface, opener, vi.fn());

    unregister();
    expect(document.activeElement).toBe(opener);

    const detached = document.createElement("button");
    const second = document.createElement("div");
    document.body.appendChild(second);
    const unregisterSecond = registerPenmarkSurface(second, detached, vi.fn());
    unregisterSecond();
    expect(document.activeElement).not.toBe(detached);
  });

  it("restores focus to a replacement topbar control with the same stable identity", () => {
    const opener = document.createElement("button");
    opener.dataset.pmkTopbarControl = "comments";
    const surface = document.createElement("div");
    document.body.append(opener, surface);
    const unregister = registerPenmarkSurface(surface, opener, vi.fn());
    opener.remove();
    const replacement = document.createElement("button");
    replacement.dataset.pmkTopbarControl = "comments";
    document.body.appendChild(replacement);

    unregister();

    expect(document.activeElement).toBe(replacement);
  });

  it("can close the topmost surface without restoring focus during replacement", () => {
    const opener = document.createElement("button");
    const surface = document.createElement("div");
    document.body.append(opener, surface);
    const close = vi.fn();
    registerPenmarkSurface(surface, opener, close);

    expect(closeTopmostPenmarkSurface(false)).toBe(true);

    expect(close).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(opener);
  });
});
