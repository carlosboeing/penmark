import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = "";
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

describe("image lightbox accessibility", () => {
  it("makes only lightbox images named keyboard triggers without duplicate activation", async () => {
    const { installImageLightbox } = await import("./imageLightbox.js");
    const root = document.createElement("main");
    root.innerHTML =
      '<img id="named" src="named.png" alt="Architecture overview">' +
      '<img id="unnamed" src="unnamed.png" alt="">' +
      '<div class="pmk-mermaid"><img id="diagram" src="diagram.png" alt="Diagram fallback"></div>';
    document.body.appendChild(root);

    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    installImageLightbox(root);
    installImageLightbox(root);

    const named = root.querySelector<HTMLImageElement>("#named")!;
    const unnamed = root.querySelector<HTMLImageElement>("#unnamed")!;
    const diagram = root.querySelector<HTMLImageElement>("#diagram")!;
    expect(named.getAttribute("role")).toBe("button");
    expect(named.getAttribute("tabindex")).toBe("0");
    expect(named.hasAttribute("aria-label")).toBe(false);
    expect(unnamed.getAttribute("aria-label")).toBe("Open image preview");
    expect(diagram.hasAttribute("role")).toBe(false);
    expect(diagram.hasAttribute("tabindex")).toBe(false);

    named.removeAttribute("role");
    named.removeAttribute("tabindex");
    await Promise.resolve();
    expect(named.getAttribute("role")).toBe("button");
    expect(named.getAttribute("tabindex")).toBe("0");

    named.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(showModal).toHaveBeenCalledTimes(1);
    document.querySelector<HTMLDialogElement>("#pmk-image-lightbox")!.close();

    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    unnamed.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(showModal).toHaveBeenCalledTimes(2);
  });

  it("names the dialog, focuses Close, and restores the exact opener", async () => {
    const { openImageLightbox } = await import("./imageLightbox.js");
    const opener = document.createElement("img");
    opener.alt = "Architecture overview";
    opener.tabIndex = 0;
    document.body.appendChild(opener);
    opener.focus();

    openImageLightbox("architecture.png", "Architecture overview", opener);

    const dialog = document.querySelector<HTMLDialogElement>("#pmk-image-lightbox")!;
    expect(dialog.getAttribute("aria-label")).toBe("Image preview");
    expect(document.activeElement).toBe(
      dialog.querySelector<HTMLButtonElement>('[data-pmk-action="close"]'),
    );

    dialog.querySelector<HTMLButtonElement>('[data-pmk-action="close"]')!.click();
    expect(document.activeElement).toBe(opener);
  });

  it("preserves an author-provided label that matches the generated fallback", async () => {
    const { installImageLightbox } = await import("./imageLightbox.js");
    const root = document.createElement("main");
    root.innerHTML = '<img src="architecture.png" alt="" aria-label="Open image preview">';
    document.body.appendChild(root);
    installImageLightbox(root);

    const image = root.querySelector("img")!;
    image.alt = "Architecture overview";
    await Promise.resolve();

    expect(image.getAttribute("aria-label")).toBe("Open image preview");
  });

  it("leaves native cancel unprevented and restores focus on close without stealing it", async () => {
    const { openImageLightbox } = await import("./imageLightbox.js");
    const opener = document.createElement("button");
    const otherSurfaceControl = document.createElement("button");
    document.body.append(opener, otherSurfaceControl);

    openImageLightbox("architecture.png", "Architecture overview", opener);
    const dialog = document.querySelector<HTMLDialogElement>("#pmk-image-lightbox")!;
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(false);
    // jsdom does not implement the native cancel default action, so simulate
    // the close event that Chromium dispatches after an unprevented cancel.
    dialog.close();
    expect(document.activeElement).toBe(opener);

    openImageLightbox("architecture.png", "Architecture overview", opener);
    otherSurfaceControl.focus();
    dialog.close();
    expect(document.activeElement).toBe(otherSurfaceControl);
  });
});
