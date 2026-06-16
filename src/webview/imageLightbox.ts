/**
 * Image lightbox — full-screen zoomable view for preview images (v1.0 polish).
 */

let _dialog: HTMLDialogElement | null = null;
let _scale = 1;

function ensureDialog(): HTMLDialogElement {
  if (_dialog) return _dialog;

  const dialog = document.createElement("dialog");
  dialog.id = "pmk-image-lightbox";
  dialog.className = "pmk-mermaid-lightbox pmk-image-lightbox";

  const toolbar = document.createElement("div");
  toolbar.className = "pmk-mermaid-lightbox-toolbar";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "pmk-mermaid-lightbox-close";
  closeBtn.textContent = "Close";
  closeBtn.setAttribute("aria-label", "Close image");
  closeBtn.addEventListener("click", () => dialog.close());
  toolbar.appendChild(closeBtn);

  const stage = document.createElement("div");
  stage.className = "pmk-mermaid-lightbox-stage pmk-image-lightbox-stage";

  dialog.appendChild(toolbar);
  dialog.appendChild(stage);

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  dialog.addEventListener("close", () => {
    stage.replaceChildren();
    _scale = 1;
  });

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const img = stage.querySelector("img");
    if (!img) return;
    _scale = Math.min(5, Math.max(0.25, _scale + (e.deltaY < 0 ? 0.1 : -0.1)));
    img.style.transform = `scale(${_scale})`;
  });

  document.body.appendChild(dialog);
  _dialog = dialog;
  return dialog;
}

/** Open the lightbox for a preview image. */
export function openImageLightbox(src: string, alt: string): void {
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

  dialog.showModal();
}

/** Delegated click handler: open lightbox when an image inside root is clicked. */
export function installImageLightbox(root: HTMLElement): void {
  root.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (target.closest(".pmk-mermaid-lightbox")) return;
    e.preventDefault();
    openImageLightbox(target.currentSrc || target.src, target.alt);
  });
}
