/**
 * jsdom tests for the export options dialog (R17): defaults reflected,
 * per-kind fields, and the confirmed exportRequest payload.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ExportOptions, WebviewToHost } from "../core/protocol/messages.js";
import {
  closeExportDialog,
  ensureExportDialog,
  isExportDialogOpen,
  openExportDialog,
} from "./exportDialog.js";

const DEFAULTS: ExportOptions = {
  includeFrontmatter: false,
  includeToc: false,
  width: "full",
  pdfPageSize: "a4",
  pdfMargin: "normal",
  pdfHeaderFooter: true,
};

// jsdom has no dialog implementation — polyfill the bits the module uses.
beforeEach(() => {
  document.body.innerHTML = "";
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

function groupEl(dialog: HTMLElement, group: string): HTMLElement | null {
  const legends = [...dialog.querySelectorAll("legend")];
  return legends.find((l) => l.textContent === group)?.closest("fieldset") ?? null;
}

/** Click an option inside a named group ("wide" exists in Width AND Margins). */
function pick(dialog: HTMLElement, group: string, value: string): void {
  (groupEl(dialog, group)?.querySelector(`button[data-value="${value}"]`) as HTMLElement).click();
}

function pressed(dialog: HTMLElement, group: string, value: string): boolean {
  return (
    groupEl(dialog, group)
      ?.querySelector(`button[data-value="${value}"]`)
      ?.getAttribute("aria-pressed") === "true"
  );
}

describe("export dialog", () => {
  it("opens with the provided defaults and closes on cancel", () => {
    const post = vi.fn();
    const el = ensureExportDialog(post);
    openExportDialog("html", DEFAULTS);
    expect(isExportDialogOpen()).toBe(true);

    expect(pressed(el, "Format", "html")).toBe(true);
    expect(pressed(el, "Width", "full")).toBe(true);
    // HTML export shows no PDF-only groups.
    expect([...el.querySelectorAll("legend")].map((l) => l.textContent)).not.toContain("Page size");

    (
      [...el.querySelectorAll("button")].find((b) => b.textContent === "Cancel") as HTMLElement
    ).click();
    expect(isExportDialogOpen()).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it("switching to PDF reveals page size, margins, and header/footer", () => {
    const el = ensureExportDialog(vi.fn());
    openExportDialog("html", DEFAULTS);
    (el.querySelector('button[data-value="pdf"]') as HTMLElement).click();

    const legends = [...el.querySelectorAll("legend")].map((l) => l.textContent);
    expect(legends).toContain("Page size");
    expect(legends).toContain("Margins");
    expect(legends).toContain("Page chrome");
    expect(pressed(el, "Page size", "a4")).toBe(true);
    expect(pressed(el, "Margins", "normal")).toBe(true);
  });

  it("posts exportRequest with the chosen options on confirm", () => {
    const posted: WebviewToHost[] = [];
    const el = ensureExportDialog((m) => posted.push(m));
    openExportDialog("pdf", DEFAULTS);

    // Tweak: include TOC, comfortable width, letter, wide margins, no chrome.
    const tocCheckbox = [...el.querySelectorAll("label")]
      .find((l) => l.textContent?.includes("Table of contents"))!
      .querySelector("input")!;
    tocCheckbox.checked = true;
    tocCheckbox.dispatchEvent(new Event("change"));
    pick(el, "Width", "comfortable");
    pick(el, "Page size", "letter");
    pick(el, "Margins", "wide");
    const chrome = [...el.querySelectorAll("label")]
      .find((l) => l.textContent?.includes("Header and page numbers"))!
      .querySelector("input")!;
    chrome.checked = false;
    chrome.dispatchEvent(new Event("change"));

    (
      [...el.querySelectorAll("button")].find((b) => b.textContent === "Export PDF") as HTMLElement
    ).click();

    expect(posted).toEqual([
      {
        v: 1,
        type: "exportRequest",
        kind: "pdf",
        options: {
          includeFrontmatter: false,
          includeToc: true,
          width: "comfortable",
          pdfPageSize: "letter",
          pdfMargin: "wide",
          pdfHeaderFooter: false,
        },
      },
    ]);
    expect(isExportDialogOpen()).toBe(false);
    // The provided defaults object is never mutated.
    expect(DEFAULTS.includeToc).toBe(false);
    closeExportDialog();
  });
});
