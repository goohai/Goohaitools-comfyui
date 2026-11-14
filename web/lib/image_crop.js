const ratios = ["自由", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9", "1:2", "2:1"];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
let cancelActiveCrop = null;
let activeCropKey = null;

export function cancelCrop() { cancelActiveCrop?.(); }

export function handleCropKey(event) {
  return activeCropKey?.(event) || false;
}

export function resizeRect(rect, handle, point, ratio, width, height, symmetric = false) {
  let left = rect.x, top = rect.y, right = left + rect.w, bottom = top + rect.h;
  if (symmetric) {
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    const horizontal = /[we]/.test(handle), vertical = /[ns]/.test(handle);
    const maxW = Math.min(cx, width - cx), maxH = Math.min(cy, height - cy);
    let halfW = horizontal ? Math.max(.5, (handle.includes("w") ? -1 : 1) * (point.x - cx)) : rect.w / 2;
    let halfH = vertical ? Math.max(.5, (handle.includes("n") ? -1 : 1) * (point.y - cy)) : rect.h / 2;
    if (ratio) {
      halfW = horizontal ? (vertical ? Math.max(halfW, halfH * ratio) : halfW) : halfH * ratio;
      halfW = Math.min(halfW, maxW, maxH * ratio);
      halfH = halfW / ratio;
    } else {
      halfW = Math.min(halfW, maxW);
      halfH = Math.min(halfH, maxH);
    }
    return { x: cx - halfW, y: cy - halfH, w: halfW * 2, h: halfH * 2 };
  }
  if (!ratio) {
    if (handle.includes("w")) left = clamp(point.x, 0, right - 1);
    if (handle.includes("e")) right = clamp(point.x, left + 1, width);
    if (handle.includes("n")) top = clamp(point.y, 0, bottom - 1);
    if (handle.includes("s")) bottom = clamp(point.y, top + 1, height);
    return { x: left, y: top, w: right - left, h: bottom - top };
  }
  const horizontal = /[we]/.test(handle), vertical = /[ns]/.test(handle);
  const anchorX = handle.includes("w") ? right : horizontal ? left : (left + right) / 2;
  const anchorY = handle.includes("n") ? bottom : vertical ? top : (top + bottom) / 2;
  const signX = handle.includes("w") ? -1 : 1, signY = handle.includes("n") ? -1 : 1;
  let w = horizontal ? Math.max(1, signX * (point.x - anchorX)) : Math.max(1, signY * (point.y - anchorY)) * ratio;
  if (horizontal && vertical) w = Math.max(w, Math.max(1, signY * (point.y - anchorY)) * ratio);
  const maxW = horizontal ? (signX > 0 ? width - anchorX : anchorX) : 2 * Math.min(anchorX, width - anchorX);
  const maxH = vertical ? (signY > 0 ? height - anchorY : anchorY) : 2 * Math.min(anchorY, height - anchorY);
  w = Math.min(w, maxW, maxH * ratio);
  const h = w / ratio;
  return { x: horizontal ? (signX < 0 ? anchorX - w : anchorX) : anchorX - w / 2,
    y: vertical ? (signY < 0 ? anchorY - h : anchorY) : anchorY - h / 2, w, h };
}

export function attachCrop({ root, box, widget, ownsEvent, zoomCanvas, getIdentity, getPreview, replacePreview, setDimensions, layout, changed, manualSelection, showError }) {
  let original = null, editing = false, rect = null, ratioName = "自由", drag = null, revision = 0;
  let spaceDown = false;
  let cursorElement = null;
  let sourceIdentity = null;
  const sample = document.createElement("canvas");
  sample.width = sample.height = 8;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  const panel = document.createElement("div");
  panel.className = "guhai-image-crop-ratios";
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "guhai-image-crop-clear";
  clearButton.textContent = "清除";
  panel.append(clearButton);
  for (const name of ratios) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.dataset.ratio = name;
    panel.append(button);
  }
  const ratioButtons = [...panel.querySelectorAll("button[data-ratio]")];
  const overlay = document.createElement("div");
  overlay.className = "guhai-image-crop-overlay";
  const selection = document.createElement("div");
  selection.className = "guhai-image-crop-selection";
  selection.innerHTML = '<div class="guhai-image-crop-thirds"></div><svg class="guhai-image-crop-center" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5.5"/><path d="M12 2v4.5M12 17.5V22M2 12h4.5M17.5 12H22"/><circle class="guhai-image-crop-center-dot" cx="12" cy="12" r="1"/></svg>';
  const mask = document.createElement("div");
  mask.className = "guhai-image-crop-mask";
  overlay.append(mask);
  for (const handle of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
    const element = document.createElement("span");
    element.className = `guhai-image-crop-handle guhai-image-crop-${handle}`;
    element.dataset.handle = handle;
    selection.append(element);
  }
  overlay.append(selection);
  box.append(panel, overlay);
  const ratio = () => ratioName === "自由" ? 0 : ratioName.split(":").reduce((a, b) => Number(a) / Number(b));
  const identityMatches = value => {
    const identity = getIdentity();
    return value?.type === identity.type && value?.image === identity.image;
  };
  const saved = () => {
    try {
      const value = JSON.parse(widget?.value || "null");
      return identityMatches(value) && Array.isArray(value.rect) && value.rect.length === 4
        && value.rect.every(Number.isFinite) && value.rect[2] > 0 && value.rect[3] > 0 ? value : null;
    } catch { return null; }
  };
  function draw() {
    ratioButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.ratio === ratioName)));
    selection.hidden = !rect;
    mask.hidden = !rect || drag?.mode === "draw";
    overlay.classList.toggle("guhai-image-crop-drawing", drag?.mode === "draw");
    if (!original) return;
    if (!rect) { setDimensions(original.naturalWidth, original.naturalHeight); return; }
    const left = clamp(Math.round(rect.x), 0, original.naturalWidth - 1);
    const top = clamp(Math.round(rect.y), 0, original.naturalHeight - 1);
    const right = clamp(Math.round(rect.x + rect.w), left + 1, original.naturalWidth);
    const bottom = clamp(Math.round(rect.y + rect.h), top + 1, original.naturalHeight);
    setDimensions(right - left, bottom - top);
    selection.style.left = `${rect.x / original.naturalWidth * 100}%`;
    selection.style.top = `${rect.y / original.naturalHeight * 100}%`;
    selection.style.width = `${rect.w / original.naturalWidth * 100}%`;
    selection.style.height = `${rect.h / original.naturalHeight * 100}%`;
    const x = rect.x / original.naturalWidth * 100, y = rect.y / original.naturalHeight * 100;
    const w = rect.w / original.naturalWidth * 100, h = rect.h / original.naturalHeight * 100;
    mask.style.clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${x}% ${y}%, ${x}% ${y + h}%, ${x + w}% ${y + h}%, ${x + w}% ${y}%, ${x}% ${y}%, 0% 0%)`;
    if (drag?.mode !== "draw") {
      const radiusX = 10 * original.naturalWidth / (parseFloat(overlay.style.width) || original.naturalWidth);
      const radiusY = 10 * original.naturalHeight / (parseFloat(overlay.style.height) || original.naturalHeight);
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
      const sx = Math.max(0, cx - radiusX), sy = Math.max(0, cy - radiusY);
      const sw = Math.min(original.naturalWidth, cx + radiusX) - sx;
      const sh = Math.min(original.naturalHeight, cy + radiusY) - sy;
      sampleContext.fillStyle = "#242833";
      sampleContext.fillRect(0, 0, 8, 8);
      sampleContext.drawImage(original, sx, sy, sw, sh, 0, 0, 8, 8);
      const pixels = sampleContext.getImageData(0, 0, 8, 8).data;
      let brightness = 0;
      for (let i = 0; i < pixels.length; i += 4) brightness += .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
      selection.style.setProperty("--guhai-image-crop-center-color", brightness / 64 < 128 ? "#fff" : "#000");
    }
  }
  function position() {
    if (!editing) return;
    const image = getPreview();
    for (const key of ["left", "top", "width", "height"]) overlay.style[key] = image.style[key];
    const minTop = box.querySelector(".guhai-image-action-row").offsetHeight + 12;
    panel.style.top = `${Math.max(minTop, Math.min(parseFloat(image.style.top) - 3, box.clientHeight - panel.offsetHeight - 6))}px`;
    draw();
  }
  async function displaySaved() {
    const current = ++revision, source = original, value = saved();
    if (!source) return;
    if (!value) { replacePreview(source); layout(); return; }
    const [x, y, w, h] = value.rect;
    const width = source.naturalWidth, height = source.naturalHeight;
    const left = clamp(Math.round(x * width), 0, width - 1), top = clamp(Math.round(y * height), 0, height - 1);
    const right = clamp(Math.round((x + w) * width), left + 1, width), bottom = clamp(Math.round((y + h) * height), top + 1, height);
    if (left === 0 && top === 0 && right === width && bottom === height) { replacePreview(source); layout(); return; }
    const canvas = document.createElement("canvas");
    canvas.width = right - left; canvas.height = bottom - top;
    canvas.getContext("2d").drawImage(source, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    const image = new Image();
    image.draggable = false;
    image.alt = source.alt;
    Object.assign(image.dataset, source.dataset);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (current !== revision || editing) return;
    image.src = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    await image.decode();
    if (current !== revision || editing) return;
    replacePreview(image); layout();
  }
  function enter() {
    if (!widget || !original || editing) return;
    cancelActiveCrop?.();
    cancelActiveCrop = cancel;
    activeCropKey = keyDown;
    revision++;
    const value = saved();
    ratioName = value && ratios.includes(value.ratio) ? value.ratio : "自由";
    rect = value ? { x: value.rect[0] * original.naturalWidth, y: value.rect[1] * original.naturalHeight,
      w: value.rect[2] * original.naturalWidth, h: value.rect[3] * original.naturalHeight }
      : { x: original.naturalWidth / 6, y: 0, w: original.naturalWidth * 2 / 3, h: original.naturalHeight * 2 / 3 };
    editing = true;
    root.classList.add("guhai-image-cropping");
    replacePreview(original);
    layout();
  }
  function leave(confirm, manual = true) {
    if (!editing) return;
    if (confirm && !identityMatches(sourceIdentity)) { cancel(); return; }
    if (confirm && (!rect || rect.w < 1 || rect.h < 1)) return;
    if (confirm) {
      const { type, image } = getIdentity();
      widget.value = JSON.stringify({ type, image, ratio: ratioName,
        rect: [rect.x / original.naturalWidth, rect.y / original.naturalHeight, rect.w / original.naturalWidth, rect.h / original.naturalHeight] });
      if (manual) manualSelection();
      changed();
    }
    editing = false; drag = null;
    resetCursor();
    if (cancelActiveCrop === cancel) cancelActiveCrop = null;
    if (activeCropKey === keyDown) activeCropKey = null;
    root.classList.remove("guhai-image-cropping");
    void displaySaved().catch(showError);
    layout();
  }
  function cancel() { leave(false); }
  function clear() {
    revision++; editing = false; drag = null; rect = null; ratioName = "自由";
    resetCursor();
    if (cancelActiveCrop === cancel) cancelActiveCrop = null;
    if (activeCropKey === keyDown) activeCropKey = null;
    root.classList.remove("guhai-image-cropping");
    if (widget) widget.value = "";
    if (original) replacePreview(original);
    layout(); changed();
  }
  const contains = (event, element) => {
    const bounds = element.getBoundingClientRect();
    return event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
  };
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const point = event => {
    const bounds = overlay.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * original.naturalWidth,
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1) * original.naturalHeight };
  };
  function edgeHandle(event) {
    if (!rect) return "";
    const bounds = overlay.getBoundingClientRect();
    const left = bounds.left + rect.x / original.naturalWidth * bounds.width;
    const top = bounds.top + rect.y / original.naturalHeight * bounds.height;
    const right = left + rect.w / original.naturalWidth * bounds.width;
    const bottom = top + rect.h / original.naturalHeight * bounds.height;
    const x = event.clientX, y = event.clientY, reach = 12;
    if (x < left - reach || x > right + reach || y < top - reach || y > bottom + reach) return "";
    const vertical = Math.min(Math.abs(y - top), Math.abs(y - bottom)) <= reach
      ? Math.abs(y - top) <= Math.abs(y - bottom) ? "n" : "s" : "";
    const horizontal = Math.min(Math.abs(x - left), Math.abs(x - right)) <= reach
      ? Math.abs(x - left) <= Math.abs(x - right) ? "w" : "e" : "";
    return vertical + horizontal;
  }
  function previewArea(event) {
    return contains(event, box) && event.clientY >= box.querySelector(".guhai-image-action-row").getBoundingClientRect().bottom;
  }
  function resetCursor() {
    cursorElement?.classList.remove("guhai-image-crop-cursor");
    cursorElement = null;
  }
  function hoverCursor(event) {
    const owns = ownsEvent(event);
    ratioButtons.forEach(button => {
      button.classList.toggle("guhai-image-ratio-hover", owns && contains(event, button));
    });
    if (spaceDown || event.buttons & 4 || !owns || !previewArea(event)
      || contains(event, clearButton) || contains(event, panel)) { resetCursor(); return; }
    const handle = drag?.mode === "resize" ? drag.handle : edgeHandle(event);
    const cursors = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
      nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
    const p = point(event);
    const inside = rect && contains(event, overlay) && p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
    if (cursorElement !== event.target) resetCursor();
    cursorElement = event.target;
    cursorElement.style.setProperty("--guhai-image-crop-cursor", cursors[handle] || (inside ? "move" : "crosshair"));
    cursorElement.classList.add("guhai-image-crop-cursor");
  }
  function doubleClick(event) {
    if (spaceDown) return;
    if (event.button !== 0 || !original || !ownsEvent(event) || document.querySelector("dialog[open]") || !contains(event, editing ? overlay : getPreview())) return;
    stop(event);
    if (editing) leave(true); else enter();
  }
  function pointerDown(event) {
    if (spaceDown || event.button === 1) { drag = null; resetCursor(); return; }
    if (!editing && event.button === 0 && event.detail > 1 && original && ownsEvent(event)
      && !document.querySelector("dialog[open]") && contains(event, getPreview())) {
      stop(event); return;
    }
    if (!editing || event.button !== 0 || !ownsEvent(event) || !contains(event, box)) return;
    // Leave the gallery button usable; intercept the rest before the graph starts dragging.
    if (event.target.closest?.(".guhai-image-action-row")) { leave(false); return; }
    stop(event);
    if (contains(event, clearButton)) { clear(); return; }
    const button = ratioButtons.find(button => contains(event, button));
    if (button) {
      ratioName = button.dataset.ratio;
      if (ratio()) {
        const width = original.naturalWidth, height = original.naturalHeight;
        const w = Math.min(width, height * ratio()), h = w / ratio();
        rect = { x: (width - w) / 2, y: (height - h) / 2, w, h };
      } else if (!rect) rect = { x: 0, y: 0, w: original.naturalWidth, h: original.naturalHeight };
      draw(); return;
    }
    if (!previewArea(event) || event.detail > 1) return;
    const start = point(event);
    const handle = edgeHandle(event);
    const inside = rect && contains(event, overlay) && start.x >= rect.x && start.x <= rect.x + rect.w && start.y >= rect.y && start.y <= rect.y + rect.h;
    const mode = handle ? "resize" : inside ? "move" : "draw";
    drag = { mode, handle, start, point: start, rect: rect && { ...rect } };
    if (mode === "draw") rect = { x: start.x, y: start.y, w: 0, h: 0 };
    draw();
  }
  function pointerMove(event) {
    if (!editing) return;
    hoverCursor(event);
    if (spaceDown || event.buttons & 4) { drag = null; return; }
    if (!drag) return;
    stop(event);
    updateDrag(point(event), event.shiftKey, event.altKey);
  }
  function updateDrag(p, shiftKey, altKey) {
    drag.point = p;
    const width = original.naturalWidth, height = original.naturalHeight;
    const aspect = ratio() || (shiftKey && drag.rect?.w > 0 && drag.rect?.h > 0 ? drag.rect.w / drag.rect.h : 0);
    if (drag.mode === "move") {
      rect = { ...drag.rect, x: clamp(drag.rect.x + p.x - drag.start.x, 0, width - drag.rect.w),
        y: clamp(drag.rect.y + p.y - drag.start.y, 0, height - drag.rect.h) };
    } else if (drag.mode === "resize") rect = resizeRect(drag.rect, drag.handle, p, aspect, width, height, altKey);
    else {
      let w = Math.abs(p.x - drag.start.x), h = Math.abs(p.y - drag.start.y);
      const sx = p.x < drag.start.x ? -1 : 1, sy = p.y < drag.start.y ? -1 : 1;
      const maxW = altKey ? Math.min(drag.start.x, width - drag.start.x) : sx > 0 ? width - drag.start.x : drag.start.x;
      const maxH = altKey ? Math.min(drag.start.y, height - drag.start.y) : sy > 0 ? height - drag.start.y : drag.start.y;
      if (aspect) {
        w = Math.min(Math.max(w, h * aspect), maxW, maxH * aspect);
        h = w / aspect;
      } else {
        w = Math.min(w, maxW); h = Math.min(h, maxH);
      }
      rect = altKey ? { x: drag.start.x - w, y: drag.start.y - h, w: w * 2, h: h * 2 }
        : { x: sx < 0 ? drag.start.x - w : drag.start.x, y: sy < 0 ? drag.start.y - h : drag.start.y, w, h };
    }
    draw();
  }
  function pointerUp(event) {
    if (spaceDown || event.button === 1) { drag = null; return; }
    if (!editing || !drag) return;
    stop(event); drag = null;
    if (rect.w < 1 || rect.h < 1) rect = null;
    draw();
  }
  function keyDown(event) {
    if (!editing || event.target.closest?.("input,textarea,select,[contenteditable=true]")) return false;
    if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.code === "KeyX" || ["x", "X", "ｘ", "Ｘ"].includes(event.key))) {
      stop(event);
      if (!event.repeat) clear();
      return true;
    }
    if (event.code === "Space" || event.key === " ") {
      spaceDown = true;
      resetCursor();
      return false;
    }
    if (["Shift", "Alt"].includes(event.key) && drag) {
      stop(event); updateDrag(drag.point, event.key === "Shift" || event.shiftKey, event.key === "Alt" || event.altKey); return true;
    }
    if (event.key === "Escape" || event.key === "Enter") {
      stop(event); leave(event.key === "Enter");
      return true;
    }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return false;
    stop(event);
    if (rect && !drag) {
      const step = event.shiftKey ? 10 : 1;
      rect.x = clamp(rect.x + direction[0] * step, 0, original.naturalWidth - rect.w);
      rect.y = clamp(rect.y + direction[1] * step, 0, original.naturalHeight - rect.h);
      draw();
    }
    return true;
  }
  function keyUp(event) {
    if (event.code === "Space" || event.key === " ") { spaceDown = false; return; }
    if (!editing || !drag || !["Shift", "Alt"].includes(event.key)) return;
    stop(event); updateDrag(drag.point, event.key !== "Shift" && event.shiftKey, event.key !== "Alt" && event.altKey);
  }
  function wheel(event) {
    if (!editing || !ownsEvent(event) || !contains(event, box)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    zoomCanvas(event);
  }
  function blur() { spaceDown = false; resetCursor(); }
  const listeners = { dblclick: doubleClick, pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerUp,
    pointercancel: pointerUp, keydown: keyDown, keyup: keyUp, blur };
  for (const [name, listener] of Object.entries(listeners)) window.addEventListener(name, listener, true);
  window.addEventListener("wheel", wheel, { capture: true, passive: false });
  return {
    get editing() { return editing; },
    clear,
    confirmForQueue: () => leave(true, false),
    position,
    async setSource(image) {
      resetCursor();
      revision++; editing = false; drag = null;
      if (cancelActiveCrop === cancel) cancelActiveCrop = null;
      if (activeCropKey === keyDown) activeCropKey = null;
      root.classList.remove("guhai-image-cropping");
      original = image;
      sourceIdentity = image ? { ...getIdentity() } : null;
      if (image) await displaySaved();
    },
    dispose() {
      resetCursor();
      revision++;
      if (cancelActiveCrop === cancel) cancelActiveCrop = null;
      if (activeCropKey === keyDown) activeCropKey = null;
      for (const [name, listener] of Object.entries(listeners)) window.removeEventListener(name, listener, true);
      window.removeEventListener("wheel", wheel, true);
      panel.remove(); overlay.remove(); original = null;
    }
  };
}
