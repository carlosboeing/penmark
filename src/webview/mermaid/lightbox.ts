/**
 * Mermaid diagram lightbox (T9).
 *
 * Opens a rendered diagram SVG in a full-size <dialog> with pan/zoom via
 * svg-pan-zoom. The dialog closes on Esc (the native <dialog> default) or by
 * clicking the backdrop / close button.
 *
 * ADR 0001: no vscode imports — pure browser DOM code.
 * CSP: no inline styles. All styling is class-based (media/penmark.css).
 * The SVG cloned in here is mermaid output rendered under securityLevel:"strict",
 * so cloning it into the dialog is safe.
 */

import svgPanZoom from "svg-pan-zoom";
import { adaptMermaidDarkBackgrounds, rehydrateMermaidInlineStyles } from "./styleRehydration.js";

let _dialog: HTMLDialogElement | null = null;
let _panZoom: SvgPanZoom.Instance | null = null;

/** Tear down the current pan/zoom instance, if any. */
function destroyPanZoom(): void {
  if (_panZoom) {
    try {
      _panZoom.destroy();
    } catch {
      // svg-pan-zoom can throw if the SVG was already removed — ignore.
    }
    _panZoom = null;
  }
}

/** Lazily create the singleton dialog and wire its close behaviour. */
function ensureDialog(): HTMLDialogElement {
  if (_dialog) return _dialog;

  const dialog = document.createElement("dialog");
  dialog.id = "pmk-mermaid-lightbox";
  dialog.className = "pmk-mermaid-lightbox";

  const toolbar = document.createElement("div");
  toolbar.className = "pmk-mermaid-lightbox-toolbar";

  for (const { label, action, aria } of [
    { label: "Zoom out", action: "zoom-out", aria: "Zoom out" },
    { label: "Zoom in", action: "zoom-in", aria: "Zoom in" },
    { label: "Fit", action: "fit", aria: "Fit diagram to view" },
  ] as const) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pmk-mermaid-lightbox-btn";
    btn.textContent = label;
    btn.setAttribute("data-pmk-action", action);
    btn.setAttribute("aria-label", aria);
    toolbar.appendChild(btn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "pmk-mermaid-lightbox-btn pmk-mermaid-lightbox-close";
  closeBtn.textContent = "Close";
  closeBtn.setAttribute("aria-label", "Close diagram");
  closeBtn.addEventListener("click", () => dialog.close());
  toolbar.appendChild(closeBtn);

  toolbar.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const action = target.getAttribute("data-pmk-action");
    if (!action || !_panZoom) return;
    switch (action) {
      case "zoom-in":
        _panZoom.zoomIn();
        break;
      case "zoom-out":
        _panZoom.zoomOut();
        break;
      case "fit":
        _panZoom.reset();
        break;
    }
  });

  const stage = document.createElement("div");
  stage.className = "pmk-mermaid-lightbox-stage";

  dialog.appendChild(toolbar);
  dialog.appendChild(stage);

  // Clicking the backdrop (outside the stage/toolbar) closes the dialog.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  // Clean up pan/zoom and the cloned SVG whenever the dialog closes.
  dialog.addEventListener("close", () => {
    destroyPanZoom();
    stage.replaceChildren();
  });

  document.body.appendChild(dialog);
  _dialog = dialog;
  return dialog;
}

/**
 * Open the lightbox for a rendered diagram. Clones the source SVG into the
 * dialog (so the inline diagram is untouched) and enables pan/zoom.
 *
 * @param sourceSvg The already-rendered diagram <svg> to display enlarged.
 * @param theme     Resolved preview theme, so the clone gets the same dark-mode
 *                  background adaptation as the inline diagram.
 */
export function openLightbox(sourceSvg: SVGElement, theme: "light" | "dark" = "light"): void {
  const dialog = ensureDialog();
  const stage = dialog.querySelector<HTMLElement>(".pmk-mermaid-lightbox-stage");
  if (!stage) return;

  destroyPanZoom();
  stage.replaceChildren();

  const clone = sourceSvg.cloneNode(true) as SVGSVGElement;
  // svg-pan-zoom needs the SVG to fill its container; size via class, not inline.
  clone.removeAttribute("width");
  clone.removeAttribute("height");
  clone.removeAttribute("style");
  clone.classList.add("pmk-mermaid-lightbox-svg");
  stage.appendChild(clone);
  // Cloned style= attributes are not reliably honoured under the nonce CSP;
  // re-apply mermaid's allowlisted inline styles to the clone via the CSSOM, then
  // re-run the dark-background adaptation so the modal matches the inline diagram.
  rehydrateMermaidInlineStyles(clone);
  adaptMermaidDarkBackgrounds(clone, theme === "dark");

  dialog.showModal();

  // Initialise pan/zoom after the dialog is visible so dimensions are known.
  _panZoom = svgPanZoom(clone, {
    zoomEnabled: true,
    panEnabled: true,
    // Built-in svg-pan-zoom glyphs are hard-coded black SVG shapes — unreadable in
    // our themed lightbox; use the labeled toolbar buttons instead.
    controlIconsEnabled: false,
    fit: true,
    center: true,
    minZoom: 0.2,
    maxZoom: 20,
  });
}
