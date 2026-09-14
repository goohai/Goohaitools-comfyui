import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_TYPE = "GH_ImageVideoComparer";
const STATE_KEY = "gh_image_video_comparer_state_v1";
const MEDIA_KEY = "gh_image_video_comparer_media_v1";
const VIEW_MODES = [
    ["slide", "滑动对比"],
    ["auto", "自动双拼"],
    ["horizontal", "左右双拼"],
    ["vertical", "上下双拼"],
];
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const LABEL_HEIGHT = 20;
const HORIZONTAL_SPLIT_GAP_PX = 1;
const VERTICAL_SPLIT_GAP_PX = 2;
const MIN_NODE_WIDTH = 300;
const MIN_NODE_HEIGHT = 400;
const MAX_BATCH_PREVIEWS = 10;
// When a large node is only partly inside the browser window, keep a small
// world-space render buffer around the visible intersection. During a graph
// drag/pan the visible clip can then move over already-rendered pixels without
// resizing the canvas or decoding/drawing the source image every frame.
const COMPARER_RENDER_OVERSCAN_PX = 128;
const comparerLayoutStyle = document.createElement("style");
comparerLayoutStyle.textContent = `
    .lg-node:has(.gh-comparer) {
        min-width: ${MIN_NODE_WIDTH}px;
        min-height: max(${MIN_NODE_HEIGHT + 30}px, var(--node-height, 0px));
    }
    .lg-node > div:has(.gh-comparer) {
        min-width: ${MIN_NODE_WIDTH}px;
        min-height: max(${MIN_NODE_HEIGHT + 30}px, var(--node-height, 0px));
    }
    .gh-comparer > .gh-comparer-stage {
        width: calc(100% + 20px) !important;
        margin: 0 -10px -10px;
    }
    .lg-node .gh-comparer > .gh-comparer-stage {
        width: calc(100% + 24px) !important;
        margin: 0 -12px -12px;
    }
    .gh-comparer.gh-comparer-video > .gh-comparer-stage {
        margin-bottom: 0;
    }
    .gh-comparer-video > :first-child {
        display: grid !important;
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .gh-comparer-video > :first-child > button,
    .gh-comparer-video .gh-comparer-video-controls > button {
        width: 100%;
        min-width: 0 !important;
        height: 24px !important;
        padding: 0 4px !important;
        font-size: 12px !important;
        background: transparent !important;
        border-radius: 6px !important;
    }
    .gh-comparer:fullscreen {
        background: #24272f !important;
        padding: 8px !important;
    }
    .gh-comparer-progress {
        appearance: none;
        height: 4px;
        border: 0;
        border-radius: 3px;
        padding: 0;
        cursor: pointer;
        background: linear-gradient(to right, #469caa var(--played, 0%), #55585c var(--played, 0%));
    }
    .gh-comparer-progress::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 10px;
        height: 10px;
        border: 0;
        border-radius: 50%;
        background: #469caa;
        opacity: 0;
    }
    .gh-comparer-progress:hover::-webkit-slider-thumb { opacity: 1; }
    .gh-comparer-progress::-moz-range-thumb {
        width: 10px;
        height: 10px;
        border: 0;
        border-radius: 50%;
        background: #469caa;
        opacity: 0;
    }
    .gh-comparer-progress:hover::-moz-range-thumb { opacity: 1; }
    .gh-comparer-transport::before {
        content: "";
        width: 0;
        height: 0;
        border-top: 5px solid transparent;
        border-bottom: 5px solid transparent;
        border-left: 8px solid currentColor;
    }
    .gh-comparer-transport[data-playing="true"]::before {
        width: 9px;
        height: 9px;
        border: 0;
        background: currentColor;
    }
    .gh-comparer:fullscreen > .gh-comparer-stage {
        width: 100% !important;
        margin: 0;
    }
`;
document.head.appendChild(comparerLayoutStyle);
const COMPARER_STATES = new Set();
const COMPARER_TARGETS = new Map();
const PENDING_COMPARERS = new Set();
let comparerRefreshFrame = 0;
const comparerTransformObserver = new MutationObserver((records) => {
    const changed = new Set();
    let reparented = false;
    for (const record of records) {
        if (record.type === "attributes" && record.oldValue === record.target.getAttribute(record.attributeName)) continue;
        for (const state of COMPARER_TARGETS.get(record.target) || []) changed.add(state);
        if (record.type === "childList") reparented = true;
    }
    if (reparented) observeComparerTransforms();
    // Vue and Legacy can commit transforms inside their own animation frame.
    // Mutation delivery runs before paint; another RAF here would lag a frame.
    refreshComparers(changed);
});
const comparerMountObserver = new MutationObserver(() => {
    if ([...COMPARER_STATES].some((state) => state.root.isConnected && !state.transformConnected)) {
        observeComparerTransforms();
        refreshComparers(COMPARER_STATES);
    }
});
const comparerResizeObserver = new ResizeObserver((entries) => {
    const changed = new Set();
    for (const entry of entries) {
        for (const state of COMPARER_TARGETS.get(entry.target) || []) changed.add(state);
    }
    refreshComparers(changed);
});

function observeComparerTransforms() {
    comparerTransformObserver.disconnect();
    comparerMountObserver.disconnect();
    COMPARER_TARGETS.clear();
    let awaitingMount = false;
    for (const state of COMPARER_STATES) {
        state.transformConnected = state.root.isConnected;
        awaitingMount ||= !state.root.isConnected;
        for (let target = state.stage; target; target = target.parentElement) {
            if (!COMPARER_TARGETS.has(target)) COMPARER_TARGETS.set(target, new Set());
            COMPARER_TARGETS.get(target).add(state);
        }
    }
    for (const target of COMPARER_TARGETS.keys()) {
        comparerTransformObserver.observe(target, {
            attributes: true, attributeFilter: ["style", "class", "hidden"], attributeOldValue: true, childList: true,
        });
    }
    if (awaitingMount) comparerMountObserver.observe(document.body, { childList: true, subtree: true });
}

function intersectComparerRects(first, second) {
    const left = Math.max(first.left, second.left);
    const top = Math.max(first.top, second.top);
    const right = Math.min(first.right, second.right);
    const bottom = Math.min(first.bottom, second.bottom);
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function visibleComparerRect(state, rect) {
    const visualViewport = window.visualViewport;
    const viewport = {
        left: visualViewport?.offsetLeft || 0,
        top: visualViewport?.offsetTop || 0,
        right: (visualViewport?.offsetLeft || 0) + (visualViewport?.width || window.innerWidth),
        bottom: (visualViewport?.offsetTop || 0) + (visualViewport?.height || window.innerHeight),
    };
    let visible = intersectComparerRects(rect, viewport);
    // A transformed node can extend far outside the browser viewport. Respect
    // any real ancestor clipping too, otherwise the window canvas can paint
    // over a sidebar or another scroll container.
    for (let target = state.stage?.parentElement; target && target !== document.body; target = target.parentElement) {
        const style = getComputedStyle(target);
        const clipsX = style.overflowX !== "visible" || style.contain.includes("paint");
        const clipsY = style.overflowY !== "visible" || style.contain.includes("paint");
        if (!clipsX && !clipsY) continue;
        const clip = target.getBoundingClientRect();
        visible = {
            left: clipsX ? Math.max(visible.left, clip.left) : visible.left,
            top: clipsY ? Math.max(visible.top, clip.top) : visible.top,
            right: clipsX ? Math.min(visible.right, clip.right) : visible.right,
            bottom: clipsY ? Math.min(visible.bottom, clip.bottom) : visible.bottom,
        };
        visible.width = Math.max(0, visible.right - visible.left);
        visible.height = Math.max(0, visible.bottom - visible.top);
        if (!visible.width || !visible.height) break;
    }
    return visible;
}

function comparerRenderRect(state, drawRect, width, height, scaleX, scaleY) {
    const fullyVisible = drawRect.x <= 0.0001 && drawRect.y <= 0.0001 &&
        drawRect.x + drawRect.w >= width - 0.0001 && drawRect.y + drawRect.h >= height - 0.0001;
    if (fullyVisible) {
        state.renderRectMode = "full";
        state.renderRectSize = `${width};${height}`;
        state.renderRect = { x: 0, y: 0, w: width, h: height };
        return state.renderRect;
    }
    if (!drawRect.w || !drawRect.h) return drawRect;

    const sizeKey = `${width};${height};${scaleX};${scaleY}`;
    const previous = state.renderRect;
    const previousIsUsable = state.renderRectMode === "partial" && state.renderRectSize === sizeKey && previous &&
        drawRect.x >= previous.x && drawRect.y >= previous.y &&
        drawRect.x + drawRect.w <= previous.x + previous.w &&
        drawRect.y + drawRect.h <= previous.y + previous.h;
    if (previousIsUsable) return previous;

    const marginX = COMPARER_RENDER_OVERSCAN_PX / Math.max(scaleX, 0.0001);
    const marginY = COMPARER_RENDER_OVERSCAN_PX / Math.max(scaleY, 0.0001);
    state.renderRectMode = "partial";
    state.renderRectSize = sizeKey;
    state.renderRect = {
        x: Math.max(0, drawRect.x - marginX),
        y: Math.max(0, drawRect.y - marginY),
        w: Math.min(width, drawRect.x + drawRect.w + marginX) - Math.max(0, drawRect.x - marginX),
        h: Math.min(height, drawRect.y + drawRect.h + marginY) - Math.max(0, drawRect.y - marginY),
    };
    return state.renderRect;
}

function measureComparer(state) {
    const width = Math.max(1, state.stage.clientWidth);
    const height = Math.max(1, state.stage.clientHeight);
    const rect = state.stage.getBoundingClientRect();
    const scaleX = rect.width / width || 1;
    const scaleY = rect.height / height || 1;
    const screenRect = visibleComparerRect(state, rect);
    const localLeft = Math.max(0, Math.min(width, (screenRect.left - rect.left) / scaleX));
    const localTop = Math.max(0, Math.min(height, (screenRect.top - rect.top) / scaleY));
    const localRight = Math.max(localLeft, Math.min(width, (screenRect.right - rect.left) / scaleX));
    const localBottom = Math.max(localTop, Math.min(height, (screenRect.bottom - rect.top) / scaleY));
    const drawRect = {
        x: localLeft,
        y: localTop,
        w: Math.max(0, localRight - localLeft),
        h: Math.max(0, localBottom - localTop),
    };
    const rasterScale = (window.devicePixelRatio || 1) * Math.max(1, scaleX, scaleY);
    const renderRect = comparerRenderRect(state, drawRect, width, height, scaleX, scaleY);
    return {
        width, height, rect,
        visible: state.root.isConnected && !state.node.flags?.collapsed && rect.width > 0 && rect.height > 0 &&
            state.stage.checkVisibility({ checkVisibilityCSS: true }),
        onScreen: drawRect.w > 0 && drawRect.h > 0,
        screenRect,
        drawRect,
        renderRect,
        rasterScale,
        canvasWidth: Math.max(0, Math.ceil(renderRect.w * rasterScale)),
        canvasHeight: Math.max(0, Math.ceil(renderRect.h * rasterScale)),
    };
}

function refreshComparers(states) {
    // Read all widget positions before writing overlays or resizing canvases.
    const measured = [...states].filter((state) => COMPARER_STATES.has(state)).map((state) => [state, measureComparer(state)]);
    for (const [state, geometry] of measured) {
        PENDING_COMPARERS.delete(state);
        const rasterChanged = state.canvas.width !== geometry.canvasWidth || state.canvas.height !== geometry.canvasHeight;
        const sizeChanged = state.lastPreviewWidth !== geometry.width || state.lastPreviewHeight !== geometry.height;
        const windowChanged = state.lastCanvasWindowKey !== [
            geometry.renderRect.x, geometry.renderRect.y, geometry.renderRect.w, geometry.renderRect.h,
            geometry.rasterScale,
        ].join(";");
        if (geometry.visible && geometry.onScreen) {
            if (state.previewDirty || rasterChanged || sizeChanged || windowChanged) drawCanvasPreview(state, geometry);
            else updateCanvasClip(state, geometry);
        } else updateCanvasClip(state, geometry);
        drawDimensionLabels(state, geometry);
    }
}

function refreshAllComparerPositions() {
    refreshComparers(COMPARER_STATES);
}

function markDirty() {
    app.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
}

function mediaUrl(data) {
    if (!data?.filename) return "";
    const query = new URLSearchParams({
        filename: data.filename,
        type: data.type || "temp",
        subfolder: data.subfolder || "",
    });
    return api.apiURL(`/view?${query}${app.getRandParam?.() || ""}`);
}

function normalizedType(type) {
    const value = String(type || "").toUpperCase();
    if (value === "IMAGE") return "image";
    if (value === "VIDEO") return "video";
    return "unknown";
}

function connectedOutputType(node, inputIndex) {
    const input = node.inputs?.[inputIndex];
    if (!input?.link) return "unknown";
    const link = app.graph?.links?.[input.link];
    if (!link) return "unknown";
    const origin = app.graph?.getNodeById?.(link.origin_id);
    const output = origin?.outputs?.[link.origin_slot];
    return normalizedType(output?.type || link.type);
}

function labelFor(kind, side) {
    const suffix = side === "a" ? "a" : "b";
    if (kind === "image") return `图像 ${suffix}`;
    if (kind === "video") return `视频 ${suffix}`;
    return `图像/视频 ${suffix}`;
}

function enforcedKind(node) {
    const state = node.__ghComparer;
    const hasA = Boolean(node.inputs?.[0]?.link);
    const hasB = Boolean(node.inputs?.[1]?.link);
    if (!hasA && !hasB) return "unknown";
    const linkedA = connectedOutputType(node, 0);
    const linkedB = connectedOutputType(node, 1);
    if (linkedA === "image" || linkedA === "video") return linkedA;
    if (linkedB === "image" || linkedB === "video") return linkedB;
    const runtimeA = state?.media?.a?.kind;
    const runtimeB = state?.media?.b?.kind;
    if (runtimeA === "image" || runtimeA === "video") return runtimeA;
    if (runtimeB === "image" || runtimeB === "video") return runtimeB;
    return "unknown";
}

function setInputLabels(node) {
    const state = node.__ghComparer;
    if (!state) return;
    const forced = enforcedKind(node);
    for (let index = 0; index < 2; index++) {
        const side = index === 0 ? "a" : "b";
        const input = node.inputs?.[index];
        if (!input) continue;
        input.type = forced === "image" ? "IMAGE" : forced === "video" ? "VIDEO" : "*";
        input.label = labelFor(forced, side);
    }
}

function enforceSameInputType(node, changedIndex) {
    const a = connectedOutputType(node, 0);
    const b = connectedOutputType(node, 1);
    // If both links are already known and disagree, remove the newest/second
    // link. This also protects workflows loaded from older versions.
    if ((a === "image" && b === "video") || (a === "video" && b === "image")) {
        const index = changedIndex === 0 || changedIndex === 1 ? changedIndex : 1;
        if (node.inputs?.[index]?.link && typeof node.disconnectInput === "function") node.disconnectInput(index);
    }
    setInputLabels(node);
}

function el(tag, styles = {}, text = "") {
    const element = document.createElement(tag);
    Object.assign(element.style, styles);
    if (text) element.textContent = text;
    return element;
}

function button(text, title, handler) {
    const item = el("button", {
        height: "30px", minWidth: "64px", padding: "0 9px", border: "1px solid #48505c",
        borderRadius: "6px", background: "#2a3038", color: "#f4f4f4", cursor: "pointer",
        fontSize: "12px", whiteSpace: "nowrap",
    }, text);
    item.type = "button";
    item.title = title;
    item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler(event);
    });
    return item;
}

function makePlaceholder(side) {
    const item = el("div", {
        position: "absolute", inset: "0", display: "grid", placeItems: "center",
        background: "transparent", overflow: "hidden", userSelect: "none",
    });
    item.dataset.placeholder = "true";
    const letter = el("div", {
        fontFamily: "Georgia, serif", fontSize: "clamp(59px, 16vw, 153px)", lineHeight: "1",
        color: side === "a" ? "#12566a" : "#74674f", fontWeight: "600",
    }, side.toUpperCase());
    item.appendChild(letter);
    return item;
}

function isRealMedia(data) {
    return Boolean(data?.filename && (data.kind === "image" || data.kind === "video"));
}

function previewMediaReady(element, data) {
    if (!isRealMedia(data)) return true;
    if (element instanceof HTMLImageElement) return element.complete && element.naturalWidth > 0;
    if (element instanceof HTMLVideoElement) return element.readyState > 0 && element.videoWidth > 0 && element.videoHeight > 0;
    return false;
}

function previewTransitionReady(state) {
    return previewMediaReady(state?.aElement, state?.media?.a) &&
        previewMediaReady(state?.bElement, state?.media?.b);
}

function batchItems(data) {
    return Array.isArray(data?.batch) && data.batch.length > 1 ? data.batch.slice(0, MAX_BATCH_PREVIEWS) : [];
}

function batchIndex(data) {
    const items = batchItems(data);
    if (!items.length) return 0;
    return Math.max(0, Math.min(items.length - 1, Number(data?.batch_index) || 0));
}

function mediaAtBatchIndex(data, index) {
    const items = batchItems(data);
    if (!items.length) return data;
    const selected = items[Math.max(0, Math.min(items.length - 1, Number(index) || 0))];
    return { ...selected, batch: items, batch_size: items.length, batch_index: items.indexOf(selected) };
}

function dimensionsText(data) {
    const width = Number(data?.width) || 0;
    const height = Number(data?.height) || 0;
    const parts = width > 0 && height > 0 ? [`${width} × ${height}`] : [];
    if (data?.kind === "video") {
        if (Number(data.frame_rate) > 0) parts.push(`${Number(Number(data.frame_rate).toFixed(2))}fps`);
        if (Number(data.duration) > 0) parts.push(`${Number(Number(data.duration).toFixed(2))}s`);
    }
    return parts.join(" · ");
}

function stopMedia(element) {
    if (element instanceof HTMLVideoElement) {
        if (element.ghFrameCallback != null) element.cancelVideoFrameCallback?.(element.ghFrameCallback);
        element.ghFrameCallback = null;
        element.pause();
        element.removeAttribute("src");
        element.load();
    }
}

function createMediaElement(data, side, onFailure) {
    if (data?.kind === "image" && data.filename) {
        const image = document.createElement("img");
        image.src = mediaUrl(data);
        image.draggable = false;
        image.addEventListener("error", () => onFailure?.(side), { once: true });
        Object.assign(image.style, { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", maxWidth: "100%", maxHeight: "100%", background: "transparent" });
        return image;
    }
    if (data?.kind === "video" && data.filename) {
        const video = document.createElement("video");
        video.src = mediaUrl(data);
        video.preload = "auto";
        video.playsInline = true;
        video.loop = false;
        video.addEventListener("error", () => onFailure?.(side), { once: true });
        Object.assign(video.style, { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", maxWidth: "100%", maxHeight: "100%", background: "transparent" });
        return video;
    }
    return makePlaceholder(side);
}

function videos(state) {
    return [state.aElement, state.bElement].filter((item) => item instanceof HTMLVideoElement);
}

function hasVideo(state) {
    return state.media?.a?.kind === "video" || state.media?.b?.kind === "video" ||
        connectedOutputType(state.node, 0) === "video" || connectedOutputType(state.node, 1) === "video";
}

function updateVideoControls(state) {
    if (state.playing && !state.progressFrame) {
        const tick = () => {
            state.progressFrame = 0;
            if (!state.playing || !COMPARER_STATES.has(state)) return;
            updateProgress(state);
            state.progressFrame = requestAnimationFrame(tick);
        };
        state.progressFrame = requestAnimationFrame(tick);
    } else if (!state.playing) {
        cancelAnimationFrame(state.progressFrame);
        state.progressFrame = 0;
    }
    const visible = hasVideo(state);
    state.root.classList.toggle("gh-comparer-video", visible);
    state.videoControls.style.display = visible ? "contents" : "none";
    state.progressRow.style.display = visible ? "flex" : "none";
    const playable = videos(state).length > 0;
    for (const item of [state.speedButton, state.audioButton, state.fullscreenButton]) {
        item.disabled = !playable;
        item.style.opacity = playable ? "1" : "0.45";
        item.style.cursor = playable ? "pointer" : "not-allowed";
    }
    state.fullscreenButton.textContent = document.fullscreenElement === state.root ? "退出全屏" : "全屏";
    state.transportButton.dataset.playing = String(state.playing);
    state.transportButton.title = state.playing ? "停止并回到首帧" : "播放";
    state.transportButton.setAttribute("aria-label", state.transportButton.title);
    state.transportButton.disabled = !playable;
    state.speedButton.textContent = `${state.speed}x`;
    state.audioButton.textContent = state.audioMode === "both" ? "音频 A+B" : state.audioMode === "a" ? "音频 A" : state.audioMode === "b" ? "音频 B" : "静音";
}

function applyAudio(state) {
    if (state.aElement instanceof HTMLVideoElement) state.aElement.muted = !["a", "both"].includes(state.audioMode);
    if (state.bElement instanceof HTMLVideoElement) state.bElement.muted = !["b", "both"].includes(state.audioMode);
    updateVideoControls(state);
}

function defaultAudioMode(media) {
    if (media?.a?.kind === "video") return "a";
    if (media?.b?.kind === "video") return "b";
    return "none";
}

function videoMaster(state) {
    return videos(state).reduce((master, video) => !master || (video.duration || 0) > (master.duration || 0) ? video : master, null);
}

function syncTime(state, source) {
    if (state.seeking || source !== videoMaster(state) || source.seeking) return;
    const others = videos(state).filter((video) => video !== source);
    for (const video of others) {
        if (!video.ended && !video.seeking && source.currentTime < video.duration && Math.abs(video.currentTime - source.currentTime) > 0.03) {
            video.currentTime = source.currentTime;
        }
    }
}

function updateProgress(state) {
    const master = videoMaster(state);
    if (!master || state.seeking) return;
    const duration = Number.isFinite(master.duration) ? master.duration : Number(state.media?.a?.duration || state.media?.b?.duration || 0);
    const fraction = duration > 0 ? Math.max(0, Math.min(1, master.currentTime / duration)) : 0;
    state.progress.value = String(fraction * 1000);
    state.progress.style.setProperty("--played", `${fraction * 100}%`);
    const text = `${formatTime(master.currentTime)} / ${formatTime(duration)}`;
    if (state.time.textContent !== text) state.time.textContent = text;
}

function formatTime(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(value / 60);
    return `${minutes}:${String(Math.floor(value - minutes * 60)).padStart(2, "0")}`;
}

function effectiveView(state) {
    if (state?.view !== "auto") return state?.view || "slide";
    const a = state.media?.a || {}, b = state.media?.b || {};
    const arA = Math.max(0.0001, Number(a.width) || 1) / Math.max(0.0001, Number(a.height) || 1);
    const arB = Math.max(0.0001, Number(b.width) || 1) / Math.max(0.0001, Number(b.height) || 1);
    if (Math.abs(arA - 1) < 0.0001 && Math.abs(arB - 1) < 0.0001) return "horizontal";
    const horizontalDistance = Math.abs(arA + arB - 1);
    const verticalDistance = Math.abs(1 / (1 / arA + 1 / arB) - 1);
    return horizontalDistance <= verticalDistance ? "horizontal" : "vertical";
}

async function togglePlayback(state) {
    state.stopFrameStep?.();
    state.frameStepIndex = null;
    const items = videos(state);
    if (!items.length || state.playPending) return;
    if (state.playing) {
        items.forEach((video) => video.pause());
        state.playing = false;
        const masterPause = videoMaster(state);
        if (masterPause) {
            state.seeking = true;
            const target = masterPause.currentTime;
            // Force BOTH videos to seek to identical timestamp, same as progress bar does.
            // Do not skip master with 0.01s threshold - both must re-decode same timestamp.
            const pump = () => {
                state.seekPump = 0;
                const vids = videos(state);
                if (!vids.length) return;
                for (const v of vids) {
                    const clamped = Math.max(0, Math.min(target, Number.isFinite(v.duration) ? v.duration : target));
                    try { v.currentTime = clamped; } catch (_) {}
                }
            };
            state.seekPump = requestAnimationFrame(pump);
            const clearSeek = () => { state.seeking = false; updateProgress(state); scheduleVideoPreview(state); };
            const waitAllSeeked = () => {
                if (items.every(v => !v.seeking)) { clearSeek(); for (const v of items) v.removeEventListener("seeked", waitAllSeeked); }
            };
            for (const v of items) v.addEventListener("seeked", waitAllSeeked);
            setTimeout(() => { clearSeek(); for (const v of items) v.removeEventListener("seeked", waitAllSeeked); }, 300);
        }
    } else {
        const master = videoMaster(state);
        if (master.ended) items.forEach((video) => { video.currentTime = 0; });
        items.forEach((video) => { video.playbackRate = state.speed; });
        state.playPending = true;
        await Promise.all(items.filter((video) => !video.ended).map((video) => video.play().catch(() => undefined)));
        state.playPending = false;
        state.playing = items.some((video) => !video.paused);
    }
    updateVideoControls(state);
}

function scheduleVideoPreview(state) {
    if (state.videoPreviewFrame || !COMPARER_STATES.has(state) || state.seeking) return;
        state.videoPreviewFrame = requestAnimationFrame(() => {
        state.videoPreviewFrame = 0;
        const geometry = measureComparer(state);
        if (geometry.visible && geometry.onScreen) drawCanvasPreview(state, geometry);
        updateProgress(state);
    });
}

// Seek only one synchronized pair at a time. Rapid slider/keyboard input can
// otherwise enqueue many decoder seeks; the browser then presents only the
// final request after the pointer is released.
function scheduleVideoSeek(state) {
    if (state.seekPump || state.pendingSeekTarget == null || !COMPARER_STATES.has(state)) return;
    const pump = () => {
        state.seekPump = 0;
        const items = videos(state);
        if (!items.length || !Number.isFinite(state.pendingSeekTarget)) return;
        const target = state.pendingSeekTarget;
        state.pendingSeekTarget = null;
        for (const video of items) {
            const clamped = Math.max(0, Math.min(target, Number.isFinite(video.duration) ? video.duration : target));
            if (Math.abs(video.currentTime - clamped) > 0.01) {
                try { video.currentTime = clamped; } catch (_) {}
            }
        }
        if (state.pendingSeekTarget != null) scheduleVideoSeek(state);
    };
    state.seekPump = requestAnimationFrame(pump);
}

function requestVideoSeek(state, target) {
    if (!Number.isFinite(target)) return;
    state.pendingSeekTarget = Math.max(0, target);
    scheduleVideoSeek(state);
}

function setView(state, mode) {
    state.view = VIEW_MODES.some(([key]) => key === mode) ? mode : "slide";
    state.node.properties ??= {};
    state.node.properties[STATE_KEY] = { view: state.view, position: state.position, speed: state.speed, audioMode: state.audioMode, syncEnabled: state.syncEnabled };
    state.viewButton.textContent = VIEW_MODES.find(([key]) => key === state.view)?.[1] || "滑动对比";

    const layout = effectiveView(state);
    const slide = layout === "slide";
    state.lineVisible = slide && (isRealMedia(state.media?.a) || isRealMedia(state.media?.b));
    state.divider.style.display = slide ? "block" : "none";
    state.divider.style.opacity = slide && state.lineVisible ? "1" : "0";
    state.aPane.style.position = "absolute";
    state.bPane.style.position = "absolute";
    if (slide) {
        Object.assign(state.aPane.style, { left: "0", top: "0", right: "0", bottom: `${LABEL_HEIGHT}px`, width: "auto", height: "auto", clipPath: "none" });
        Object.assign(state.bClip.style, { left: "0", top: "0", right: "0", bottom: `${LABEL_HEIGHT}px`, width: "auto", height: "auto", overflow: "hidden" });
        Object.assign(state.bPane.style, { left: "0", top: "0", right: "auto", bottom: "auto", width: "100%", height: "100%", clipPath: "none" });
        updateDividerGeometry(state);
    } else if (layout === "horizontal") {
        const gap = horizontalSplitGap(state.stage.clientWidth, state.stage.getBoundingClientRect().width);
        const paneWidth = Math.max(0, (state.stage.clientWidth - gap) / 2);
        Object.assign(state.aPane.style, { left: "0", top: "0", bottom: `${LABEL_HEIGHT}px`, right: "auto", width: `${paneWidth}px`, height: "auto" });
        state.aPane.style.clipPath = "none";
        Object.assign(state.bClip.style, { left: `${paneWidth + gap}px`, top: "0", bottom: `${LABEL_HEIGHT}px`, right: "auto", width: `${paneWidth}px`, height: "auto", overflow: "hidden" });
        Object.assign(state.bPane.style, { inset: "0", width: "auto", height: "auto", clipPath: "none" });
    } else {
        Object.assign(state.aPane.style, { left: "0", top: "0", right: "0", bottom: "50%", width: "auto", height: "auto" });
        state.aPane.style.clipPath = "none";
        Object.assign(state.bClip.style, { left: "0", top: "50%", right: "0", bottom: "0", width: "auto", height: "50%", overflow: "hidden" });
        Object.assign(state.bPane.style, { inset: "0", width: "auto", height: "auto", clipPath: "none" });
    }
    updateMediaGeometry(state);
    markDirty();
}

function fitSize(data, maxWidth, maxHeight) {
    const width = Math.max(1, Number(data?.width) || 1);
    const height = Math.max(1, Number(data?.height) || 1);
    const scale = Math.min(maxWidth / width, maxHeight / height);
    return { width: Math.max(1, width * scale), height: Math.max(1, height * scale) };
}

function setElementSize(element, width, height) {
    if (!element || element.dataset?.placeholder === "true") return;
    element.style.width = `${Math.max(1, width)}px`;
    element.style.height = `${Math.max(1, height)}px`;
}

function horizontalSplitGap(width, screenWidth) {
    const scaleX = Number(screenWidth) / Math.max(1, width) || 1;
    return Math.min(
        HORIZONTAL_SPLIT_GAP_PX / Math.max(scaleX, 0.0001),
        Math.max(0, width - 2),
    );
}

function compareViewports(width, mediaHeight, layout, gap = 0) {
    if (layout === "horizontal") {
        const paneWidth = Math.max(0, (width - gap) / 2);
        return [
            { x: 0, y: 0, w: paneWidth, h: mediaHeight },
            { x: paneWidth + gap, y: 0, w: paneWidth, h: mediaHeight },
        ];
    }
    if (layout === "vertical") {
        const rowHeight = Math.max(1, (mediaHeight - VERTICAL_SPLIT_GAP_PX) / 2);
        return [
            { x: 0, y: 0, w: width, h: rowHeight },
            { x: 0, y: rowHeight + VERTICAL_SPLIT_GAP_PX, w: width, h: rowHeight },
        ];
    }
    return [{ x: 0, y: 0, w: width, h: mediaHeight }];
}

function transformedCompareRect(rect, viewport, zoom, panX, panY) {
    const centerX = viewport.x + viewport.w / 2;
    const centerY = viewport.y + viewport.h / 2;
    const width = rect.w * zoom;
    const height = rect.h * zoom;
    return {
        x: centerX + panX - width / 2,
        y: centerY + panY - height / 2,
        w: width,
        h: height,
    };
}

function comparePanRange(rect, viewport, zoom, axis) {
    const imageSize = (axis === "x" ? rect.w : rect.h) * zoom;
    const viewportSize = axis === "x" ? viewport.w : viewport.h;
    if (imageSize < viewportSize) return { min: 0, max: 0 };
    const center = axis === "x" ? viewport.x + viewport.w / 2 : viewport.y + viewport.h / 2;
    const start = axis === "x" ? viewport.x : viewport.y;
    const end = axis === "x" ? viewport.x + viewport.w : viewport.y + viewport.h;
    return {
        min: end - center - imageSize / 2,
        max: start - center + imageSize / 2,
    };
}

function clampComparePan(state, rects, viewports, layout) {
    if (layout === "slide") {
        state.comparePanX = 0;
        state.comparePanY = 0;
        return;
    }
    const rangesX = [], rangesY = [];
    for (let index = 0; index < 2; index++) {
        if (!rects[index] || !viewports[index]) continue;
        rangesX.push(comparePanRange(rects[index], viewports[index], state.compareZoom, "x"));
        rangesY.push(comparePanRange(rects[index], viewports[index], state.compareZoom, "y"));
    }
    const minX = Math.max(...rangesX.map((range) => range.min));
    const maxX = Math.min(...rangesX.map((range) => range.max));
    const minY = Math.max(...rangesY.map((range) => range.min));
    const maxY = Math.min(...rangesY.map((range) => range.max));
    // Different aspect ratios can make the two strict ranges disjoint. In
    // that case keep the shared transform centred instead of exposing a blank
    // strip in either comparison pane.
    state.comparePanX = minX <= maxX ? Math.max(minX, Math.min(maxX, state.comparePanX)) : 0;
    state.comparePanY = minY <= maxY ? Math.max(minY, Math.min(maxY, state.comparePanY)) : 0;
}

function comparePointLocal(state, clientX, clientY, geometry) {
    const layout = effectiveView(state);
    if (layout === "slide") return null;
    const { width, height, rect: stageRect } = geometry;
    if (!stageRect.width || !stageRect.height) return null;
    const x = (clientX - stageRect.left) * width / stageRect.width;
    const y = (clientY - stageRect.top) * height / stageRect.height;
    const mediaHeight = Math.max(1, height - LABEL_HEIGHT);
    const gap = layout === "horizontal" ? horizontalSplitGap(width, stageRect.width) : 0;
    const viewports = compareViewports(width, mediaHeight, layout, gap);
    const index = layout === "horizontal" ? (x < viewports[1].x ? 0 : 1) : (y < viewports[0].h ? 0 : 1);
    const viewport = viewports[index];
    if (!viewport || x < viewport.x || x > viewport.x + viewport.w || y < viewport.y || y > viewport.y + viewport.h) return null;
    return { x, y, index, viewport, viewports };
}

function zoomCompareAt(state, event) {
    const layout = effectiveView(state);
    if (layout === "slide" || !pointInsideComparerStage(state, event)) return false;
    const geometry = measureComparer(state);
    const point = comparePointLocal(state, event.clientX, event.clientY, geometry);
    if (!point) return false;
    const rects = state.compareBaseRects;
    if (!rects?.[point.index]) return false;
    const oldZoom = state.compareZoom;
    const direction = Number(event.deltaY) || 0;
    const factor = Math.exp(-direction * 0.0015);
    const nextZoom = Math.max(1, Math.min(15, oldZoom * factor));
    if (Math.abs(nextZoom - oldZoom) < 0.0001) {
        event.preventDefault();
        return true;
    }
    const oldRect = transformedCompareRect(rects[point.index], point.viewport, oldZoom, state.comparePanX, state.comparePanY);
    const localX = Math.max(0, Math.min(1, (point.x - oldRect.x) / Math.max(oldRect.w, 0.0001)));
    const localY = Math.max(0, Math.min(1, (point.y - oldRect.y) / Math.max(oldRect.h, 0.0001)));
    const nextRectWidth = rects[point.index].w * nextZoom;
    const nextRectHeight = rects[point.index].h * nextZoom;
    const centerX = point.viewport.x + point.viewport.w / 2;
    const centerY = point.viewport.y + point.viewport.h / 2;
    state.compareZoom = nextZoom;
    state.comparePanX = point.x - localX * nextRectWidth - centerX + nextRectWidth / 2;
    state.comparePanY = point.y - localY * nextRectHeight - centerY + nextRectHeight / 2;
    clampComparePan(state, rects, point.viewports, layout);
    state.previewDirty = true;
    drawCanvasPreview(state, geometry);
    event.preventDefault();
    event.stopPropagation();
    return true;
}

function pointInsideComparerStage(state, event) {
    if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    const rect = state?.stage?.getBoundingClientRect?.();
    return Boolean(rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
}

function updateComparePan(state, deltaX, deltaY) {
    state.comparePanX += deltaX;
    state.comparePanY += deltaY;
    clampComparePan(state, state.compareBaseRects || [], state.compareViewports || [], effectiveView(state));
    state.previewDirty = true;
    drawCanvasPreview(state);
}

function updateCanvasClip(state, geometry) {
    const canvas = state?.canvas;
    if (!canvas) return;
    const shouldShow = Boolean(geometry?.visible && geometry?.onScreen && geometry?.renderRect?.w && geometry?.renderRect?.h);
    const nextDisplay = shouldShow ? "block" : "none";
    if (canvas.style.display !== nextDisplay) canvas.style.display = nextDisplay;
    if (!shouldShow) state.canvasReady = false;
}

function drawCanvasPreview(state, geometry = measureComparer(state)) {
    const canvas = state?.canvas;
    if (!canvas || !state.stage) return;
    // During batch switching, keep the already-rendered canvas bitmap until
    // the replacement media can be drawn. This avoids the blank intermediate
    // frame that otherwise appears between two batch images.
    if (state.previewTransition) {
        if (!previewTransitionReady(state)) return;
        state.previewTransition = false;
    }
    const { width: cssW, height: cssH, rasterScale, drawRect, renderRect } = geometry;
    if (!geometry.visible || !geometry.onScreen || !drawRect.w || !drawRect.h || !renderRect?.w || !renderRect?.h) {
        canvas.style.display = "none";
        state.canvasReady = false;
        return;
    }
    canvas.style.display = "block";
    canvas.style.left = `${renderRect.x}px`;
    canvas.style.top = `${renderRect.y}px`;
    canvas.style.width = `${renderRect.w}px`;
    canvas.style.height = `${renderRect.h}px`;
    if (canvas.width !== geometry.canvasWidth || canvas.height !== geometry.canvasHeight) {
        canvas.width = geometry.canvasWidth;
        canvas.height = geometry.canvasHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(rasterScale, 0, 0, rasterScale, 0, 0);
    ctx.clearRect(0, 0, renderRect.w, renderRect.h);
    state.canvasReady = true;
    state.lastPreviewWidth = cssW;
    state.lastPreviewHeight = cssH;
    state.lastCanvasWindowKey = [renderRect.x, renderRect.y, renderRect.w, renderRect.h, rasterScale].join(";");
    const mediaH = Math.max(1, cssH - LABEL_HEIGHT);
    const a = state.media?.a || {}, b = state.media?.b || {};
    const arA = Math.max(1, Number(a.width) || 1) / Math.max(1, Number(a.height) || 1);
    const arB = Math.max(1, Number(b.width) || 1) / Math.max(1, Number(b.height) || 1);
    let rectA, rectB;
    const layout = effectiveView(state);
    if (layout === "horizontal") {
        const horizontalGap = horizontalSplitGap(cssW, geometry.rect?.width);
        const paneWidth = Math.max(0, (cssW - horizontalGap) / 2);
        const h = Math.min(mediaH, paneWidth / Math.max(arA, arB, 0.0001));
        rectA = { x: (paneWidth - h * arA) / 2, y: (mediaH - h) / 2, w: h * arA, h };
        rectB = { x: paneWidth + horizontalGap + (paneWidth - h * arB) / 2, y: (mediaH - h) / 2, w: h * arB, h };
    } else if (layout === "vertical") {
        const rowH = Math.max(1, (mediaH - VERTICAL_SPLIT_GAP_PX) / 2);
        const w = Math.min(cssW, Math.max(1, rowH - LABEL_HEIGHT / 2) * Math.min(arA, arB));
        const hA = w / Math.max(arA, 0.0001), hB = w / Math.max(arB, 0.0001);
        rectA = { x: (cssW - w) / 2, y: (rowH - hA) / 2, w, h: hA };
        rectB = { x: (cssW - w) / 2, y: rowH + VERTICAL_SPLIT_GAP_PX + (rowH - hB) / 2, w, h: hB };
    } else {
        const commonH = Math.min(mediaH, cssW / Math.max(arA, arB, 0.0001));
        rectA = { x: (cssW - commonH * arA) / 2, y: (mediaH - commonH) / 2, w: commonH * arA, h: commonH };
        rectB = { x: (cssW - commonH * arB) / 2, y: (mediaH - commonH) / 2, w: commonH * arB, h: commonH };
    }
    state.previewBounds = {
        left: Math.min(rectA.x, rectB.x),
        right: Math.max(rectA.x + rectA.w, rectB.x + rectB.w),
        top: Math.min(rectA.y, rectB.y),
        bottom: Math.max(rectA.y + rectA.h, rectB.y + rectB.h),
    };
    const horizontalGap = layout === "horizontal" ? horizontalSplitGap(cssW, geometry.rect?.width) : 0;
    const viewports = compareViewports(cssW, mediaH, layout, horizontalGap);
    state.compareBaseRects = [rectA, rectB];
    state.compareViewports = viewports;
    clampComparePan(state, state.compareBaseRects, viewports, layout);
    const draw = (element, rect, data) => {
        if (!element || element.dataset?.placeholder === "true" || element.readyState === 0) return;
        const clipped = intersectComparerRects(
            { left: rect.x, top: rect.y, right: rect.x + rect.w, bottom: rect.y + rect.h },
            { left: renderRect.x, top: renderRect.y, right: renderRect.x + renderRect.w, bottom: renderRect.y + renderRect.h },
        );
        if (!clipped.width || !clipped.height || rect.w <= 0 || rect.h <= 0) return;
        const sourceWidth = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
        const sourceHeight = element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
        const fallbackWidth = Number(data?.width) || 0;
        const fallbackHeight = Number(data?.height) || 0;
        const sourceW = sourceWidth || fallbackWidth;
        const sourceH = sourceHeight || fallbackHeight;
        if (!sourceW || !sourceH) return;
        const sourceX = (clipped.left - rect.x) / rect.w * sourceW;
        const sourceY = (clipped.top - rect.y) / rect.h * sourceH;
        const sourceCropW = clipped.width / rect.w * sourceW;
        const sourceCropH = clipped.height / rect.h * sourceH;
        try {
            ctx.drawImage(
                element, sourceX, sourceY, sourceCropW, sourceCropH,
                clipped.left - renderRect.x, clipped.top - renderRect.y, clipped.width, clipped.height,
            );
        } catch (_) {}
    };
    const drawCompared = (element, rect, viewport) => {
        if (!viewport) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(viewport.x - renderRect.x, viewport.y - renderRect.y, viewport.w, viewport.h);
        ctx.clip();
        draw(element, transformedCompareRect(rect, viewport, state.compareZoom, state.comparePanX, state.comparePanY),
            element === state.aElement ? a : b);
        ctx.restore();
    };
    const drawPlaceholder = (side, rect) => {
        ctx.save(); ctx.fillStyle = side === "a" ? "#12566a" : "#74674f";
        ctx.font = "600 72px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(side.toUpperCase(), rect.x + rect.w / 2 - renderRect.x, rect.y + rect.h / 2 - renderRect.y); ctx.restore();
    };
    const hasA = isRealMedia(a), hasB = isRealMedia(b);
    if (!hasA) drawPlaceholder("a", rectA);
    if (!hasB) drawPlaceholder("b", rectB);
    if (layout === "slide") {
        draw(state.aElement, rectA, a);
        const lineX = Math.max(0, Math.min(cssW, cssW * state.position));
        ctx.save(); ctx.beginPath(); ctx.rect(-renderRect.x, -renderRect.y, cssW * state.position, mediaH); ctx.clip(); draw(state.bElement, rectB, b); ctx.restore();
        // Redraw A only inside the one-pixel divider, then invert it with the
        // native difference compositor. This is per-pixel A inversion without
        // getImageData, temporary pixel buffers, layer caches, or disk writes.
        if (state.lineVisible && (hasA || hasB)) {
            ctx.save();
            ctx.beginPath(); ctx.rect(lineX - 0.5 - renderRect.x, -renderRect.y, 1, mediaH); ctx.clip();
            draw(state.aElement, rectA, a);
            ctx.globalCompositeOperation = "difference"; ctx.fillStyle = "#fff";
            ctx.fillRect(lineX - 0.5 - renderRect.x, -renderRect.y, 1, mediaH); ctx.restore();
        }
    } else {
        drawCompared(state.aElement, rectA, viewports[0]);
        drawCompared(state.bElement, rectB, viewports[1] || viewports[0]);
    }
    state.previewDirty = false;
    const ta = dimensionsText(a), tb = dimensionsText(b);
    const widestLeft = Math.min(rectA.x, rectB.x);
    const widestRight = Math.max(rectA.x + rectA.w, rectB.x + rectB.w);
    const slideLabelRectA = { x: widestLeft, w: widestRight - widestLeft };
    const slideLabelRectB = slideLabelRectA;
    const labelY = Math.min(cssH - LABEL_HEIGHT + 2, Math.max(rectA.y + rectA.h, rectB.y + rectB.h) + 2);
    if (layout === "slide") {
        // In slide mode the image occupying more than two thirds determines
        // the single label. In the middle, show B on the left and A on the
        // right so each value follows the image it describes.
        const singleImageThreshold = 1 / 3;
        if (state.position <= singleImageThreshold) {
            state.dimensionLabels = [{ text: ta, rect: slideLabelRectB, align: "right", y: labelY }];
        } else if (state.position >= 1 - singleImageThreshold) {
            state.dimensionLabels = [{ text: tb, rect: slideLabelRectA, align: "left", y: labelY }];
        } else {
            state.dimensionLabels = [
                { text: tb, rect: slideLabelRectA, align: "left", y: labelY },
                { text: ta, rect: slideLabelRectB, align: "right", y: labelY },
            ];
        }
    } else if (layout === "horizontal") {
        state.dimensionLabels = [
            { text: ta, rect: rectA, align: "center", y: rectA.y + rectA.h + 2 },
            { text: tb, rect: rectB, align: "center", y: rectB.y + rectB.h + 2 },
        ];
    } else {
        state.dimensionLabels = [
            { text: ta, rect: rectA, align: "center", y: rectA.y + rectA.h + 2 },
            { text: tb, rect: rectB, align: "center", y: rectB.y + rectB.h + 2 },
        ];
    }
    drawDimensionLabels(state, geometry);
}

function drawDimensionLabels(state, geometry = measureComparer(state)) {
    const svg = state?.labelSvg;
    if (!svg || !state.stage) return;
    const { width, height, rect: stageRect } = geometry;
    // In zoomed split views the labels would sit over the enlarged media and
    // add visual noise. Restore them as soon as the split view returns to 1x.
    const splitViewZoomed = effectiveView(state) !== "slide" && (Number(state.compareZoom) || 1) > 1.0001;
    const labels = splitViewZoomed ? [] : (state.dimensionLabels || []);
    if (!geometry.visible || !labels.length) {
        if (svg.style.display !== "none") svg.style.display = "none";
        state.labelRenderKey = null;
        return;
    }

    // This SVG lives directly under document.body, outside LiteGraph's
    // transformed DOM tree. Coordinates and font sizes are expressed in final
    // screen pixels, so the browser draws glyphs natively at every graph zoom
    // instead of resampling a scaled text layer.
    const scaleX = stageRect.width / width;
    const scaleY = stageRect.height / height;
    const fontSize = Math.max(1, 10 * scaleY);
    const labelKey = [
        stageRect.left, stageRect.top, stageRect.width, stageRect.height, width, height,
        window.innerWidth, window.innerHeight,
        fontSize, ...labels.map((label) => `${label.text}|${label.align}|${label.rect?.x}|${label.rect?.w}|${label.y}`),
    ].join(";");
    if (state.labelRenderKey === labelKey && svg.style.display !== "none") return;
    state.labelRenderKey = labelKey;
    if (svg.style.display !== "block") svg.style.display = "block";
    const viewportKey = `${window.innerWidth} ${window.innerHeight}`;
    if (state.labelViewportKey !== viewportKey) {
        state.labelViewportKey = viewportKey;
        svg.setAttribute("viewBox", `0 0 ${viewportKey}`);
        svg.setAttribute("width", String(window.innerWidth));
        svg.setAttribute("height", String(window.innerHeight));
    }
    state.labelTextElements ??= [];
    for (let index = 0; index < labels.length; index++) {
        const label = labels[index];
        let text = state.labelTextElements[index];
        if (!text) {
            text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("fill", "#aeb3bc");
            text.setAttribute("font-family", "Arial, sans-serif");
            text.setAttribute("dominant-baseline", "hanging");
            text.setAttribute("text-rendering", "geometricPrecision");
            svg.appendChild(text);
            state.labelTextElements[index] = text;
        }
        const centerX = label.rect.x + label.rect.w / 2;
        const localX = label.align === "left" ? label.rect.x : label.align === "right" ? label.rect.x + label.rect.w : centerX;
        const screenX = stageRect.left + Math.max(0, Math.min(width, localX)) * scaleX;
        const screenY = stageRect.top + label.y * scaleY;
        text.setAttribute("x", String(screenX));
        text.setAttribute("y", String(screenY));
        text.setAttribute("font-size", String(fontSize));
        text.setAttribute("text-anchor", label.align === "left" ? "start" : label.align === "right" ? "end" : "middle");
        if (text.textContent !== label.text) text.textContent = label.text;
    }
    while (state.labelTextElements.length > labels.length) state.labelTextElements.pop()?.remove();
}

function scheduleDimensionLabelRefresh(state) {
    if (!COMPARER_STATES.has(state)) return;
    PENDING_COMPARERS.add(state);
    if (comparerRefreshFrame) return;
    comparerRefreshFrame = requestAnimationFrame(() => {
        comparerRefreshFrame = 0;
        refreshComparers(PENDING_COMPARERS);
    });
}

function updateMediaGeometry(state) {
    if (!state?.stage) return;
    const width = Math.max(1, state.stage.clientWidth);
    const height = Math.max(1, state.stage.clientHeight);
    const mediaHeight = Math.max(1, height - LABEL_HEIGHT);
    const a = state.media?.a || {};
    const b = state.media?.b || {};
    const layout = effectiveView(state);
    if (layout === "slide") {
        const arA = Math.max(1, Number(a.width) || 1) / Math.max(1, Number(a.height) || 1);
        const arB = Math.max(1, Number(b.width) || 1) / Math.max(1, Number(b.height) || 1);
        // Shared contain box: at least one dimension is identical for both
        // sources while each image keeps its own aspect ratio.
        const sharedH = Math.min(mediaHeight, width / Math.max(arA, 0.0001), width / Math.max(arB, 0.0001));
        const aW = sharedH * arA;
        const bW = sharedH * arB;
        setElementSize(state.aElement, aW, sharedH);
        setElementSize(state.bElement, bW, sharedH);
        updateDimensionLabels(state); drawCanvasPreview(state); drawDimensionLabels(state);
        return;
    }
    if (layout === "horizontal") {
        const arA = Math.max(1, Number(a.width) || 1) / Math.max(1, Number(a.height) || 1);
        const arB = Math.max(1, Number(b.width) || 1) / Math.max(1, Number(b.height) || 1);
        const horizontalGap = horizontalSplitGap(width, state.stage.getBoundingClientRect().width);
        const paneWidth = Math.max(0, (width - horizontalGap) / 2);
        // Use one shared height and derive both widths from their aspect ratios.
        // The fit limits ensure neither half overflows its pane.
        const commonHeight = Math.min(mediaHeight, paneWidth / Math.max(arA, 0.0001), paneWidth / Math.max(arB, 0.0001));
        setElementSize(state.aElement, commonHeight * arA, commonHeight);
        setElementSize(state.bElement, commonHeight * arB, commonHeight);
        state.aPane.style.width = `${paneWidth}px`;
        state.bClip.style.left = `${paneWidth + horizontalGap}px`;
        state.bClip.style.width = `${paneWidth}px`;
    } else if (layout === "vertical") {
        const arA = Math.max(1, Number(a.width) || 1) / Math.max(1, Number(a.height) || 1);
        const arB = Math.max(1, Number(b.width) || 1) / Math.max(1, Number(b.height) || 1);
        // Use one shared width and derive both heights, so the split is aligned.
        const rowHeight = Math.max(1, (mediaHeight - VERTICAL_SPLIT_GAP_PX) / 2);
        const commonWidth = Math.min(width, (rowHeight - LABEL_HEIGHT / 2) * arA, (rowHeight - LABEL_HEIGHT / 2) * arB);
        setElementSize(state.aElement, commonWidth, commonWidth / Math.max(arA, 0.0001));
        setElementSize(state.bElement, commonWidth, commonWidth / Math.max(arB, 0.0001));
    }
    updateDimensionLabels(state); drawCanvasPreview(state); drawDimensionLabels(state);
}

function updateDimensionLabels(state) {
    // Labels are rendered in the canvas so their position remains stable
    // across LiteGraph zooming, resizing, and all compare modes.
    state.aSize.style.display = "none";
    state.bSize.style.display = "none";
}

function updateSlidePosition(state, clientX) {
    if (effectiveView(state) !== "slide") return;
    const rect = state.stage.getBoundingClientRect();
    if (!rect.width) return;
    state.position = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    updateDividerGeometry(state);
    state.node.properties ??= {};
    state.node.properties[STATE_KEY] = { view: state.view, position: state.position, speed: state.speed, audioMode: state.audioMode, syncEnabled: state.syncEnabled };
}

function updateDividerGeometry(state) {
    if (!state?.stage || effectiveView(state) !== "slide") return;
    const rect = state.stage.getBoundingClientRect();
    const localWidth = Math.max(1, state.stage.clientWidth);
    const localHeight = Math.max(1, state.stage.clientHeight - LABEL_HEIGHT);
    const scale = rect.width > 0 ? rect.width / localWidth : 1;
    // Keep the divider position continuous. Rounding here makes small mouse
    // movements appear inert and then jump several pixels at once. Only the
    // line width is compensated for graph zoom so it remains one screen pixel.
    const localX = Math.max(0, Math.min(localWidth, (rect.width * state.position) / Math.max(scale, 0.0001)));
    const localLineWidth = 1 / Math.max(scale, 0.0001);
    // Match rgthree's single-crop compositing: A is the complete base image;
    // only B is clipped. This removes the second anti-aliased edge that caused
    // the intermittent one-pixel ghost to the left of the divider.
    state.aPane.style.clipPath = "none";
    // Keep one fixed full-stage layer and vary only a fractional clip edge.
    // This avoids layout-width quantization while preserving a single edge.
    state.bClip.style.left = "0";
    state.bClip.style.top = "0";
    state.bClip.style.right = "0";
    state.bClip.style.width = "auto";
    state.bClip.style.height = `${localHeight}px`;
    // Keep B in the full-stage coordinate system. The clipping window moves;
    // the media itself must not be re-centered inside the shrinking window.
    state.bPane.style.left = "0";
    state.bPane.style.top = "0";
    state.bPane.style.width = `${localWidth}px`;
    state.bPane.style.height = `${localHeight}px`;
    state.bPane.style.right = "auto";
    state.bPane.style.bottom = "auto";
    state.bClip.style.clipPath = "none";
    state.bPane.style.clipPath = `inset(0 0 0 ${localX}px)`;
    // Keep the divider on its compositor layer for continuous, smooth motion.
    state.divider.style.left = "0";
    state.divider.style.width = `${localLineWidth}px`;
    state.divider.style.height = `${localHeight}px`;
    state.divider.style.transform = `translate3d(${localX}px,0,0)`;
}

function scheduleSlidePosition(state, clientX) {
    const rect = state.stage.getBoundingClientRect();
    if (!rect.width) return;
    state.position = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    updateDividerGeometry(state);
    if (state.slideFrame) return;
    state.slideFrame = requestAnimationFrame(() => {
        state.slideFrame = 0;
        drawCanvasPreview(state);
        state.node.properties ??= {};
        state.node.properties[STATE_KEY] = { view: state.view, position: state.position, speed: state.speed, audioMode: state.audioMode, syncEnabled: state.syncEnabled };
    });
}

function setMedia(state, media, resetAudio = false) {
    state.stopFrameStep?.();
    state.frameStepIndex = null;
    stopMedia(state.aElement);
    stopMedia(state.bElement);
    state.playing = false;
    state.compareZoom = 1;
    state.comparePanX = 0;
    state.comparePanY = 0;
    state.media = media || { a: { kind: "unknown" }, b: { kind: "unknown" } };
    if (resetAudio || state.audioMode == null) state.audioMode = defaultAudioMode(state.media);
    state.node.properties ??= {};
    state.node.properties[MEDIA_KEY] = state.media;
    const fallback = (side) => {
        const pane = side === "a" ? state.aPane : state.bPane;
        const placeholder = makePlaceholder(side);
        placeholder.dataset.placeholder = "true";
        pane.replaceChildren(placeholder);
        if (side === "a") state.aElement = placeholder;
        else state.bElement = placeholder;
        state.media[side] = { kind: "unknown" };
        state.previewTransition = false;
        state.node.properties[MEDIA_KEY] = state.media;
        updateDimensionLabels(state);
        updateMediaGeometry(state);
    };
    state.aPane.replaceChildren(state.aElement = createMediaElement(state.media.a, "a", fallback));
    state.bPane.replaceChildren(state.bElement = createMediaElement(state.media.b, "b", fallback));
    if (state.aElement instanceof HTMLVideoElement) state.aElement.muted = !["a", "both"].includes(state.audioMode);
    if (state.bElement instanceof HTMLVideoElement) state.bElement.muted = !["b", "both"].includes(state.audioMode);
    for (const element of [state.aElement, state.bElement]) {
        if (element instanceof HTMLImageElement || element instanceof HTMLVideoElement) {
            element.addEventListener("load", () => { updateMediaGeometry(state); drawCanvasPreview(state); }, { once: false });
            element.addEventListener("loadedmetadata", () => { updateMediaGeometry(state); drawCanvasPreview(state); }, { once: false });
            element.addEventListener("canplay", () => { updateMediaGeometry(state); drawCanvasPreview(state); }, { once: false });
        }
    }
    for (const video of videos(state)) {
        video.playbackRate = state.speed;
        if (video === videoMaster(state)) video.addEventListener("timeupdate", () => { syncTime(state, video); updateProgress(state); scheduleVideoPreview(state); });
        video.addEventListener("loadeddata", () => scheduleVideoPreview(state));
        video.addEventListener("seeked", () => {
            if (state.pendingSeekTarget != null) scheduleVideoSeek(state);
            if (!videos(state).some(v => v.seeking)) {
                updateProgress(state);
                scheduleVideoPreview(state);
            }
        });
        const onFrame = () => {
            if (!videos(state).includes(video)) return;
            if (video === videoMaster(state)) { syncTime(state, video); scheduleVideoPreview(state); }
            video.ghFrameCallback = video.requestVideoFrameCallback(onFrame);
        };
        if (video.requestVideoFrameCallback) video.ghFrameCallback = video.requestVideoFrameCallback(onFrame);
        else video.addEventListener("timeupdate", () => scheduleVideoPreview(state));
        video.addEventListener("ended", () => {
            if (!state.playing || !videos(state).every((item) => item.ended)) return;
            state.playing = false;
            videos(state).forEach((item) => { item.pause(); item.currentTime = 0; });
            updateProgress(state);
            updateVideoControls(state);
        });
        video.addEventListener("pause", () => { if (videos(state).every((item) => item.paused)) state.playing = false; updateVideoControls(state); });
    }
    updateBatchSelector(state);
}

function updateBatchSelector(state) {
    const selector = state?.batchSelector;
    if (!selector) return;
    const aItems = batchItems(state.media?.a);
    const bItems = batchItems(state.media?.b);
    const key = [aItems.length, bItems.length, batchIndex(state.media?.a), batchIndex(state.media?.b)].join(";");
    if (state.batchSelectorKey === key) return;
    state.batchSelectorKey = key;
    selector.replaceChildren();
    const appendSide = (side, items) => {
        if (!items.length) return;
        const prefix = side.toUpperCase();
        const selected = batchIndex(state.media?.[side]);
        items.forEach((_, index) => {
            const item = el("button", {
                height: "24px", minWidth: "24px", padding: "0 2px", border: "0",
                background: "transparent", color: index === selected ? "#f4f4f4" : "#8f96a3",
                cursor: "pointer", fontSize: "16px", lineHeight: "24px", whiteSpace: "nowrap",
            }, `${prefix}${index + 1}`);
            item.type = "button";
            item.title = `切换${prefix}批次 ${index + 1}`;
            item.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                selectBatchItem(state, side, index);
            });
            selector.appendChild(item);
        });
    };
    appendSide("a", aItems);
    if (aItems.length && bItems.length) {
        selector.appendChild(el("span", {
            width: "4px", height: "4px", margin: "0 7px", borderRadius: "50%",
            background: "#8f96a3", flex: "0 0 auto",
        }));
    }
    appendSide("b", bItems);
    selector.style.display = aItems.length || bItems.length ? "flex" : "none";
}

function selectBatchItem(state, side, index) {
    const current = state?.media?.[side];
    const items = batchItems(current);
    if (!items.length || batchIndex(current) === index) return;
    const media = {
        ...state.media,
        [side]: mediaAtBatchIndex(current, index),
    };
    const compareZoom = state.compareZoom;
    const comparePanX = state.comparePanX;
    const comparePanY = state.comparePanY;
    const lineVisible = state.lineVisible;
    state.previewTransition = true;
    setMedia(state, media);
    state.compareZoom = compareZoom;
    state.comparePanX = comparePanX;
    state.comparePanY = comparePanY;
    state.lineVisible = lineVisible;
    updateBatchSelector(state);
    updateVideoControls(state);
    updatePreviewLayout(state);
    scheduleDimensionLabelRefresh(state);
    markDirty();
}

function nodeBodyColor(node) {
    return node.bgcolor || node.color || "#24272f";
}

function updatePreviewLayout(state) {
    if (!state) return;
    // Leave the DOM preview transparent; the node body directly underneath
    // supplies the same background colour while labels render in screen space.
    state.stage.style.background = "transparent";
    state.root.style.background = "transparent";
    requestAnimationFrame(() => { updateMediaGeometry(state); updateDividerGeometry(state); drawCanvasPreview(state); });
}

function forwardWheelToCanvas(event) {
    const canvas = app.canvas?.canvas || app.canvas?.canvasEl || document.querySelector("canvas#graph-canvas, canvas.lgraphcanvas, .graph-canvas canvas");
    if (!canvas) return;
    event.preventDefault();
    const forwarded = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
    });
    canvas.dispatchEvent(forwarded);
}

function createComparer(node) {
    if (node.__ghComparer) return;
    const saved = node.properties?.[STATE_KEY] || {};
    const initialView = VIEW_MODES.some(([key]) => key === saved.view) ? saved.view : "slide";
    const root = el("div", { width: "100%", height: "100%", minHeight: "0", display: "flex", flexDirection: "column", boxSizing: "border-box", padding: "0", color: "#eee", fontFamily: "Arial, sans-serif" });
    root.classList.add("gh-comparer");
    const top = el("div", { display: "flex", flex: "0 0 auto", alignItems: "center", gap: "6px", marginBottom: "2px", position: "relative", flexWrap: "wrap" });
    const viewButton = button(VIEW_MODES.find(([key]) => key === initialView)?.[1] || "滑动对比", "切换对比视图", (event) => {
        const currentIndex = VIEW_MODES.findIndex(([key]) => key === state.view);
        const nextMode = VIEW_MODES[(currentIndex + 1) % VIEW_MODES.length]?.[0] || "slide";
        setView(state, nextMode);
        // Do not leave the graph widget button as the keyboard event target.
        // ComfyUI's native Space handler must receive the next Space gesture
        // as a canvas interaction so it can pan the graph.
        event.currentTarget?.blur?.();
        // Blurring alone leaves focus on the document body. Return focus to
        // ComfyUI's actual graph canvas so Space+drag works immediately after
        // switching views, without requiring a click on empty canvas space.
        const graphCanvas = app.canvas?.canvas || document.getElementById("graph-canvas");
        graphCanvas?.focus?.({ preventScroll: true });
    });
    Object.assign(viewButton.style, { height: "24px", minWidth: "54px", padding: "0 7px", background: "transparent", fontSize: "12px", borderRadius: "6px" });
    const batchSelector = el("div", {
        display: "none", alignItems: "center", justifyContent: "center", gap: "1px",
        marginLeft: "auto", marginRight: "auto", minHeight: "24px", zIndex: "2",
    });
    top.append(viewButton, batchSelector);

    const videoControls = el("div", { display: "none", alignItems: "center", gap: "5px", flexWrap: "wrap" });
    videoControls.classList.add("gh-comparer-video-controls");
    top.appendChild(videoControls);
    // A zero flex basis fills the available height without feeding the previous
    // preview height back into Vue's minimum node size during a shrink gesture.
    const stage = el("div", { position: "relative", isolation: "isolate", flex: "1 1 0px", width: "100%", height: "0", minHeight: "180px", overflow: "visible", background: nodeBodyColor(node), borderRadius: "0", cursor: "ew-resize", border: "0", boxSizing: "border-box", paddingBottom: "16px" });
    stage.classList.add("gh-comparer-stage");
    // Keep the full-bleed pixels, but leave Legacy's native resize corner
    // outside the preview hit area so a resize cannot become a node drag.
    stage.style.pointerEvents = "none";
    const previewHitArea = el("div", {
        position: "absolute", inset: "0", pointerEvents: "auto",
        clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) calc(100% - 12px), calc(100% - 12px) 100%, 0 100%)",
    });
    previewHitArea.style.cursor = "default";
    stage.appendChild(previewHitArea);
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", zIndex: "10", pointerEvents: "none" });
    stage.appendChild(canvas);
    const labelSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    Object.assign(labelSvg.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "1000", pointerEvents: "none", overflow: "hidden" });
    labelSvg.setAttribute("aria-hidden", "true");
    document.body.appendChild(labelSvg);
    const aPane = el("div", { position: "absolute", left: "0", top: "0", right: "0", bottom: "16px", overflow: "hidden" });
    const bPane = el("div", { position: "absolute", inset: "0", overflow: "hidden" });
    const bClip = el("div", { position: "absolute", left: "0", top: "0", right: "0", bottom: "16px", overflow: "hidden" });
    bClip.appendChild(bPane);
    const divider = el("div", { position: "absolute", top: "0", width: "1px", height: "100%", background: "#fff", mixBlendMode: "difference", pointerEvents: "none", zIndex: "5", transform: "translate3d(0,0,0)", willChange: "transform, opacity", opacity: "0", boxShadow: "none", outline: "none" });
    const sizeStyle = { position: "absolute", bottom: "2px", zIndex: "8", color: "#aeb3bc", fontSize: "10px", lineHeight: "13px", textShadow: "none", pointerEvents: "none", boxSizing: "border-box", padding: "0 7px" };
    const aSize = el("div", sizeStyle);
    const bSize = el("div", sizeStyle);
    stage.append(aPane, bClip, divider, aSize, bSize);
    aPane.style.display = "none"; bClip.style.display = "none"; divider.style.display = "none"; aSize.style.display = "none"; bSize.style.display = "none";
    const progressRow = el("div", { display: "none", flex: "0 0 auto", alignItems: "center", gap: "8px", marginTop: "2px" });
    const progress = document.createElement("input");
    progress.classList.add("gh-comparer-progress");
    progress.type = "range"; progress.min = "0"; progress.max = "1000"; progress.step = "any"; progress.value = "0";
    Object.assign(progress.style, { flex: "1", minWidth: "80px" });
    const time = el("span", { minWidth: "72px", fontSize: "11px", textAlign: "right", color: "#cfd4dc", whiteSpace: "nowrap" }, "0:00 / 0:00");
    const transportButton = button("", "播放", () => {
        if (!state.playing) { togglePlayback(state); return; }
        state.frameStepIndex = null;
        state.playing = false;
        videos(state).forEach((video) => { video.pause(); video.currentTime = 0; });
        updateVideoControls(state);
        updateProgress(state);
    });
    transportButton.classList.add("gh-comparer-transport");
    Object.assign(transportButton.style, { display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 20px", minWidth: "20px", height: "24px", padding: "0", border: "0", background: "transparent" });
    progressRow.append(transportButton, progress, time);
    root.append(top, stage, progressRow);

    const state = node.__ghComparer = {
        node, root, stage, canvas, labelSvg, aPane, bClip, bPane, divider, aSize, bSize, videoControls, progressRow, progress, time, viewButton, batchSelector, transportButton,
        view: initialView, position: Number.isFinite(saved.position) ? saved.position : 0.5,
        compareZoom: 1, comparePanX: 0, comparePanY: 0,
        speed: saved.speed || 1, audioMode: saved.audioMode ?? null, syncEnabled: true,
        media: { a: { kind: "unknown" }, b: { kind: "unknown" } }, playing: false, seeking: false, previewDirty: true,
        aElement: null, bElement: null, lineVisible: false, previewBounds: null,
    };

    state.speedButton = button("1x", "切换播放速度", () => {
        state.speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
        videos(state).forEach((video) => { video.playbackRate = state.speed; });
        updateVideoControls(state);
    });
    state.audioButton = button("静音", "切换音频 A / 音频 B / 音频 A+B / 静音", () => {
        state.audioMode = state.audioMode === "none" ? "a" : state.audioMode === "a" ? "b" : state.audioMode === "b" ? "both" : "none";
        state.node.properties ??= {};
        state.node.properties[STATE_KEY] = { view: state.view, position: state.position, speed: state.speed, audioMode: state.audioMode, syncEnabled: state.syncEnabled };
        applyAudio(state);
    });
    state.fullscreenButton = button("全屏", "全屏对比", async () => {
        if (document.fullscreenElement === root) await document.exitFullscreen?.();
        else await root.requestFullscreen?.();
    });
    videoControls.append(state.speedButton, state.audioButton, state.fullscreenButton);
    state.onFullscreenChange = () => {
        (document.fullscreenElement === root ? root : document.body).appendChild(labelSvg);
        updateVideoControls(state);
        updatePreviewLayout(state);
    };
    document.addEventListener("fullscreenchange", state.onFullscreenChange);

    let panning = false;
    let comparePanning = false;
    let comparePanPointerId = null;
    let comparePanLast = null;
    let spacePressed = false;
    const forwardPointer = (method, event, buttonValue, buttonsValue) => {
        const handler = app.canvas?.[method];
        const canvas = app.canvas?.canvas;
        if (typeof handler !== "function" || !canvas) return false;
        const rect = canvas.getBoundingClientRect();
        const forwarded = Object.create(event);
        const canvasX = (event.clientX - rect.left) / Math.max(app.canvas?.ds?.scale || 1, 0.0001);
        const canvasY = (event.clientY - rect.top) / Math.max(app.canvas?.ds?.scale || 1, 0.0001);
        Object.defineProperties(forwarded, {
            target: { value: canvas }, currentTarget: { value: canvas },
            button: { value: buttonValue }, buttons: { value: buttonsValue },
            offsetX: { value: event.clientX - rect.left }, offsetY: { value: event.clientY - rect.top },
            x: { value: event.clientX }, y: { value: event.clientY },
            canvasX: { value: canvasX }, canvasY: { value: canvasY },
            isPrimary: { value: true }, pointerId: { value: event.pointerId || 1 },
        });
        handler.call(app.canvas, forwarded);
        return true;
    };
    const manualPanStart = (event) => {
        state.manualPan = { x: event.clientX, y: event.clientY };
        if (app.canvas) app.canvas.dragging_canvas = true;
    };
    const manualPanMove = (event) => {
        const previous = state.manualPan;
        const ds = app.canvas?.ds;
        if (!previous || !ds?.offset) return;
        ds.offset[0] += (event.clientX - previous.x) / Math.max(ds.scale || 1, 0.0001);
        ds.offset[1] += (event.clientY - previous.y) / Math.max(ds.scale || 1, 0.0001);
        state.manualPan = { x: event.clientX, y: event.clientY };
        app.canvas?.setDirty?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
        scheduleDimensionLabelRefresh(state);
    };
    const setDividerVisible = (visible) => {
        const next = Boolean(visible && effectiveView(state) === "slide" && (isRealMedia(state.media?.a) || isRealMedia(state.media?.b)));
        state.divider.style.display = effectiveView(state) === "slide" ? "block" : "none";
        state.divider.style.opacity = next ? "1" : "0";
        if (state.lineVisible === next) return;
        state.lineVisible = next;
        drawCanvasPreview(state);
    };
    const pointInsideStage = (event) => {
        if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
        const rect = stage.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    };
    const eventHitsStage = (event) => pointInsideStage(event);
    const isNodes2Node = () => Boolean(root.closest('[data-testid^="node-body-"]'));
    const isLegacyNode = () => !isNodes2Node();
    const beginCanvasPan = (event) => {
        const panGesture = event.button === 1;
        if (!panGesture || panning || state.nodeDragging || !eventHitsStage(event)) return false;
        event.preventDefault();
        event.stopPropagation();
        panning = true;
        state.panButton = event.button === 1 ? 1 : 0;
        state.panPointerId = event.pointerId;
        setDividerVisible(false);
        if (event.pointerId != null) stage.setPointerCapture?.(event.pointerId);
        manualPanStart(event);
        return true;
    };
    const updateCompareCursor = (event) => {
        if (event && ["pointerdown", "pointermove", "pointerup", "pointercancel", "pointerenter", "pointerleave", "mousedown", "mousemove", "mouseup", "wheel"].includes(event.type) && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
            state.comparePointerInside = eventHitsStage(event);
        }
        const active = Boolean((event?.altKey || state.compareAltKey) && effectiveView(state) !== "slide" && state.comparePointerInside);
        previewHitArea.style.cursor = active ? (comparePanning ? "grabbing" : "grab") : "default";
        stage.style.cursor = active ? (comparePanning ? "grabbing" : "grab") : (effectiveView(state) === "slide" ? "ew-resize" : "default");
    };
    const endPan = (event) => {
        if (!panning || (state.panPointerId != null && event?.pointerId != null && event.pointerId !== state.panPointerId)) return;
        if (!state.manualPan) forwardPointer("processMouseUp", event, state.panButton ?? 0, 0);
        if (app.canvas) app.canvas.dragging_canvas = false;
        state.manualPan = null;
        state.panPointerId = null;
        panning = false;
        try { if (event?.pointerId != null && stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId); } catch (_) {}
        setDividerVisible(pointInsideStage(event));
    };
    const beginComparePan = (event) => {
        const leftButtonDown = event.button === 0 || Boolean(event.buttons & 1);
        if (!leftButtonDown || !event.altKey || effectiveView(state) === "slide" || !eventHitsStage(event)) return false;
        event.preventDefault();
        event.stopPropagation();
        // A graph overlay can win the initial native event in Nodes 2.0. If
        // it already started moving the node, restore its original position
        // before taking over the same pointer as a compare-pan gesture.
        if (state.nodeDragging && state.nodeDragStart) {
            state.node.pos[0] = state.nodeDragStart.nodeX;
            state.node.pos[1] = state.nodeDragStart.nodeY;
            state.nodeDragging = false;
            state.dragPointerId = null;
            state.nodeDragStart = null;
            app.graph?.setDirtyCanvas?.(true, true);
        }
        comparePanning = true;
        comparePanPointerId = event.pointerId ?? null;
        comparePanLast = { x: event.clientX, y: event.clientY };
        setDividerVisible(false);
        updateCompareCursor(event);
        try { stage.setPointerCapture(event.pointerId); } catch (_) {}
        return true;
    };
    const forwardNodes2PointerDown = (event) => {
        // Nodes 2.0 mounts this DOM widget below WidgetDOM.vue, whose
        // pointer handlers stop propagation before the .lg-node handler can
        // see events originating in the preview. Forward only the ordinary
        // left-button gesture to the native node element; Alt comparison and
        // Space/canvas gestures keep their existing paths above this bridge.
        if (isLegacyNode() || event.button !== 0 || event.altKey || spacePressed || panning || comparePanning || !eventHitsStage(event)) return false;
        const nodeRoot = root.closest(".lg-node");
        if (!(nodeRoot instanceof HTMLElement)) return false;
        if (videos(state).length > 0) {
            state.nodes2VideoClick = {
                pointerId: event.pointerId ?? null,
                x: event.clientX,
                y: event.clientY,
                moved: false,
            };
        } else {
            state.nodes2VideoClick = null;
        }
        const pointerId = event.pointerId;
        try {
            if (pointerId != null) nodeRoot.setPointerCapture?.(pointerId);
        } catch (_) {
            // The native handler below can still process the initial event;
            // pointer capture is only needed to keep the drag after exit.
        }
        const forwarded = new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            isPrimary: event.isPrimary,
            button: event.button,
            buttons: event.buttons,
            clientX: event.clientX,
            clientY: event.clientY,
            screenX: event.screenX,
            screenY: event.screenY,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
        });
        nodeRoot.dispatchEvent(forwarded);
        return true;
    };
    const captureNodes2VideoPointerMove = (event) => {
        const pending = state.nodes2VideoClick;
        if (!pending || (pending.pointerId != null && event.pointerId != null && event.pointerId !== pending.pointerId)) return;
        // Match Nodes 2.0's native useClickDragGuard(3) threshold so a
        // gesture that native dragging considers a drag cannot also toggle
        // video playback on release.
        if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= 3) pending.moved = true;
    };
    const captureNodes2VideoPointerUp = (event) => {
        const pending = state.nodes2VideoClick;
        if (!pending || (pending.pointerId != null && event.pointerId != null && event.pointerId !== pending.pointerId)) return;
        state.nodes2VideoClick = null;
        // Nodes 2.0 receives the forwarded pointerdown and owns the drag. Only
        // a click-sized gesture should retain the comparer video action.
        if (!pending.moved && videos(state).length > 0) togglePlayback(state);
    };
    const captureNodes2VideoPointerCancel = (event) => {
        const pending = state.nodes2VideoClick;
        if (!pending || (pending.pointerId != null && event.pointerId != null && event.pointerId !== pending.pointerId)) return;
        state.nodes2VideoClick = null;
    };
    state.captureNodes2VideoPointerMove = captureNodes2VideoPointerMove;
    state.captureNodes2VideoPointerUp = captureNodes2VideoPointerUp;
    state.captureNodes2VideoPointerCancel = captureNodes2VideoPointerCancel;
    window.addEventListener("pointermove", captureNodes2VideoPointerMove, { capture: true, passive: true });
    window.addEventListener("pointerup", captureNodes2VideoPointerUp, { capture: true, passive: true });
    window.addEventListener("pointercancel", captureNodes2VideoPointerCancel, { capture: true, passive: true });
    const captureAltPointerDown = (event) => {
        if (!event.altKey || event.button !== 0 || effectiveView(state) === "slide" || !eventHitsStage(event)) return;
        if (beginComparePan(event)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    state.captureAltPointerDown = captureAltPointerDown;
    window.addEventListener("pointerdown", captureAltPointerDown, { capture: true, passive: false });
    document.addEventListener("pointerdown", captureAltPointerDown, { capture: true, passive: false });
    // The transparent hit surface is the only pointer-enabled element in the
    // preview. Listen on it directly as well as on the graph/document capture
    // layers so both Legacy LiteGraph and Nodes 2.0 start the same gesture.
    previewHitArea.addEventListener("pointerdown", captureAltPointerDown, { capture: true, passive: false });
    const endComparePan = (event) => {
        if (!comparePanning || (comparePanPointerId != null && event?.pointerId != null && event.pointerId !== comparePanPointerId)) return;
        comparePanning = false;
        comparePanPointerId = null;
        comparePanLast = null;
        try { if (event?.pointerId != null && stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId); } catch (_) {}
        if (pointInsideStage(event)) setDividerVisible(true);
        updateCompareCursor(event);
    };
    const moveComparePan = (event) => {
        if (!comparePanning || (comparePanPointerId != null && event?.pointerId != null && event.pointerId !== comparePanPointerId)) return false;
        event.preventDefault();
        event.stopImmediatePropagation();
        const previous = comparePanLast;
        const rect = stage.getBoundingClientRect();
        if (previous && rect.width > 0 && rect.height > 0) {
            const scaleX = stage.clientWidth / rect.width;
            const scaleY = stage.clientHeight / rect.height;
            updateComparePan(state, (event.clientX - previous.x) * scaleX, (event.clientY - previous.y) * scaleY);
        }
        comparePanLast = { x: event.clientX, y: event.clientY };
        updateCompareCursor(event);
        return true;
    };
    const captureComparePointerMove = (event) => {
        // Recover when a Nodes 2.0 graph overlay consumed pointerdown before
        // this comparer saw it. Starting on the first drag move keeps the
        // node fixed and makes the gesture behave like a normal pan.
        if (!comparePanning && event.altKey && (event.buttons & 1) && eventHitsStage(event)) beginComparePan(event);
        moveComparePan(event);
        updateCompareCursor(event);
    };
    const captureComparePointerUp = (event) => {
        if (!comparePanning || (comparePanPointerId != null && event?.pointerId != null && event.pointerId !== comparePanPointerId)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        endComparePan(event);
    };
    state.captureComparePointerMove = captureComparePointerMove;
    state.captureComparePointerUp = captureComparePointerUp;
    window.addEventListener("pointermove", captureComparePointerMove, { capture: true, passive: false });
    document.addEventListener("pointermove", captureComparePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", captureComparePointerUp, { capture: true, passive: false });
    document.addEventListener("pointerup", captureComparePointerUp, { capture: true, passive: false });
    window.addEventListener("pointercancel", captureComparePointerUp, { capture: true, passive: false });
    document.addEventListener("pointercancel", captureComparePointerUp, { capture: true, passive: false });
    previewHitArea.addEventListener("pointermove", captureComparePointerMove, { capture: true, passive: false });
    previewHitArea.addEventListener("pointerup", captureComparePointerUp, { capture: true, passive: false });
    previewHitArea.addEventListener("pointercancel", captureComparePointerUp, { capture: true, passive: false });
    const captureAltMouseDown = (event) => {
        if (!event.altKey || event.button !== 0 || effectiveView(state) === "slide" || !eventHitsStage(event)) return;
        // Some Nodes 2.0 builds still listen for mousedown in their graph
        // drag layer. Suppress that fallback after Pointer Events have had
        // the chance to start the compare-pan gesture.
        if (!comparePanning) beginComparePan(event);
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    const captureCompareMouseMove = (event) => {
        if (!comparePanning && event.altKey && (event.buttons & 1) && eventHitsStage(event)) beginComparePan(event);
        if (!comparePanning || comparePanPointerId != null) {
            updateCompareCursor(event);
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        const previous = comparePanLast;
        const rect = stage.getBoundingClientRect();
        if (previous && rect.width > 0 && rect.height > 0) {
            const scaleX = stage.clientWidth / rect.width;
            const scaleY = stage.clientHeight / rect.height;
            updateComparePan(state, (event.clientX - previous.x) * scaleX, (event.clientY - previous.y) * scaleY);
        }
        comparePanLast = { x: event.clientX, y: event.clientY };
        updateCompareCursor(event);
    };
    const captureCompareMouseUp = (event) => {
        if (!comparePanning || comparePanPointerId != null) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        endComparePan(event);
    };
    state.captureAltMouseDown = captureAltMouseDown;
    state.captureCompareMouseMove = captureCompareMouseMove;
    state.captureCompareMouseUp = captureCompareMouseUp;
    window.addEventListener("mousedown", captureAltMouseDown, { capture: true, passive: false });
    document.addEventListener("mousedown", captureAltMouseDown, { capture: true, passive: false });
    previewHitArea.addEventListener("mousedown", captureAltMouseDown, { capture: true, passive: false });
    window.addEventListener("mousemove", captureCompareMouseMove, { capture: true, passive: false });
    document.addEventListener("mousemove", captureCompareMouseMove, { capture: true, passive: false });
    window.addEventListener("mouseup", captureCompareMouseUp, { capture: true, passive: false });
    document.addEventListener("mouseup", captureCompareMouseUp, { capture: true, passive: false });
    previewHitArea.addEventListener("mousemove", captureCompareMouseMove, { capture: true, passive: false });
    previewHitArea.addEventListener("mouseup", captureCompareMouseUp, { capture: true, passive: false });
    const captureCompareKey = (event) => {
        if (event.key === "Alt") {
            state.compareAltKey = event.type === "keydown";
            // Alt+wheel is a comparer gesture in split views. Prevent the
            // browser from moving focus to its application menu, while still
            // allowing ComfyUI and the page to receive all unrelated keys.
            if (event.type === "keydown" && state.comparePointerInside && effectiveView(state) !== "slide") {
                event.preventDefault();
            }
            // KeyboardEvent.clientX/clientY are normally 0; do not use them
            // to overwrite the pointer location tracked by pointer events.
            updateCompareCursor();
        }
    };
    state.captureCompareKey = captureCompareKey;
    window.addEventListener("keydown", captureCompareKey, { capture: true, passive: false });
    window.addEventListener("keyup", captureCompareKey, { capture: true, passive: false });
    document.addEventListener("keydown", captureCompareKey, { capture: true, passive: false });
    document.addEventListener("keyup", captureCompareKey, { capture: true, passive: false });
    const moveNode = (event) => {
        if (!state.nodeDragging || (state.dragPointerId != null && event.pointerId != null && event.pointerId !== state.dragPointerId)) return;
        const start = state.nodeDragStart;
        const scale = Math.max(Number(app.canvas?.ds?.scale) || 1, 0.0001);
        if (!start) return;
        if (state.videoClickPending) {
            if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) return;
            state.videoClickPending = false;
        }
        const next = [
            start.nodeX + (event.clientX - start.x) / scale,
            start.nodeY + (event.clientY - start.y) / scale,
        ];
        // Use LiteGraph's public setter first. Some ComfyUI builds keep
        // additional layout state alongside `pos`, so mutating the array
        // alone does not move the node's DOM widget.
        if (typeof state.node.setPosition === "function") {
            state.node.setPosition(next);
        }
        // Keep a compatibility fallback for builds whose node implementation
        // exposes `pos` but does not update it through setPosition().
        if (!Array.isArray(state.node.pos) || state.node.pos[0] !== next[0] || state.node.pos[1] !== next[1]) {
            state.node.pos = next;
        }
        state.node.onPositionChanged?.();
        app.graph?.change?.();
        app.canvas?.setDirty?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
        scheduleDimensionLabelRefresh(state);
    };
    const finishNode = (event) => {
        if (!state.nodeDragging || (event?.pointerId != null && state.dragPointerId != null && event.pointerId !== state.dragPointerId)) return;
        const playClick = state.videoClickPending && event?.type === "pointerup";
        state.videoClickPending = false;
        state.nodeDragging = false;
        state.dragPointerId = null;
        state.nodeDragStart = null;
        if (playClick) togglePlayback(state);
        try { if (event?.pointerId != null && stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId); } catch (_) {}
        // Re-enable hover comparison immediately when released over the preview;
        // otherwise keep the divider hidden until the pointer re-enters.
        if (pointInsideStage(event)) {
            setDividerVisible(true);
            scheduleSlidePosition(state, event.clientX);
        } else {
            setDividerVisible(false);
        }
    };
    const beginNodeDrag = (event) => {
        // Nodes 2.0 owns normal node movement in its parent interaction layer.
        // Only Legacy needs the local adapter because the DOM widget covers the
        // canvas hit target there.
        if (!isLegacyNode() || event.button !== 0 || spacePressed || panning || state.nodeDragging || !eventHitsStage(event)) return false;
        if (beginCanvasPan(event)) return true;
        if (beginComparePan(event)) return true;
        event.preventDefault();
        event.stopPropagation();
        state.nodeDragging = true;
        state.videoClickPending = videos(state).length > 0;
        state.dragPointerId = event.pointerId ?? null;
        state.nodeDragStart = {
            x: event.clientX, y: event.clientY,
            nodeX: Number(state.node.pos?.[0]) || 0,
            nodeY: Number(state.node.pos?.[1]) || 0,
        };
        // Explicitly select the node so ComfyUI/LiteGraph treats the custom
        // DOM widget as part of the node being moved.
        if (typeof app.canvas?.selectNode === "function") {
            app.canvas.selectNode(state.node, false);
        } else {
            state.node.is_selected = true;
        }
        setDividerVisible(false);
        try {
            stage.setPointerCapture(event.pointerId);
        } catch (_) {
        // Pointer capture keeps the drag alive after the pointer leaves the preview.
        }
        return true;
    };
    stage.addEventListener("pointerdown", (event) => {
        if (beginCanvasPan(event)) return;
        if (forwardNodes2PointerDown(event)) return;
        beginNodeDrag(event);
    });
    stage.addEventListener("contextmenu", (event) => {
        // Nodes 2.0 already owns the node context-menu event. Let it bubble
        // through the DOM node unchanged; Legacy's DOM widget covers the
        // canvas, so only Legacy needs this small native menu bridge.
        if (!isLegacyNode()) return;
        event.preventDefault();
        event.stopPropagation();
        app.canvas?.adjustMouseEvent?.(event);
        app.canvas?.processContextMenu?.(node, event);
    });
    stage.addEventListener("pointermove", (event) => {
        if (comparePanning) {
            moveComparePan(event);
        } else if (panning) {
            event.preventDefault();
            if (state.manualPan) manualPanMove(event);
            else {
                forwardPointer("processMouseMove", event, 0, 1);
                scheduleDimensionLabelRefresh(state);
            }
        } else if (state.nodeDragging) {
            event.preventDefault();
            // Do not call scheduleSlidePosition here: node dragging and
            // comparison sliding are mutually exclusive gestures.
            moveNode(event);
        } else if (effectiveView(state) === "slide") {
            setDividerVisible(true);
            scheduleSlidePosition(state, event.clientX);
        }
    });
    stage.addEventListener("pointerup", (event) => {
        if (comparePanning) endComparePan(event);
        else if (panning) endPan(event);
        else finishNode(event);
    });
    stage.addEventListener("pointercancel", (event) => {
        if (comparePanning) endComparePan(event);
        else if (panning) endPan(event);
        else finishNode(event);
    });
    stage.addEventListener("pointerleave", (event) => {
        state.comparePointerInside = false;
        // Settle on whichever image occupied most of the preview immediately
        // before the pointer left: the left half favors A, the right half B.
        // Pointer capture keeps an active node drag alive while outside.
        if (effectiveView(state) === "slide") {
            state.position = state.position > 0.5 ? 1 : 0;
            updateDividerGeometry(state);
        }
        setDividerVisible(false);
        if (effectiveView(state) === "slide") drawCanvasPreview(state);
        if (panning) {
            if (state.manualPan) manualPanMove(event);
            else {
                forwardPointer("processMouseMove", event, 0, 1);
                scheduleDimensionLabelRefresh(state);
            }
        } else if (state.nodeDragging) {
            moveNode(event);
        }
    });
    stage.addEventListener("pointerenter", (event) => {
        state.comparePointerInside = true;
        if (!panning && !state.nodeDragging) {
            scheduleSlidePosition(state, event.clientX);
            setDividerVisible(true);
        }
    });
    const captureSpaceKey = (event) => {
        if (event.code !== "Space") return;
        spacePressed = event.type === "keydown";
        previewHitArea.style.pointerEvents = spacePressed ? "none" : "auto";
        // Let ComfyUI receive Space for native canvas panning. Only suppress
        // the browser's button activation when a comparer control is focused.
        const activeElement = document.activeElement;
        if (state.root.contains(activeElement) && activeElement?.matches?.("button, input, select, textarea, [contenteditable='true']")) {
            event.preventDefault();
            if (event.type === "keydown" && activeElement instanceof HTMLElement) activeElement.blur();
        }
    };
    state.captureSpaceKey = captureSpaceKey;
    window.addEventListener("keydown", captureSpaceKey, true);
    window.addEventListener("keyup", captureSpaceKey, true);
    document.addEventListener("keydown", captureSpaceKey, true);
    document.addEventListener("keyup", captureSpaceKey, true);
    const clearSpaceKey = () => { spacePressed = false; previewHitArea.style.pointerEvents = "auto"; };
    state.clearSpaceKey = clearSpaceKey;
    window.addEventListener("blur", clearSpaceKey);
    state.stopFrameStep = () => {
        clearInterval(state.frameStepTimer);
        state.frameStepTimer = null;
        state.frameStepKey = null;
    };
    state.stepFrame = (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        const selected = Object.values(app.canvas?.selected_nodes || {});
        if (document.fullscreenElement !== root && (selected.length !== 1 || selected[0].id !== node.id)) return;
        const master = videoMaster(state);
        if (!master || state.playPending) return;
        const data = master === state.aElement ? state.media.a : state.media.b;
        const fps = Number(data.frame_rate);
        if (!(fps > 0)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.repeat || state.frameStepKey === event.key) return;
        state.stopFrameStep();
        if (state.playing || state.frameStepIndex == null) {
            state.frameStepIndex = Math.floor(master.currentTime * fps + 0.0001);
        }
        state.playing = false;
        videos(state).forEach((video) => video.pause());
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const step = () => {
            const selectedNow = Object.values(app.canvas?.selected_nodes || {});
            if (videoMaster(state) !== master || (document.fullscreenElement !== root && (selectedNow.length !== 1 || selectedNow[0].id !== node.id))) {
                state.stopFrameStep();
                return;
            }
            const lastFrame = Math.max(0, Math.ceil(master.duration * fps) - 1);
            state.frameStepIndex = Math.max(0, Math.min(lastFrame, state.frameStepIndex + direction));
            // Seek inside the frame, not onto a rounded timestamp boundary.
            const target = Math.min(master.duration, (state.frameStepIndex + 0.5) / fps);
            requestVideoSeek(state, target);
            updateVideoControls(state);
            updateProgress(state);
        };
        state.frameStepKey = event.key;
        step();
        state.frameStepTimer = setInterval(step, 1000 / 12);
    };
    state.releaseFrameStep = (event) => {
        if (event.key === state.frameStepKey) state.stopFrameStep();
    };
    window.addEventListener("keydown", state.stepFrame, true);
    window.addEventListener("keyup", state.releaseFrameStep, true);
    window.addEventListener("blur", state.stopFrameStep);
    stage.addEventListener("auxclick", (event) => { if (event.button === 1) event.preventDefault(); });
    const captureAltWheel = (event) => {
        if (!event.altKey || effectiveView(state) === "slide" || !pointInsideComparerStage(state, event)) return;
        // Nodes 2.0 handles graph-wheel gestures before the widget's bubbling
        // listener. Capture at window level so the gesture is consumed before
        // it can reach that handler.
        event.preventDefault();
        event.stopImmediatePropagation();
        zoomCompareAt(state, event);
        scheduleDimensionLabelRefresh(state);
    };
    state.captureAltWheel = captureAltWheel;
    window.addEventListener("wheel", captureAltWheel, { capture: true, passive: false });
    document.addEventListener("wheel", captureAltWheel, { capture: true, passive: false });
    root.addEventListener("wheel", (event) => {
        // Alt+wheel is reserved for zooming media inside a split preview.
        // Do not forward this gesture to LiteGraph, whose wheel handler would
        // zoom the whole canvas (and consequently change the node's screen size).
        if (event.altKey && effectiveView(state) !== "slide" && pointInsideComparerStage(state, event)) {
            zoomCompareAt(state, event);
            event.preventDefault();
            event.stopImmediatePropagation();
            scheduleDimensionLabelRefresh(state);
            return;
        }
        forwardWheelToCanvas(event);
        scheduleDimensionLabelRefresh(state);
    }, { passive: false });
    for (const eventName of ["click", "dblclick"]) {
        root.addEventListener(eventName, (event) => event.stopPropagation());
    }
    progress.addEventListener("input", () => {
        state.stopFrameStep();
        state.frameStepIndex = null;
        state.seeking = true;
        const items = videos(state);
        const master = videoMaster(state);
        const duration = master?.duration || 0;
        const target = duration * Number(progress.value) / 1000;
        progress.style.setProperty("--played", `${Number(progress.value) / 10}%`);
        requestVideoSeek(state, target);
        time.textContent = `${formatTime(target)} / ${formatTime(duration)}`;
    });
    progress.addEventListener("change", () => { state.seeking = false; updateProgress(state); });

    const widget = node.addDOMWidget("gh_image_video_comparer", "gh_compare", root, {
        serialize: false, hideOnZoom: false,
        getMinHeight: () => 180,
        getMaxHeight: () => undefined,
        afterResize: () => updatePreviewLayout(state),
    });
    widget.options ??= {};
    widget.options.minNodeSize = [MIN_NODE_WIDTH, MIN_NODE_HEIGHT];
    node.setSize?.([Math.max(node.size[0], MIN_NODE_WIDTH), Math.max(node.size[1], MIN_NODE_HEIGHT)]);
    if (!COMPARER_STATES.size) {
        window.addEventListener("resize", refreshAllComparerPositions, { passive: true });
        window.addEventListener("scroll", refreshAllComparerPositions, { passive: true, capture: true });
    }
    COMPARER_STATES.add(state);
    observeComparerTransforms();
    comparerResizeObserver.observe(stage);
    setMedia(state, node.properties?.[MEDIA_KEY] || state.media);
    setView(state, state.view);
    updatePreviewLayout(state);
    scheduleDimensionLabelRefresh(state);
}

app.registerExtension({
    name: "GoohaiTools.ImageVideoComparer.GH",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;

        const computeSize = nodeType.prototype.computeSize;
        nodeType.prototype.computeSize = function () {
            const size = computeSize.apply(this, arguments);
            size[0] = Math.max(size[0], MIN_NODE_WIDTH);
            size[1] = Math.max(size[1], MIN_NODE_HEIGHT);
            return size;
        };

        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            this.setSize([350, 600]);
            setTimeout(() => { try { createComparer(this); } catch (error) { console.error("[GoohaiTools] comparer init failed", error); } }, 0);
            return result;
        };

        const configured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = configured?.apply(this, arguments);
            this.setSize([Math.max(this.size[0], MIN_NODE_WIDTH), Math.max(this.size[1], MIN_NODE_HEIGHT)]);
            setTimeout(() => {
                try { createComparer(this); } catch (error) { console.error("[GoohaiTools] comparer configure failed", error); return; }
                const cached = this.properties?.[MEDIA_KEY];
                setMedia(this.__ghComparer, cached && (isRealMedia(cached.a) || isRealMedia(cached.b)) ? cached : undefined);
            }, 0);
            return result;
        };

        const connected = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, index) {
            const result = connected?.apply(this, arguments);
            setTimeout(() => {
                createComparer(this);
                enforceSameInputType(this, index);
                updateVideoControls(this.__ghComparer);
                updatePreviewLayout(this.__ghComparer);
            }, 0);
            return result;
        };

        const resized = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            this.size[0] = Math.max(this.size[0], MIN_NODE_WIDTH);
            this.size[1] = Math.max(this.size[1], MIN_NODE_HEIGHT);
            const result = resized?.apply(this, arguments);
            updatePreviewLayout(this.__ghComparer);
            return result;
        };

        const foreground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function (ctx) {
            const result = foreground?.apply(this, arguments);
            const state = this.__ghComparer;
            if (state && state.lastBodyColor !== nodeBodyColor(this)) {
                state.lastBodyColor = nodeBodyColor(this);
                updatePreviewLayout(state);
            }
            // Graph panning/moving changes the node transform, not the preview
            // pixels. Avoid clearing and repainting the image every graph
            // frame; only content/layout interactions mark it dirty.
            if (state) scheduleDimensionLabelRefresh(state);
            return result;
        };

        const executed = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            const result = executed?.apply(this, arguments);
            const payload = Array.isArray(message?.gh_compare) ? message.gh_compare[0] : message?.gh_compare;
            if (payload && !payload.preserve) {
                createComparer(this);
                setMedia(this.__ghComparer, { a: payload.a || { kind: "unknown" }, b: payload.b || { kind: "unknown" } }, true);
                updateVideoControls(this.__ghComparer);
            }
            return result;
        };

        const removed = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (this.__ghComparer) {
                stopMedia(this.__ghComparer.aElement);
                stopMedia(this.__ghComparer.bElement);
                COMPARER_STATES.delete(this.__ghComparer);
                PENDING_COMPARERS.delete(this.__ghComparer);
                comparerResizeObserver.unobserve(this.__ghComparer.stage);
                observeComparerTransforms();
                if (!COMPARER_STATES.size) {
                    cancelAnimationFrame(comparerRefreshFrame);
                    comparerRefreshFrame = 0;
                    window.removeEventListener("resize", refreshAllComparerPositions);
                    window.removeEventListener("scroll", refreshAllComparerPositions, true);
                }
                this.__ghComparer.labelSvg?.remove();
                cancelAnimationFrame(this.__ghComparer.videoPreviewFrame);
                cancelAnimationFrame(this.__ghComparer.progressFrame);
                document.removeEventListener("fullscreenchange", this.__ghComparer.onFullscreenChange);
                window.removeEventListener("keydown", this.__ghComparer.stepFrame, true);
                window.removeEventListener("keyup", this.__ghComparer.releaseFrameStep, true);
                window.removeEventListener("blur", this.__ghComparer.stopFrameStep);
                window.removeEventListener("wheel", this.__ghComparer.captureAltWheel, true);
                document.removeEventListener("wheel", this.__ghComparer.captureAltWheel, true);
                window.removeEventListener("pointerdown", this.__ghComparer.captureAltPointerDown, true);
                document.removeEventListener("pointerdown", this.__ghComparer.captureAltPointerDown, true);
                window.removeEventListener("pointermove", this.__ghComparer.captureNodes2VideoPointerMove, true);
                window.removeEventListener("pointerup", this.__ghComparer.captureNodes2VideoPointerUp, true);
                window.removeEventListener("pointercancel", this.__ghComparer.captureNodes2VideoPointerCancel, true);
                window.removeEventListener("pointermove", this.__ghComparer.captureComparePointerMove, true);
                document.removeEventListener("pointermove", this.__ghComparer.captureComparePointerMove, true);
                window.removeEventListener("pointerup", this.__ghComparer.captureComparePointerUp, true);
                document.removeEventListener("pointerup", this.__ghComparer.captureComparePointerUp, true);
                window.removeEventListener("pointercancel", this.__ghComparer.captureComparePointerUp, true);
                document.removeEventListener("pointercancel", this.__ghComparer.captureComparePointerUp, true);
                window.removeEventListener("mousedown", this.__ghComparer.captureAltMouseDown, true);
                document.removeEventListener("mousedown", this.__ghComparer.captureAltMouseDown, true);
                window.removeEventListener("mousemove", this.__ghComparer.captureCompareMouseMove, true);
                document.removeEventListener("mousemove", this.__ghComparer.captureCompareMouseMove, true);
                window.removeEventListener("mouseup", this.__ghComparer.captureCompareMouseUp, true);
                document.removeEventListener("mouseup", this.__ghComparer.captureCompareMouseUp, true);
                window.removeEventListener("keydown", this.__ghComparer.captureCompareKey, true);
                window.removeEventListener("keyup", this.__ghComparer.captureCompareKey, true);
                document.removeEventListener("keydown", this.__ghComparer.captureCompareKey, true);
                document.removeEventListener("keyup", this.__ghComparer.captureCompareKey, true);
                window.removeEventListener("keydown", this.__ghComparer.captureSpaceKey, true);
                window.removeEventListener("keyup", this.__ghComparer.captureSpaceKey, true);
                document.removeEventListener("keydown", this.__ghComparer.captureSpaceKey, true);
                document.removeEventListener("keyup", this.__ghComparer.captureSpaceKey, true);
                window.removeEventListener("blur", this.__ghComparer.clearSpaceKey);
                this.__ghComparer.stopFrameStep();
            }
            return removed?.apply(this, arguments);
        };
    },
});


