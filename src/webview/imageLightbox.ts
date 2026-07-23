/**
 * Image lightbox — full-screen zoomable view for preview images (v1.0 polish).
 */

let _dialog: HTMLDialogElement | null = null;
let _scale = 1;
let _opener: HTMLElement | null = null;

const _installedRoots = new WeakSet<HTMLElement>();
const _generatedImageLabels = new WeakSet<HTMLImageElement>();

function isFocusable(el: HTMLElement): boolean {
  return el.isConnected && !el.hidden && !el.closest("[inert]") && el.tabIndex >= 0;
}

function focusableControls(dialog: HTMLDialogElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ),
  ).filter((el) => !el.hidden && !el.closest("[inert]"));
}

function trapDialogFocus(dialog: HTMLDialogElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const controls = focusableControls(dialog);
  if (controls.length === 0) return;
  const first = controls[0]!;
  const last = controls.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function isLightboxImage(root: HTMLElement, image: HTMLImageElement): boolean {
  return root.contains(image) && image.closest(".pmk-mermaid") === null;
}

function prepareImageTrigger(image: HTMLImageElement): void {
  if (image.getAttribute("role") !== "button") image.setAttribute("role", "button");
  if (image.tabIndex !== 0) image.tabIndex = 0;
  const label = image.getAttribute("aria-label")?.trim() ?? "";
  if (_generatedImageLabels.has(image) && label !== "Open image preview") {
    _generatedImageLabels.delete(image);
  }
  if (!image.alt.trim() && !label) {
    image.setAttribute("aria-label", "Open image preview");
    _generatedImageLabels.add(image);
  } else if (image.alt.trim() && _generatedImageLabels.has(image)) {
    image.removeAttribute("aria-label");
    _generatedImageLabels.delete(image);
  }
}

function applyScale(img: HTMLImageElement): void {
  if (_scale === 1) {
    img.style.removeProperty("transform");
  } else {
    img.style.transform = `scale(${_scale})`;
  }
}

function toolbarButton(label: string, action: string, aria: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pmk-mermaid-lightbox-btn";
  btn.textContent = label;
  btn.setAttribute("data-pmk-action", action);
  btn.setAttribute("aria-label", aria);
  return btn;
}

function ensureDialog(): HTMLDialogElement {
  if (_dialog) return _dialog;

  const dialog = document.createElement("dialog");
  dialog.id = "pmk-image-lightbox";
  dialog.className = "pmk-mermaid-lightbox pmk-image-lightbox";
  dialog.setAttribute("aria-label", "Image preview");

  const toolbar = document.createElement("div");
  toolbar.className = "pmk-mermaid-lightbox-toolbar";

  toolbar.append(
    toolbarButton("Zoom out", "zoom-out", "Zoom out"),
    toolbarButton("Zoom in", "zoom-in", "Zoom in"),
    toolbarButton("Fit", "fit", "Fit image to view"),
  );

  const closeBtn = toolbarButton("Close", "close", "Close image");
  closeBtn.classList.add("pmk-mermaid-lightbox-close");
  closeBtn.addEventListener("click", () => dialog.close());
  toolbar.appendChild(closeBtn);

  const stage = document.createElement("div");
  stage.className = "pmk-mermaid-lightbox-stage pmk-image-lightbox-stage";

  dialog.appendChild(toolbar);
  dialog.appendChild(stage);

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // Keep underlying document-level surfaces from consuming the same key.
      // Do not preventDefault: native dialog cancellation remains authoritative.
      e.stopPropagation();
      return;
    }
    trapDialogFocus(dialog, e);
  });

  dialog.addEventListener("close", () => {
    const opener = _opener;
    const active = document.activeElement;
    const shouldRestore =
      active === document.body || active === dialog || dialog.contains(active) || active === opener;
    stage.replaceChildren();
    _scale = 1;
    _opener = null;
    if (opener && shouldRestore && isFocusable(opener)) opener.focus();
  });

  toolbar.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const img = stage.querySelector("img");
    if (!img) return;
    switch (target.getAttribute("data-pmk-action")) {
      case "zoom-in":
        _scale = Math.min(5, _scale + 0.2);
        applyScale(img);
        break;
      case "zoom-out":
        _scale = Math.max(0.25, _scale - 0.2);
        applyScale(img);
        break;
      case "fit":
        _scale = 1;
        applyScale(img);
        break;
    }
  });

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const img = stage.querySelector("img");
    if (!img) return;
    _scale = Math.min(5, Math.max(0.25, _scale + (e.deltaY < 0 ? 0.1 : -0.1)));
    applyScale(img);
  });

  document.body.appendChild(dialog);
  _dialog = dialog;
  return dialog;
}

/** Open the lightbox for a preview image. */
export function openImageLightbox(src: string, alt: string, opener?: HTMLElement | null): void {
  const dialog = ensureDialog();
  const stage = dialog.querySelector<HTMLElement>(".pmk-image-lightbox-stage");
  if (!stage) return;

  stage.replaceChildren();
  _scale = 1;

  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.className = "pmk-image-lightbox-img";
  stage.appendChild(img);

  _opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('[data-pmk-action="close"]')?.focus();
}

/** Delegated click handler: open lightbox when an image inside root is clicked. */
export function installImageLightbox(root: HTMLElement): void {
  if (_installedRoots.has(root)) return;
  _installedRoots.add(root);

  const prepareImages = (scope: ParentNode): void => {
    if (scope instanceof HTMLImageElement && isLightboxImage(root, scope)) {
      prepareImageTrigger(scope);
    }
    for (const image of scope.querySelectorAll<HTMLImageElement>("img")) {
      if (isLightboxImage(root, image)) prepareImageTrigger(image);
    }
  };
  prepareImages(root);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLImageElement) {
        if (isLightboxImage(root, record.target)) prepareImageTrigger(record.target);
      }
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) prepareImages(node);
      }
    }
  });
  observer.observe(root, {
    attributes: true,
    attributeFilter: ["alt", "aria-label", "role", "tabindex"],
    childList: true,
    subtree: true,
  });

  root.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (!isLightboxImage(root, target)) return;
    e.preventDefault();
    openImageLightbox(target.currentSrc || target.src, target.alt, target);
  });

  root.addEventListener("keydown", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLImageElement) || !isLightboxImage(root, target)) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openImageLightbox(target.currentSrc || target.src, target.alt, target);
  });
}
