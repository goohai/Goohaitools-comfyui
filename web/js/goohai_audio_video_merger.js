import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const TYPE = "GH_AudioVideoMerger";
const PREVIEW_KEY = "gh_audio_video_preview";
const SYNC_MS = 5000;
const PREVIEW_INFO_HEIGHT = 12;
const PREVIEW_BOTTOM_PADDING = 5;
const PREVIEW_WIDGET_GAP = 4;

const state = {
    nodes: new Set(),
    widgets: new Map(),
    playing: false,
    master: null,
    timeline: null,
    audioNode: null,
    timer: null,
    manualMute: false,
    spacePressed: false,
};

window.addEventListener("keydown", (event) => {
    if (event.code === "Space") state.spacePressed = true;
}, true);
window.addEventListener("keyup", (event) => {
    if (event.code === "Space") state.spacePressed = false;
}, true);
window.addEventListener("blur", () => { state.spacePressed = false; });

const isMerger = (node) => Boolean(node && (node.type === TYPE || node.constructor?.type === TYPE));

function allNodes() {
    const result = new Set(state.nodes);
    for (const node of app.graph?._nodes || []) {
        if (isMerger(node)) result.add(node);
    }
    state.nodes = result;
    return [...result];
}

function mediaUrl(reference) {
    if (!reference?.filename) return "";
    const query = new URLSearchParams({
        filename: reference.filename,
        subfolder: reference.subfolder || "",
        type: reference.type || "output",
    });
    return api.apiURL("/view?" + query.toString());
}

function normalizeReference(reference) {
    if (!reference?.filename) return null;
    const fps = Number(reference.fps ?? reference.frame_rate);
    return {
        filename: reference.filename,
        subfolder: reference.subfolder || "",
        type: reference.type === "temp" ? "temp" : "output",
        fps: Number.isFinite(fps) && fps > 0 ? fps : null,
    };
}

function findVideoReference(value) {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const result = findVideoReference(item);
            if (result) return result;
        }
        return null;
    }
    if (typeof value.filename === "string" && /\.mp4$/i.test(value.filename)) {
        return {
            filename: value.filename,
            subfolder: value.subfolder || "",
            type: value.type || "output",
        };
    }
    for (const child of Object.values(value)) {
        const result = findVideoReference(child);
        if (result) return result;
    }
    return null;
}

function clearPreview(node) {
    const item = state.widgets.get(node);
    if (!item) return;

    if (state.master === item.video || state.audioNode === node) {
        pauseAll();
    }

    item.video.pause();
    item.video.removeAttribute("src");
    item.video.load();

    // Hiding the element is not enough: LiteGraph still lays out the DOM
    // widget and its overlay can continue to intercept clicks on the node.
    item.disposeInteraction?.();
    try { node.removeWidget?.(item.widget); } catch (_) {}
    if (Array.isArray(node.widgets)) {
        const index = node.widgets.indexOf(item.widget);
        if (index >= 0) node.widgets.splice(index, 1);
    }
    item.root.remove();
    item.disabled = true;
    if (state.widgets.get(node) === item) state.widgets.delete(node);
    node.setDirtyCanvas?.(true, true);
}

function findSaveFlag(node) {
    const widget = node.widgets?.find((item) => item.name === "保存视频");
    return widget ? Boolean(widget.value) : true;
}

function findFrameRate(node) {
    const widget = node.widgets?.find((item) => item.name === "帧率");
    const fps = Number(widget?.value);
    return Number.isFinite(fps) && fps > 0 ? fps : null;
}

function installSaveToggle(node) {
    const saveWidget = node.widgets?.find((entry) => entry.name === "保存视频");
    if (!saveWidget || saveWidget.__ghAvmCallbackInstalled) return;

    const originalCallback = saveWidget.callback;
    saveWidget.callback = function () {
        originalCallback?.apply(this, arguments);
        if (findSaveFlag(node)) {
            createWidget(node, node.properties?.[PREVIEW_KEY]);
        } else {
            clearPreview(node);
        }
        node.setDirtyCanvas?.(true, true);
    };
    saveWidget.__ghAvmCallbackInstalled = true;
}

function addStyles() {
    if (document.getElementById("gh-avm-style")) return;
    const style = document.createElement("style");
    style.id = "gh-avm-style";
    style.textContent = [
        ".gh-avm-preview{position:relative;width:100%;height:auto;min-width:0;overflow:hidden;background:transparent;}",
        ".gh-avm-media{position:relative;width:100%;height:auto;overflow:hidden;}",
        ".gh-avm-preview video{display:block;width:100%;height:auto;max-width:100%;border:0;outline:0;background:transparent;object-fit:contain;cursor:pointer;}",
        ".gh-avm-video-info{width:100%;height:12px;box-sizing:border-box;color:#aeb3bc;font-size:8px;line-height:12px;text-align:center;white-space:nowrap;overflow:hidden;pointer-events:none;}",
        ".gh-avm-mute{position:absolute;right:4px;bottom:4px;z-index:2;width:14px;height:14px;padding:0;border:0;border-radius:50%;font-size:8px;line-height:14px;color:#fff;background:rgba(0,0,0,.45);opacity:0;transition:opacity .15s;cursor:pointer;}",
        ".gh-avm-preview:hover .gh-avm-mute,.gh-avm-mute:focus-visible{opacity:1;}",
    ].join("");
    document.head.appendChild(style);
}

function installCanvasInteraction(root, node) {
    let dragging = false;
    let panning = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let nodeX = 0;
    let nodeY = 0;
    let pointerId = null;
    let panPointerId = null;
    let panLastX = 0;
    let panLastY = 0;

    const canvas = () => app.canvas;
    const inside = (event) => {
        const rect = root.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top && event.clientY <= rect.bottom;
    };

    root.addEventListener("contextmenu", (event) => {
        if (!canvas?.()) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        canvas()?.adjustMouseEvent?.(event);
        canvas()?.processContextMenu?.(node, event);
    }, true);

    root.addEventListener("wheel", (event) => {
        if (!canvas()?.processMouseWheel) return;
        event.preventDefault();
        event.stopPropagation();
        canvas().processMouseWheel(event);
    }, { capture: true, passive: false });

    const beginPan = (event) => {
        if (event.target.closest(".gh-avm-mute") || !inside(event) || (event.button !== 1 && !(event.button === 0 && state.spacePressed))) return false;
        event.preventDefault();
        event.stopPropagation();
        panning = true;
        panPointerId = event.pointerId ?? null;
        panLastX = event.clientX;
        panLastY = event.clientY;
        if (canvas()) canvas().dragging_canvas = true;
        try { root.setPointerCapture?.(event.pointerId); } catch (_) {}
        return true;
    };

    const movePan = (event) => {
        if (!panning || (panPointerId != null && event.pointerId != null && event.pointerId !== panPointerId)) return;
        const ds = canvas()?.ds;
        if (!ds?.offset) return;
        event.preventDefault();
        event.stopPropagation();
        const scale = Math.max(Number(ds.scale) || 1, 0.0001);
        ds.offset[0] += (event.clientX - panLastX) / scale;
        ds.offset[1] += (event.clientY - panLastY) / scale;
        panLastX = event.clientX;
        panLastY = event.clientY;
        canvas()?.setDirty?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
    };

    const endPan = (event) => {
        if (!panning || (panPointerId != null && event?.pointerId != null && event.pointerId !== panPointerId)) return;
        event?.preventDefault?.();
        event?.stopPropagation?.();
        panning = false;
        panPointerId = null;
        if (canvas()) canvas().dragging_canvas = false;
        try { if (event?.pointerId != null && root.hasPointerCapture?.(event.pointerId)) root.releasePointerCapture(event.pointerId); } catch (_) {}
    };

    const onDown = (event) => {
        root._ghPointerMoved = false;
        if (beginPan(event)) {
            moved = true;
            return;
        }
        if (event.button !== 0 || event.target.closest(".gh-avm-mute") || !inside(event)) return;
        dragging = true;
        moved = false;
        pointerId = event.pointerId ?? null;
        startX = event.clientX;
        startY = event.clientY;
        nodeX = Number(node.pos?.[0]) || 0;
        nodeY = Number(node.pos?.[1]) || 0;
    };

    const onMove = (event) => {
        if (panning) {
            movePan(event);
            root._ghPointerMoved = true;
            return;
        }
        if (!dragging || (pointerId != null && event.pointerId != null && event.pointerId !== pointerId)) return;
        const scale = Math.max(Number(canvas()?.ds?.scale) || 1, 0.0001);
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true;
        event.preventDefault();
        event.stopPropagation();
        const next = [nodeX + dx / scale, nodeY + dy / scale];
        node.setPosition?.(next);
        if (!Array.isArray(node.pos) || node.pos[0] !== next[0] || node.pos[1] !== next[1]) node.pos = next;
        node.onPositionChanged?.();
        app.graph?.setDirtyCanvas?.(true, true);
        canvas()?.setDirty?.(true, true);
    };

    const onUp = (event) => {
        if (panning) {
            endPan(event);
            root._ghPointerMoved = true;
            return;
        }
        if (!dragging || (pointerId != null && event.pointerId != null && event.pointerId !== pointerId)) return;
        dragging = false;
        pointerId = null;
        root._ghPointerMoved = moved;
        if (moved) event.preventDefault();
        app.graph?.change?.();
    };

    root.addEventListener("pointerdown", onDown, false);
    root.addEventListener("auxclick", (event) => {
        if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);

    return () => {
        if (panning) endPan({ pointerId: panPointerId, preventDefault() {}, stopPropagation() {} });
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onUp, true);
    };
}

function getPreviewHeight(item, width) {
    const video = item?.video;
    if (!video?.videoWidth || !video?.videoHeight) return 0;
    return width * video.videoHeight / video.videoWidth;
}

function getPreviewWidth(item, nodeWidth) {
    // Use cached inset measured once at layout time. Do NOT call
    // getBoundingClientRect() here: it returns stale/DPI-scaled values during
    // canvas zoom and LiteGraph resize passes, which causes aspect-ratio
    // oscillation and extra bottom whitespace after zoom changes.
    const requestedWidth = Math.max(1, Number(nodeWidth) || 1);
    const inset = Math.max(0, Number(item?.previewInset) || 0);
    return Math.max(1, requestedWidth - inset);
}

function getPreviewLayoutHeight(item, nodeWidth) {
    const previewWidth = getPreviewWidth(item, nodeWidth);
    const videoHeight = getPreviewHeight(item, previewWidth);
    return videoHeight ? videoHeight + PREVIEW_INFO_HEIGHT : 0;
}

function formatVideoInfo(video, fpsValue) {
    const width = Number(video?.videoWidth) || 0;
    const height = Number(video?.videoHeight) || 0;
    const duration = Number(video?.duration);
    const fps = Number(fpsValue);
    const sizeText = width > 0 && height > 0 ? `${width} × ${height}` : "-- × --";
    const fpsText = fps > 0 ? `${Number.isInteger(fps) ? fps : fps.toFixed(2)}fps` : "--fps";
    const durationText = Number.isFinite(duration) && duration >= 0 ? `${duration.toFixed(2)}s` : "--s";
    return `${sizeText} · ${fpsText} · ${durationText}`;
}

function removeNativePreview(node) {
    const candidates = [
        node.widgets,
        node.widgets_values,
    ];
    for (const collection of candidates) {
        if (!Array.isArray(collection)) continue;
        for (let index = collection.length - 1; index >= 0; index -= 1) {
            const item = collection[index];
            const element = item?.element || item?.options?.element || item?.value;
            if (element instanceof HTMLVideoElement || element?.querySelector?.("video")) {
                try { item.element?.remove?.(); } catch (_) {}
                try { item.options?.element?.remove?.(); } catch (_) {}
                collection.splice(index, 1);
            }
        }
    }
}

function measureParameterHeight(node, item) {
    const widget = item?.widget;
    if (!widget || typeof node.computeSize !== "function") return null;

    // Temporarily zero out our preview widget so computeSize() returns only
    // the height of the title + parameter widgets + trailing widget gap.
    // Called ONCE when video metadata loads; never during drag.
    const originalWidgetComputeSize = widget.computeSize;
    const originalGetMinHeight = widget.getMinHeight;
    const originalGetMaxHeight = widget.getMaxHeight;
    widget.computeSize = () => [0, 0];
    widget.getMinHeight = () => 0;
    widget.getMaxHeight = () => 0;
    try {
        const naturalSize = node.computeSize.apply(node, [[node.size[0], 0]]);
        const height = Number(naturalSize?.[1]);
        return Number.isFinite(height) ? Math.max(0, height) : null;
    } catch (_) {
        return null;
    } finally {
        widget.computeSize = originalWidgetComputeSize;
        widget.getMinHeight = originalGetMinHeight;
        widget.getMaxHeight = originalGetMaxHeight;
    }
}

function installPreviewMinimumSizeHook(node, item) {
    // No longer needed: widget.computeSize returns the correct preview
    // height for any given width, so the native computeSize() already
    // enforces the correct minimum size without any wrapping.
    node.__ghAvmMinimumSizeHookInstalled = true;
}

function previewNodeHeight(item, width) {
    const parameterHeight = Number(item.baseHeight);
    if (!Number.isFinite(parameterHeight)) return null;
    const previewWidth = getPreviewWidth(item, width);
    const videoHeight = getPreviewHeight(item, previewWidth);
    if (!videoHeight) return null;
    // parameterHeight was measured with our widget at height 0 and includes
    // the +4 gap after every widget (including our zero-height one). Replace
    // that trailing 4px gap with the actual preview + desired 5px padding.
    return Math.max(0, Math.ceil(
        parameterHeight - PREVIEW_WIDGET_GAP + videoHeight + PREVIEW_INFO_HEIGHT + PREVIEW_BOTTOM_PADDING,
    ));
}

function resizeNode(node, item) {
    if (!item || item.resizing) return;
    const width = Math.max(1, Number(node.size?.[0]) || 300);
    const requiredHeight = previewNodeHeight(item, width);
    if (!Number.isFinite(requiredHeight)) return;
    const currentHeight = Number(node.size?.[1]) || 0;
    if (Math.abs(currentHeight - requiredHeight) <= 0.5) return;
    item.resizing = true;
    try {
        node.size = [node.size[0], requiredHeight];
    } finally {
        item.resizing = false;
    }
    node.setDirtyCanvas?.(true, true);
}

function resizePreviewFromUser(node, item, requestedSize) {
    const video = item?.video;
    if (!video?.src || !video.videoWidth || !video.videoHeight || item.resizing) return;
    if (!Number.isFinite(item.baseHeight)) return;

    const aspect = video.videoHeight / video.videoWidth;
    const requestedWidth = Math.max(1, Number(requestedSize?.[0]) || Number(node.size?.[0]) || 300);
    const requestedHeight = Math.max(1, Number(requestedSize?.[1]) || Number(node.size?.[1]) || 1);

    // Track gesture start for proportional resizing. The stable baseline is
    // the last-confirmed node size before the native resize began, not the
    // previous frame's corrected size -- using corrected size as the baseline
    // makes axis detection flip every frame at the bottom edge.
    const canvas = app.canvas;
    const isNativeDrag = canvas?.resizing_node === node;
    if (isNativeDrag) {
        if (!item._dragStart) {
            // Use the stable size captured at the last idle moment. If this
            // is the first resize ever (no stable size yet) fall back to the
            // previously rendered size.
            const sw = Number(item._stableSize?.[0]) || Number(node.size?.[0]) || requestedWidth;
            const sh = Number(item._stableSize?.[1]) || Number(node.size?.[1]) || requestedHeight;
            item._dragStart = { width: sw, height: sh, axis: null };
        }
        const ds = item._dragStart;
        const dWidth = requestedWidth - ds.width;
        const dHeight = requestedHeight - ds.height;
        // Lock the dominant axis after the first visible movement so a
        // corner-drag does not chatter between modes.
        if (!ds.axis && (Math.abs(dWidth) > 2 || Math.abs(dHeight) > 2)) {
            ds.axis = Math.abs(dHeight) > Math.abs(dWidth) ? "height" : "width";
        }
        if (ds.axis === "height") {
            // User primarily drags the bottom edge: derive width from height
            // so the node scales proportionally. Then compute exact height
            // for the derived width to maintain perfect aspect ratio.
            const fixedTop = item.baseHeight - PREVIEW_WIDGET_GAP + PREVIEW_INFO_HEIGHT + PREVIEW_BOTTOM_PADDING;
            const availVideoH = Math.max(1, requestedHeight - fixedTop);
            const derivedWidth = Math.ceil(availVideoH / aspect + (item.previewInset || 0));
            const exactHeight = previewNodeHeight(item, derivedWidth);
            node.size = [derivedWidth, Number.isFinite(exactHeight) ? exactHeight : Math.ceil(requestedHeight)];
        } else {
            // Width-driven (default, including right-edge and corner drags).
            const height = previewNodeHeight(item, requestedWidth);
            if (Number.isFinite(height)) {
                node.size = [Math.ceil(requestedWidth), height];
            }
        }
    } else {
        // Programmatic / zoom / initial layout: just enforce aspect ratio
        // from current width, do not alter width.
        const height = previewNodeHeight(item, requestedWidth);
        if (Number.isFinite(height)) {
            node.size = [Math.ceil(requestedWidth), height];
        }
        item._dragStart = null;
        // Remember this as the last stable size for the next drag gesture.
        item._stableSize = [Number(node.size?.[0]) || requestedWidth, Number(node.size?.[1]) || requestedHeight];
    }
    node.setDirtyCanvas?.(true, true);
}

function installPreviewResizeHook(node) {
    if (node.__ghAvmResizeHookInstalled) return;
    const originalResize = node.onResize;
    node.onResize = function (size) {
        const result = originalResize?.apply(this, arguments);
        const item = state.widgets.get(this);
        if (item && findSaveFlag(this) && !item.resizing && item.baseHeight) {
            resizePreviewFromUser(this, item, size || this.size);
        }
        return result;
    };
    // Clear drag-start state whenever the pointer lifts, even outside
    // this node, so the next gesture starts from a fresh stable baseline.
    if (!installPreviewResizeHook._bound) {
        installPreviewResizeHook._bound = true;
        const clearDrag = () => {
            for (const it of state.widgets.values()) {
                if (it.node?.size) {
                    it._stableSize = [Number(it.node.size[0]), Number(it.node.size[1])];
                }
                it._dragStart = null;
            }
        };
        window.addEventListener("pointerup", clearDrag, true);
        window.addEventListener("pointercancel", clearDrag, true);
    }
    node.__ghAvmResizeHookInstalled = true;
}

function updateMuteButton() {
    for (const item of state.widgets.values()) {
        item.mute.textContent = state.manualMute ? "🔇" : "🔊";
    }
}

function entries() {
    return allNodes()
        .map((node) => ({ node, item: state.widgets.get(node), video: state.widgets.get(node)?.video }))
        .filter((entry) => entry.video?.src);
}

function clearSyncTimer() {
    if (state.timer !== null) {
        clearInterval(state.timer);
        state.timer = null;
    }
}

function syncMutedVideos(time) {
    for (const entry of entries()) {
        if (entry.video === state.master || entry.node === state.audioNode || entry.video.ended) continue;
        if (Number.isFinite(entry.video.duration) && time > entry.video.duration) continue;
        if (Math.abs(entry.video.currentTime - time) > 0.3) {
            try { entry.video.currentTime = time; } catch (_) {}
        }
    }
}

function getTimelineEntry(items = entries()) {
    return items.reduce((longest, entry) => {
        if (!Number.isFinite(entry.video?.duration)) return longest;
        if (!longest || entry.video.duration > longest.video.duration) return entry;
        return longest;
    }, null);
}

function isVideoComplete(entry) {
    if (!Number.isFinite(entry.video?.duration)) return false;
    return entry.video.ended || entry.video.currentTime >= Math.max(0, entry.video.duration - 0.05);
}

function restartSynchronizedPlayback() {
    const currentEntries = entries();
    if (!currentEntries.length) return;

    for (const entry of currentEntries) {
        try { entry.video.currentTime = 0; } catch (_) {}
        entry.video.loop = false;
    }
    applyAudioState();
    for (const entry of currentEntries) entry.video.play().catch(() => {});
}

function handleVideoEnded(video) {
    if (!state.playing || !state.timeline || video !== state.timeline.video) return;
    const currentEntries = entries();
    if (currentEntries.length && currentEntries.every(isVideoComplete)) {
        restartSynchronizedPlayback();
    }
}

function pauseAll() {
    state.playing = false;
    clearSyncTimer();
    for (const entry of entries()) entry.video.pause();
    state.master = null;
    state.timeline = null;
    state.audioNode = null;
}

function applyAudioState() {
    for (const entry of entries()) {
        const active = !state.manualMute && entry.node === state.audioNode;
        entry.video.muted = !active;
        entry.video.volume = active ? 1 : 0;
    }
}

function activateAudio(node) {
    if (!state.playing || state.manualMute) return;
    state.audioNode = node;
    applyAudioState();
}

function playAll(node, master) {
    const currentEntries = entries();
    const timeline = getTimelineEntry(currentEntries) || currentEntries.find((entry) => entry.video === master);
    if (!timeline) return;

    state.playing = true;
    state.master = master;
    state.timeline = timeline;
    state.audioNode = node;
    const timelineDuration = Number.isFinite(timeline.video.duration) ? timeline.video.duration : Infinity;
    const rawStart = Number.isFinite(master.currentTime) ? master.currentTime : 0;
    const start = rawStart >= timelineDuration - 0.05 ? 0 : Math.max(0, rawStart);

    for (const entry of currentEntries) {
        const duration = Number.isFinite(entry.video.duration) ? entry.video.duration : start;
        try { entry.video.currentTime = Math.min(start, duration); } catch (_) {}
        entry.video.loop = false;
    }
    applyAudioState();
    for (const entry of currentEntries) entry.video.play().catch(() => {});

    clearSyncTimer();
    state.timer = setInterval(() => {
        const timelineVideo = state.timeline?.video;
        if (!state.playing || !timelineVideo) {
            pauseAll();
            return;
        }
        if (timelineVideo.ended) return;
        if (timelineVideo.paused) {
            pauseAll();
            return;
        }
        syncMutedVideos(timelineVideo.currentTime);
    }, SYNC_MS);
}

function togglePlayback(node, video) {
    if (!state.playing) {
        playAll(node, video);
    } else if (state.master === video) {
        pauseAll();
    } else {
        const time = state.timeline?.video?.currentTime ?? state.master?.currentTime ?? 0;
        const duration = Number.isFinite(video.duration) ? video.duration : time;
        try { video.currentTime = Math.min(time, duration); } catch (_) {}
        state.master = video;
        state.audioNode = node;
        applyAudioState();
        for (const entry of entries()) {
            if (entry.video.paused && !entry.video.ended && entry.video !== state.timeline?.video) {
                entry.video.play().catch(() => {});
            }
        }
    }
}

function createWidget(node, reference) {
    installSaveToggle(node);
    if (!findSaveFlag(node)) {
        clearPreview(node);
        return null;
    }

    // If there is no video at all (toggle on but workflow never executed,
    // or reference was cleared), do not create any DOM widget. The outer
    // LiteGraph wrapper would still intercept canvas mouse events even with
    // zero-height content.
    if (!reference?.filename) {
        clearPreview(node);
        return null;
    }

    let item = state.widgets.get(node);
    if (!item) {
        removeNativePreview(node);

        const root = document.createElement("div");
        root.className = "gh-avm-preview";
        root.style.display = "none";

        const media = document.createElement("div");
        media.className = "gh-avm-media";
        media.style.display = "none";

        const video = document.createElement("video");
        video.preload = "metadata";
        video.playsInline = true;
        video.loop = false;

        const info = document.createElement("div");
        info.className = "gh-avm-video-info";
        info.style.display = "none";
        info.textContent = formatVideoInfo(video, reference?.fps ?? findFrameRate(node));

        const mute = document.createElement("button");
        mute.type = "button";
        mute.className = "gh-avm-mute";
        mute.title = "静音/取消静音";
        mute.textContent = "🔊";
        mute.style.display = "none";

        mute.addEventListener("click", (event) => {
            event.stopPropagation();
            state.manualMute = !state.manualMute;
            applyAudioState();
            updateMuteButton();
        });
        let pointerX = 0;
        let pointerY = 0;
        let pointerMoved = false;
        video.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            pointerX = event.clientX;
            pointerY = event.clientY;
            pointerMoved = false;
        });
        video.addEventListener("pointermove", (event) => {
            if (Math.hypot(event.clientX - pointerX, event.clientY - pointerY) > 4) {
                pointerMoved = true;
            }
        });
        video.addEventListener("click", (event) => {
            event.stopPropagation();
            if (pointerMoved || root._ghPointerMoved) {
                pointerMoved = false;
                root._ghPointerMoved = false;
                return;
            }
            togglePlayback(node, video);
        });
        root.addEventListener("mouseenter", () => activateAudio(node));
        root.addEventListener("mouseleave", (event) => {
            const next = event.relatedTarget;
            if (!next?.closest?.(".gh-avm-preview")) {
                state.audioNode = null;
                applyAudioState();
            }
        });
        media.append(video, mute);
        root.append(media, info);
        const disposeInteraction = installCanvasInteraction(root, node);

        const widget = node.addDOMWidget("gh_avm_preview", "preview", root, {
            serialize: false,
            hideOnZoom: false,
            // Keep the DOM widget fixed to the real preview height.  An
            // unbounded DOM widget is treated as flexible space by the
            // current ComfyUI layout pass and can occupy old serialized node
            // height as a transparent overlay.
            getMinHeight: () => {
                if (!findSaveFlag(node) || !video.src || !video.videoWidth) { root.style.display = "none"; root.style.pointerEvents = "none"; info.style.display = "none"; media.style.display = "none"; mute.style.display = "none"; return 0; }
                root.style.display = ""; root.style.pointerEvents = ""; info.style.display = ""; media.style.display = ""; mute.style.display = "";
                return getPreviewLayoutHeight(item, Number(node.size?.[0]) || 300);
            },
            getMaxHeight: () => {
                if (!findSaveFlag(node) || !video.src || !video.videoWidth) { root.style.display = "none"; root.style.pointerEvents = "none"; info.style.display = "none"; media.style.display = "none"; mute.style.display = "none"; return 0; }
                root.style.display = ""; root.style.pointerEvents = ""; info.style.display = ""; media.style.display = ""; mute.style.display = "";
                return getPreviewLayoutHeight(item, Number(node.size?.[0]) || 300);
            },
        });
        widget.serialize = false;
        widget.computeSize = (width) => {
            if (!findSaveFlag(node) || !video.src || !video.videoWidth) { root.style.display = "none"; root.style.pointerEvents = "none"; info.style.display = "none"; media.style.display = "none"; mute.style.display = "none"; return [0, 0]; }
            root.style.display = ""; root.style.pointerEvents = ""; info.style.display = ""; media.style.display = ""; mute.style.display = "";
            const w = Math.max(1, Number(width) || Number(node.size?.[0]) || 300);
            const h = getPreviewHeight({ video }, getPreviewWidth(item, w));
            return [0, h + PREVIEW_INFO_HEIGHT];
        };

        item = { node, root, video, info, mute, widget, disposeInteraction, disabled: false, previewInset: 0, baseHeight: null, _stableSize: null, _dragStart: null, reference: normalizeReference(reference) };
        state.widgets.set(node, item);
        installPreviewMinimumSizeHook(node, item);

        const updateVideoInfo = () => {
            if (video.videoWidth && video.videoHeight) { root.style.display = ""; root.style.pointerEvents = ""; info.style.display = ""; media.style.display = ""; mute.style.display = ""; }
            info.textContent = formatVideoInfo(video, item.reference?.fps ?? findFrameRate(node));
            // Use double rAF to ensure the DOM widget has been positioned by
            // LiteGraph before we take measurements. Measuring too early
            // (before layout) gives rootWidth=0 and a bogus inset that breaks
            // all subsequent height calculations.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const scale = Math.max(Number(app.canvas?.ds?.scale) || 1, 0.0001);
                const rootWidth = Number(root.getBoundingClientRect?.()?.width) / scale;
                const nodeWidth = Number(node.size?.[0]) || 0;
                // Sanity: real inset is a small border/padding (0-20px). If
                // measured inset is huge the DOM isn't ready yet; keep the
                // previously cached value (default 0).
                if (Number.isFinite(rootWidth) && rootWidth > nodeWidth * 0.5 && nodeWidth > rootWidth) {
                    item.previewInset = Math.max(0, nodeWidth - rootWidth);
                }
                // Capture the parameter area height once; it never changes.
                const parameterHeight = measureParameterHeight(node, item);
                if (Number.isFinite(parameterHeight)) item.baseHeight = parameterHeight;
                resizeNode(node, item);
                node.setDirtyCanvas?.(true, true);
            }));
        };
        video.addEventListener("loadedmetadata", updateVideoInfo);
        video.addEventListener("durationchange", updateVideoInfo);
        video.addEventListener("ended", () => handleVideoEnded(video));
    }

    item.root.hidden = false;
    item.disabled = false;
    installPreviewResizeHook(node);

    if (reference?.filename) {
        item.reference = normalizeReference(reference);
        item.info.textContent = formatVideoInfo(item.video, item.reference?.fps ?? findFrameRate(node));
        const nextUrl = mediaUrl(reference);
        if (item.video.src !== nextUrl) {
            item.video.pause();
            item.video.src = nextUrl;
            item.video.load();
        }
        // If video already has dimensions (e.g. cached), show immediately.
        if (item.video.videoWidth && item.video.videoHeight) {
            item.root.style.display = "";
            item.root.style.pointerEvents = "";
            item.info.style.display = "";
            item.media.style.display = "";
            item.mute.style.display = "";
        }
    }
    return item;
}

addStyles();

app.registerExtension({
    name: "goohaitools.audio_video_merger_custom_preview",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== TYPE) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated?.apply(this, arguments);
            state.nodes.add(this);
            createWidget(this, this.properties?.[PREVIEW_KEY]);
        };

        const originalExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            originalExecuted?.apply(this, arguments);
            const reference = findVideoReference(message);
            if (!findSaveFlag(this)) {
                clearPreview(this);
                delete this.properties?.[PREVIEW_KEY];
                return;
            }
            if (!reference) return;
            this.properties ||= {};
            const previewReference = normalizeReference({ ...reference, fps: findFrameRate(this) });
            this.properties[PREVIEW_KEY] = previewReference;
            createWidget(this, previewReference);
            this.setDirtyCanvas?.(true, true);
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = originalConfigure?.apply(this, arguments);
            state.nodes.add(this);
            requestAnimationFrame(() => createWidget(this, this.properties?.[PREVIEW_KEY]));
            return result;
        };

        const originalSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function (data) {
            originalSerialize?.apply(this, arguments);
            const reference = this.properties?.[PREVIEW_KEY];
            if (reference?.filename) {
                data.properties ||= {};
                data.properties[PREVIEW_KEY] = { ...reference };
            }
        };

        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            if (state.audioNode === this) pauseAll();
            clearPreview(this);
            state.nodes.delete(this);
            originalRemoved?.apply(this, arguments);
        };
    },
});
