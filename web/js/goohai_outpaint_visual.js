import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const NODE_TYPE = "孤海外补画板可视化";
const W = "gh_outpaint_visual";
const RATIOS = ["自由比例", "1:1", "2:3", "3:2", "3:4", "4:3", "5:7", "9:16", "16:9", "21:9", "1:2", "2:1"];
const SIDES = { left: "左", right: "右", top: "上", bottom: "下" };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const loaderSubscriptions = new WeakMap();

function subscribeLoader(loader, notify) {
    if (!loader) return () => {};
    let subscription = loaderSubscriptions.get(loader);
    if (!subscription) {
        subscription = { listeners: new Set(), hooks: [] };
        const widget = loader.widgets?.find((item) => ["image", "图像"].includes(item.name));
        for (const [owner, key] of [[widget, "callback"], [loader, "onWidgetChanged"], [loader, "onConfigure"]]) {
            if (!owner) continue;
            const original = owner[key];
            const wrapped = function () {
                const result = original?.apply(this, arguments);
                for (const listener of subscription.listeners) listener();
                return result;
            };
            subscription.hooks.push({ owner, key, original, wrapped });
            owner[key] = wrapped;
        }
        loaderSubscriptions.set(loader, subscription);
    }
    subscription.listeners.add(notify);
    return () => {
        subscription.listeners.delete(notify);
        if (subscription.listeners.size) return;
        for (const { owner, key, original, wrapped } of subscription.hooks) {
            if (owner[key] === wrapped) owner[key] = original;
        }
        loaderSubscriptions.delete(loader);
    };
}

const layoutStyle = document.createElement("style");
layoutStyle.textContent = `
.lg-node-widgets:has(.gh-outpaint-visual) {
    grid-template-rows: var(--gh-outpaint-rows) !important;
}
`;
document.head.append(layoutStyle);

function imageUrl(filename, type = "input", subfolder = "") {
    const q = new URLSearchParams({ filename: String(filename || ""), type, rand: String(Date.now()) });
    if (subfolder) q.set("subfolder", subfolder);
    return api.apiURL(`/view?${q}`);
}

function loaderInfo(node) {
    const input = node.inputs?.find((item) => item.name === "图像" || item.name === "image");
    const link = input?.link ?? input?.links?.[0];
    const origin = link != null ? app.graph?.getLink?.(link)?.origin_id : null;
    const upstream = origin != null ? app.graph?.getNodeById?.(origin) : null;
    if (!upstream) return null;
    const isLoader = ["LoadImage", "LoadImageGoohai", "LoadImageOutput"].includes(upstream.type)
        || ["LoadImage", "LoadImageGoohai", "LoadImageOutput"].includes(upstream.comfyClass);
    if (!isLoader) return null;
    const widget = upstream.widgets?.find((item) => ["image", "图像"].includes(item.name));
    const value = widget?.value;
    if (!value || value === "无") return { node: upstream, widget, key: "", url: null };
    let raw = String(value).replaceAll("\\", "/");
    const annotated = raw.match(/\[(input|output|temp)\]\s*$/);
    const type = annotated?.[1] || "input";
    if (annotated) raw = raw.slice(0, annotated.index).trim();
    const parts = raw.split("/");
    const filename = parts.pop();
    const subfolder = parts.join("/");
    return {
        node: upstream,
        widget,
        key: `${type}|${subfolder}|${filename}`,
        url: imageUrl(filename, type, subfolder),
    };
}

function loaderFor(node) {
    return loaderInfo(node)?.url || null;
}

async function loadUpstreamPreview(node, receive, setStatus, signal) {
    const { output } = await app.graphToPrompt();
    signal.throwIfAborted();
    const imageInput = output[String(node.id)]?.inputs?.["图像"];
    if (!Array.isArray(imageInput) || imageInput.length !== 2 || !output[String(imageInput[0])]) {
        throw new Error("请先连接有效的上游图像输出");
    }
    // Build a separate prompt containing only the selected image's ancestors.
    // Neither this outpaint node nor any of its downstream branches is submitted.
    const prompt = {};
    function include(id) {
        id = String(id);
        if (prompt[id]) return;
        const entry = output[id];
        if (!entry) throw new Error(`找不到上游节点 ${id}`);
        prompt[id] = entry;
        for (const value of Object.values(entry.inputs || {})) {
            if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1]) && output[value[0]]) include(value[0]);
        }
    }
    include(imageInput[0]);
    const target = `gh_outpaint_preview_${crypto.randomUUID()}`;
    prompt[target] = { class_type: "PreviewImage", inputs: { images: imageInput } };
    let promptId;
    const listeners = [];
    const cleanup = () => {
        for (const [type, fn] of listeners) api.removeEventListener(type, fn);
        signal.removeEventListener("abort", cleanup);
    };
    signal.addEventListener("abort", cleanup, { once: true });
    const listen = (type, fn) => { listeners.push([type, fn]); api.addEventListener(type, fn); };
    let delivered = false;
    async function deliver(images) {
        if (signal.aborted || delivered || !images?.[0]) return;
        delivered = true;
        cleanup();
        try {
            const ref = images[0];
            await receive(imageUrl(ref.filename, ref.type || "temp", ref.subfolder || ""));
        } catch (error) { if (!signal.aborted) setStatus(error.message); }
    }
    listen("executed", (event) => {
        if (String(event.detail?.node) === target) void deliver(event.detail.output?.images);
    });
    listen("execution_success", async (event) => {
        if (event.detail?.prompt_id !== promptId || delivered) return;
        // A single history read also covers cached preview outputs; no polling.
        try {
            const response = await api.fetchApi(`/history/${encodeURIComponent(promptId)}`, { signal });
            if (!response.ok) throw new Error("读取上游预览结果失败");
            const history = await response.json();
            const images = history[promptId]?.outputs?.[target]?.images;
            if (!images?.length) throw new Error("上游没有返回可预览图像");
            await deliver(images);
        } catch (error) { cleanup(); if (!signal.aborted) setStatus(error.message); }
    });
    for (const type of ["execution_error", "execution_interrupted"]) listen(type, (event) => {
        if (event.detail?.prompt_id !== promptId) return;
        cleanup(); setStatus(event.detail?.exception_message || "上游执行已中断");
    });
    try {
        const response = await api.fetchApi("/prompt", {
            method: "POST", signal, headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, client_id: api.clientId, partial_execution_targets: [target] }),
        });
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.error?.message || "上游预览任务提交失败");
        promptId = result.prompt_id;
    } catch (error) { cleanup(); throw error; }
    return cleanup;
}

function numberWidget(node, name, fallback = 0) {
    const widget = node.widgets?.find((item) => item.name === name);
    if (!widget) return null;
    const value = Number(widget.value);
    return { widget, value: Number.isFinite(value) ? value : fallback };
}

function setNumber(node, name, value) {
    const item = numberWidget(node, name);
    if (!item) return;
    const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
    item.widget.value = Math.max(0, Math.round(safe));
    item.widget.callback?.(item.widget.value);
}

function createPreview(node) {
    if (node[W]) return node[W];
    const root = document.createElement("div");
    root.className = "gh-outpaint-visual";
    root.style.cssText = "width:100%;height:100%;min-height:0;box-sizing:border-box;color:#ddd;font:12px sans-serif;user-select:none;display:flex;flex-direction:column;";
    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;flex:0 0 auto;gap:6px;align-items:center;padding:4px 0;";
    const load = document.createElement("button"); load.textContent = "加载"; load.type = "button";
    const reset = document.createElement("button"); reset.textContent = "复位"; reset.type = "button";
    const ratio = document.createElement("select");
    ratio.title = "扩展后图像比例";
    ratio.setAttribute("aria-label", "扩展后图像比例");
    for (const label of RATIOS) { const option = document.createElement("option"); option.value = label; option.textContent = label; ratio.append(option); }
    ratio.style.cssText = "max-width:100px;background:#30343c;color:#ddd;border:1px solid #59616d;border-radius:3px;padding:3px;";
    for (const button of [load, reset]) {
        button.style.cssText = "background:#30343c;color:#ddd;border:1px solid #59616d;border-radius:3px;padding:3px 8px;font:inherit;line-height:normal;box-sizing:border-box;cursor:pointer;";
    }
    const info = document.createElement("span"); info.style.cssText = "margin-left:auto;color:#aaa;";
    bar.append(load, reset, ratio, info);
    const viewport = document.createElement("div");
    viewport.style.cssText = "position:relative;flex:1 1 0px;width:100%;height:0;min-height:180px;box-sizing:border-box;overflow:hidden;background:#20242b;border:1px solid #59616d;border-radius:4px;cursor:default;";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    viewport.append(canvas); root.append(bar, viewport);
    const widget = node.addDOMWidget(W, "gh_outpaint_visual", root, { serialize: false, hideOnZoom: false, getMinHeight: () => 220, getMaxHeight: () => undefined, afterResize: () => draw(), surfaces: { canvas: "shown", vueNode: "shown", panel: "never" } });
    widget.serialize = false;
    const state = { root, viewport, canvas, load, reset, info, widget, image: null, zoom: 1, dragging: null, values: { left: 0, right: 0, top: 0, bottom: 0 } };
    node[W] = state;
    function displaySignature() {
        const rect = viewport.getBoundingClientRect();
        return [root.isConnected, rect.width, rect.height, window.devicePixelRatio || 1].join("|");
    }
    function redrawIfDisplayChanged() {
        if (!state.disposed && displaySignature() !== state.displaySignature) draw();
    }
    function scheduleDisplayRefresh() {
        if (state.disposed || state.displayFrame) return;
        // Coalesce layout events into one paint; no timer or polling loop.
        state.displayFrame = requestAnimationFrame(() => {
            state.displayFrame = 0;
            if (state.disposed) return;
            redrawIfDisplayChanged();
        });
    }
    function configureNodes2WidgetRows() {
        const grid = root.closest(".lg-node-widgets");
        if (state.widgetGrid && state.widgetGrid !== grid) state.widgetGrid.style.removeProperty("--gh-outpaint-rows");
        state.widgetGrid = grid;
        if (!grid) return; // Legacy uses the DOM widget's existing fixed limits.
        const rows = [...grid.children];
        if (!rows.some((row) => row.contains(root))) return;
        const template = rows.map((row) => {
            if (row.contains(root)) return "minmax(220px,1fr)";
            if (row.querySelector(".gh-color-dom")) return "24px";
            return "min-content";
        }).join(" ");
        // Vue owns its inline grid-template-rows and rewrites it on widget
        // updates. A stylesheet owns our layout instead: there is no frame in
        // which Vue's auto rows take over, and no observer writes them back.
        // This variable changes only when the actual row structure changes.
        if (grid.style.getPropertyValue("--gh-outpaint-rows") !== template) {
            grid.style.setProperty("--gh-outpaint-rows", template);
        }
    }
    const transformObserver = new MutationObserver((records) => {
        if (!records.some((record) => record.type === "childList" || record.oldValue !== record.target.getAttribute(record.attributeName))) return;
        if (records.some((record) => record.type === "childList")) observeDisplayAncestors();
        scheduleDisplayRefresh();
    });
    const mountObserver = new MutationObserver(() => {
        if (!root.isConnected) return;
        observeDisplayAncestors();
        scheduleDisplayRefresh();
    });
    function observeDisplayAncestors() {
        transformObserver.disconnect();
        mountObserver.disconnect();
        configureNodes2WidgetRows();
        // ResizeObserver does not fire when CSS transforms change the final
        // screen size. Watch both Legacy and Vue DOM ancestor transforms too.
        for (let element = viewport; element; element = element.parentElement) {
            transformObserver.observe(element, { attributes: true,
                attributeFilter: ["style", "class", "hidden"], attributeOldValue: true, childList: true });
        }
        if (!root.isConnected) mountObserver.observe(document.body, { childList: true, subtree: true });
    }
    window.addEventListener("resize", scheduleDisplayRefresh);
    document.addEventListener("visibilitychange", scheduleDisplayRefresh);
    const internalWidget = (name) => node.widgets?.find((item) => item.name === name);
    ratio.value = internalWidget("gh_visual_ratio")?.value || "自由比例";
    function signature() {
        return [state.image?.naturalWidth || 0, state.image?.naturalHeight || 0,
            internalWidget("单位")?.value || "像素", ...Object.values(SIDES).map((name) => numberWidget(node, name)?.value || 0)];
    }
    function exactPads() {
        try {
            const data = JSON.parse(internalWidget("gh_visual_layout")?.value || "");
            if (JSON.stringify(data.signature) === JSON.stringify(signature()) && data.pads?.length === 4 && data.pads.every((v) => Number.isFinite(v) && v >= 0)) {
                return Object.fromEntries(Object.keys(SIDES).map((key, index) => [key, data.pads[index]]));
            }
        } catch (_) {}
        return null;
    }

    function current() {
        const unit = node.widgets?.find((item) => item.name === "单位")?.value || "像素";
        const iw = state.image?.naturalWidth || state.image?.width || 0;
        const ih = state.image?.naturalHeight || state.image?.height || 0;
        for (const [key, label] of Object.entries({ left: "左", right: "右", top: "上", bottom: "下" })) {
            const rawWidget = node.widgets?.find((item) => item.name === label);
            const rawNumber = Number(rawWidget?.value);
            const raw = Number.isFinite(rawNumber) ? rawNumber : 0;
            if (rawWidget && !Number.isFinite(rawNumber)) {
                rawWidget.value = 0;
                rawWidget.callback?.(0);
            }
            state.values[key] = unit === "百分比"
                ? Math.floor((key === "left" || key === "right" ? iw : ih) * raw / 100)
                : raw;
            if (!Number.isFinite(state.values[key])) {
                state.values[key] = 0;
                setNumber(node, label, 0);
            }
        }
        Object.assign(state.values, exactPads() || {});
        return state.values;
    }
    function constrain(values, iw, ih, edges = [], symmetric = false) {
        values = { ...values };
        if (symmetric) {
            for (const [start, end] of [["left", "right"], ["top", "bottom"]]) {
                if (edges.includes(start)) values[end] = values[start];
                else if (edges.includes(end)) values[start] = values[end];
            }
        }
        const selected = internalWidget("gh_visual_ratio")?.value || "自由比例";
        if (!RATIOS.includes(selected) || selected === "自由比例") return { ...values };
        let [rw, rh] = selected.split(":").map(Number);
        const gcd = (a, b) => b ? gcd(b, a % b) : a;
        const divisor = gcd(rw, rh); rw /= divisor; rh /= divisor;
        const horizontal = edges.some((key) => key === "left" || key === "right");
        const vertical = edges.some((key) => key === "top" || key === "bottom");
        const widthFactor = (iw + values.left + values.right) / rw;
        const heightFactor = (ih + values.top + values.bottom) / rh;
        const desired = horizontal && !vertical ? widthFactor : vertical && !horizontal ? heightFactor : Math.max(widthFactor, heightFactor);
        let factor = Math.ceil(Math.max(iw / rw, ih / rh, desired));
        if (symmetric) {
            // Prefer dimensions with even total padding, when integer pixels and
            // the selected ratio permit exact opposite-side equality.
            const evenPads = (value) => (value * rw - iw) % 2 === 0 && (value * rh - ih) % 2 === 0;
            if (!evenPads(factor) && evenPads(factor + 1)) factor += 1;
        }
        const result = { ...values };
        for (const [start, end, total] of [["left", "right", factor * rw - iw], ["top", "bottom", factor * rh - ih]]) {
            const sum = values[start] + values[end];
            // Keep the opposite side fixed when only one side of an axis moves.
            let first = symmetric ? Math.floor(total / 2)
                : edges.includes(start) && !edges.includes(end) ? total - values[end]
                : edges.includes(end) && !edges.includes(start) ? values[start]
                : sum ? Math.round(total * values[start] / sum) : Math.floor(total / 2);
            first = clamp(Math.round(first), 0, total);
            result[start] = first; result[end] = total - first;
        }
        return result;
    }
    function writePads(values) {
        if (!state.image) return;
        state.writing = true;
        try {
            for (const [key, name] of Object.entries(SIDES)) setExtension(name, Math.round(values[key]), key === "left" || key === "right" ? state.image.naturalWidth : state.image.naturalHeight);
            const layout = internalWidget("gh_visual_layout");
            if (layout) layout.value = JSON.stringify({ signature: signature(), pads: Object.keys(SIDES).map((key) => Math.max(0, Math.round(values[key]))) });
        } finally { state.writing = false; }
        node.setDirtyCanvas?.(true, true);
    }
    function enforce(edges = []) {
        if (state.writing || !state.image) return;
        state.fixedOutput = null;
        ratio.value = internalWidget("gh_visual_ratio")?.value || "自由比例";
        const symmetric = !!state.shiftKey && edges.length > 0;
        if (ratio.value !== "自由比例" || symmetric) writePads(constrain(current(), state.image.naturalWidth, state.image.naturalHeight, edges, symmetric));
        draw();
    }
    ratio.addEventListener("pointerdown", (event) => event.stopPropagation());
    ratio.addEventListener("change", (event) => {
        event.stopPropagation();
        internalWidget("gh_visual_ratio").value = ratio.value;
        node.properties ??= {}; node.properties.gh_visual_ratio = ratio.value;
        enforce();
    });
    function setExtension(nodeName, pixels, base) {
        const unit = node.widgets?.find((item) => item.name === "单位")?.value || "像素";
        const value = unit === "百分比" ? Math.round(pixels * 100 / Math.max(1, base)) : pixels;
        setNumber(node, nodeName, value);
    }
    function outpaintColor() {
        const value = node.widgets?.find((item) => item.name === "外补颜色")?.value;
        return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : "#808080";
    }
    function outputGeometry(iw, ih, values) {
        const v = constrain(values, iw, ih);
        const totalW = iw + v.left + v.right, totalH = ih + v.top + v.bottom;
        const maximum = numberWidget(node, "最大输出长边")?.value || 0;
        const multiple = numberWidget(node, "整除数")?.value || 0;
        let scale = maximum > 0 ? Math.min(1, maximum / Math.max(totalW, totalH)) : 1;
        const horizontal = v.left + v.right > 0, vertical = v.top + v.bottom > 0;
        if (multiple > 0 && horizontal !== vertical) {
            const base = horizontal ? totalH : totalW;
            let target = Math.max(multiple, Math.round(base * scale / multiple) * multiple);
            if (maximum > 0 && target / base * Math.max(totalW, totalH) > maximum) {
                target = Math.floor(base * scale / multiple) * multiple;
            }
            if (target > 0) scale = target / base;
        } else if (multiple > 0 && !horizontal && !vertical) {
            scale = Math.max(scale, multiple / Math.min(totalW, totalH));
        }
        const scaledW = Math.max(1, Math.round(totalW * scale)), scaledH = Math.max(1, Math.round(totalH * scale));
        let outputW = scaledW, outputH = scaledH;
        if (multiple > 0) {
            const rounded = (total, original, start, end) => {
                if (!v[start] && !v[end]) return !horizontal && !vertical
                    ? Math.max(multiple, Math.floor(total / multiple) * multiple) : total;
                const safe = Math.floor(v[start] * total / original) + Math.floor(v[end] * total / original);
                return Math.max(multiple, Math.ceil((total - safe) / multiple) * multiple, Math.round(total / multiple) * multiple);
            };
            outputW = rounded(scaledW, totalW, "left", "right");
            outputH = rounded(scaledH, totalH, "top", "bottom");
        }
        // Editing stays in source pixels; the caption reports the final output.
        return { ...v, totalW, totalH, outputW, outputH };
    }
    function draw() {
        if (state.writing || state.disposed) return;
        const ctx = canvas.getContext("2d");
        const rect = viewport.getBoundingClientRect();
        if (!root.isConnected || rect.width <= 0 || rect.height <= 0) return;
        state.displaySignature = displaySignature();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        const values = current(); const img = state.image;
        if (!img) { state.layout = null; ctx.fillStyle = "#9aa4af"; ctx.textAlign = "center"; ctx.fillText("连接加载图像节点后自动显示，或点击“加载”", rect.width / 2, rect.height / 2); info.textContent = "未加载图像"; return; }
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        const v = outputGeometry(iw, ih, values);
        const { totalW, totalH } = v;
        // Reserve 20% of the source size on each side by default.
        const fit = Math.min(rect.width / Math.max(1, iw * 1.4), rect.height / Math.max(1, ih * 1.4));
        let maxScale = Math.min(1, Math.max(1, rect.width - 4) / Math.max(1, totalW), Math.max(1, rect.height - 4) / Math.max(1, totalH));
        let scale = Math.min(fit * state.zoom, maxScale);
        let x = (rect.width - totalW * scale) / 2, y = (rect.height - totalH * scale) / 2;
        if (state.sourceAnchor) {
            // Keep the source position stable during interactive edits so the
            // output centre actually moves as an individual side is extended.
            const cx = state.sourceAnchor.x * rect.width, cy = state.sourceAnchor.y * rect.height;
            maxScale = Math.min(maxScale,
                Math.max(1, cx - 2) / Math.max(1, v.left + iw / 2),
                Math.max(1, rect.width - cx - 2) / Math.max(1, v.right + iw / 2),
                Math.max(1, cy - 2) / Math.max(1, v.top + ih / 2),
                Math.max(1, rect.height - cy - 2) / Math.max(1, v.bottom + ih / 2));
            scale = Math.min(scale, maxScale);
            x = cx - (v.left + iw / 2) * scale;
            y = cy - (v.top + ih / 2) * scale;
        }
        if (state.moveOrigin) {
            // Moving the source redistributes padding inside a fixed output box.
            ({ x, y, scale } = state.moveOrigin.layout);
        } else if (state.fixedOutput && state.fixedOutput.totalW === totalW && state.fixedOutput.totalH === totalH) {
            const box = state.fixedOutput;
            scale = Math.min(box.scale * Math.min(rect.width / box.width, rect.height / box.height), 1);
            x = box.cx * rect.width - totalW * scale / 2;
            y = box.cy * rect.height - totalH * scale / 2;
        }
        if (!state.moveOrigin) { x += (state.pan?.x || 0) * rect.width; y += (state.pan?.y || 0) * rect.height; }
        // Discard zoom above the visible fit limit so reversing the wheel acts immediately.
        state.zoom = Math.min(state.zoom, scale / fit);
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, totalW * scale, totalH * scale); ctx.clip();
        ctx.fillStyle = outpaintColor(); ctx.fillRect(x, y, totalW * scale, totalH * scale);
        ctx.drawImage(img, x + v.left * scale, y + v.top * scale, iw * scale, ih * scale);
        ctx.restore();
        // Cyan border describes the final output boundary and therefore encloses
        // both the source image and every outpaint side.
        ctx.strokeStyle = "#4dd0e1"; ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, totalW * scale, totalH * scale);
        info.textContent = `${v.outputW} × ${v.outputH}`;
        state.layout = { x, y, scale, fit, zoomLimit: Math.min(1, maxScale / fit), iw, ih, totalW, totalH, left: v.left, top: v.top };
        const candidate = state.pointer ? drawPointerGuide(ctx, rect) : null;
        drawExtensionValues(ctx, rect, candidate || { left: x, right: x + totalW * scale, top: y, bottom: y + totalH * scale });
        drawCenterAnchor(ctx, x + totalW * scale / 2, y + totalH * scale / 2, dpr);
    }
    function drawExtensionValues(ctx, rect, bounds) {
        const p = state.layout;
        const sourceLeft = p.x + p.left * p.scale, sourceTop = p.y + p.top * p.scale;
        const values = {
            left: (sourceLeft - bounds.left) / p.scale,
            right: (bounds.right - sourceLeft) / p.scale - p.iw,
            top: (sourceTop - bounds.top) / p.scale,
            bottom: (bounds.bottom - sourceTop) / p.scale - p.ih,
        };
        const percent = internalWidget("单位")?.value === "百分比";
        const cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2;
        ctx.save();
        ctx.font = "10px sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgb(200, 200, 200)";
        ctx.strokeStyle = "#20242b";
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        for (const [side, pixels] of Object.entries(values)) {
            const horizontal = side === "left" || side === "right";
            const value = Math.round(percent ? pixels * 100 / (horizontal ? p.iw : p.ih) : pixels);
            if (value <= 0) continue;
            const text = String(value), half = ctx.measureText(text).width / 2;
            let x = cx, y = cy;
            if (side === "left") x = bounds.left - 7 - half;
            else if (side === "right") x = bounds.right + 7 + half;
            else if (side === "top") y = bounds.top - 12;
            else y = bounds.bottom + 12;
            x = clamp(x, half + 2, Math.max(half + 2, rect.width - half - 2));
            y = clamp(y, 8, Math.max(8, rect.height - 8));
            ctx.textAlign = "center";
            ctx.strokeText(text, x, y);
            ctx.fillText(text, x, y);
        }
        ctx.restore();
    }
    function drawCenterAnchor(ctx, x, y, dpr) {
        // Choose contrast from the actual composited image under the marker.
        let light = false;
        try {
            const sx = clamp(Math.round(x * dpr), 0, canvas.width - 1);
            const sy = clamp(Math.round(y * dpr), 0, canvas.height - 1);
            const pixel = ctx.getImageData(sx, sy, 1, 1).data;
            light = pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722 > 145;
        } catch (_) { /* A dual outline also works if a source cannot be sampled. */ }
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            ctx.moveTo(x + dx * 6, y + dy * 6); ctx.lineTo(x + dx * 10, y + dy * 10);
        }
        ctx.strokeStyle = light ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.85)";
        ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = light ? "#111111" : "#ffffff";
        ctx.lineWidth = 1.25; ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        ctx.restore();
    }
    function pointInLayout(event) {
        const r = viewport.getBoundingClientRect(), p = state.layout;
        return { x: (event.clientX - r.left - p.x) / p.scale, y: (event.clientY - r.top - p.y) / p.scale };
    }
    function hitEdges(point, boundaryOnly = false) {
        const p = state.layout;
        const tolerance = 5 / p.scale;
        const nearLeft = Math.abs(point.x) <= tolerance;
        const nearRight = Math.abs(point.x - p.totalW) <= tolerance;
        const nearTop = Math.abs(point.y) <= tolerance;
        const nearBottom = Math.abs(point.y - p.totalH) <= tolerance;
        const insideY = point.y >= -tolerance && point.y <= p.totalH + tolerance;
        const insideX = point.x >= -tolerance && point.x <= p.totalW + tolerance;
        const horizontal = (nearLeft || nearRight) && insideY;
        const vertical = (nearTop || nearBottom) && insideX;
        if (horizontal || vertical) {
            return [horizontal ? (nearLeft ? "left" : "right") : null, vertical ? (nearTop ? "top" : "bottom") : null].filter(Boolean);
        }
        if (boundaryOnly) return [];
        // Any point in an outpaint strip is actionable.  This makes a click in
        // the middle of a wide strip move that side directly to the click.
        const inferred = [];
        if (point.x < p.left) inferred.push("left");
        if (point.x > p.left + p.iw) inferred.push("right");
        if (point.y < p.top) inferred.push("top");
        if (point.y > p.top + p.ih) inferred.push("bottom");
        return inferred;
    }
    function drawPointerGuide(ctx, rect) {
        const event = state.pointer;
        const point = pointInLayout(event);
        // Candidate edges follow the active drag; the pointer stays a small cross.
        const edges = state.moveOrigin || state.panOrigin ? [] : state.dragging || hitEdges(point);
        if (state.panOrigin) { viewport.style.cursor = "grabbing"; return; }
        viewport.style.cursor = "none";
        const px = event.clientX - rect.left, py = event.clientY - rect.top;
        const candidate = !state.dragging && edges.length ? drawCandidateBoundary(ctx, px, py, edges) : null;
        ctx.save();
        ctx.globalCompositeOperation = "difference";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(px - 7, py); ctx.lineTo(px + 7, py);
        ctx.moveTo(px, py - 7); ctx.lineTo(px, py + 7);
        ctx.stroke();
        ctx.restore();
        return candidate;
    }
    function drawCandidateBoundary(ctx, px, py, edges) {
        const p = state.layout;
        // Hover overlays never change widgets, viewport geometry or the centre.
        const sourceLeft = p.x + p.left * p.scale;
        const sourceTop = p.y + p.top * p.scale;
        const sourceRight = sourceLeft + p.iw * p.scale;
        const sourceBottom = sourceTop + p.ih * p.scale;
        let left = edges.includes("left") ? Math.min(px, sourceLeft) : p.x;
        let right = edges.includes("right") ? Math.max(px, sourceRight) : p.x + p.totalW * p.scale;
        let top = edges.includes("top") ? Math.min(py, sourceTop) : p.y;
        let bottom = edges.includes("bottom") ? Math.max(py, sourceBottom) : p.y + p.totalH * p.scale;
        if (ratio.value !== "自由比例" || state.shiftKey) {
            const candidate = constrain({ left: Math.round((sourceLeft - left) / p.scale), right: Math.round((right - sourceRight) / p.scale),
                top: Math.round((sourceTop - top) / p.scale), bottom: Math.round((bottom - sourceBottom) / p.scale) }, p.iw, p.ih, edges, state.shiftKey);
            left = sourceLeft - candidate.left * p.scale; right = sourceRight + candidate.right * p.scale;
            top = sourceTop - candidate.top * p.scale; bottom = sourceBottom + candidate.bottom * p.scale;
        }
        ctx.save();
        ctx.strokeStyle = "#4dd0e1"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.strokeRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
        ctx.restore();
        return { left, right, top, bottom };
    }
    function updateFromPoint(event, edges = state.dragging) {
        if (!state.layout || !edges?.length) return;
        const p = state.layout, point = pointInLayout(event);
        const origin = state.dragOrigin;
        const values = { ...(origin?.values || current()) };
        if (origin) {
            // Freeze the drag's reference geometry so recentering and rounding
            // never feed back into widget values while the pointer is still.
            const dx = (event.clientX - origin.x) / origin.scale;
            const dy = (event.clientY - origin.y) / origin.scale;
            if (edges.includes("left")) values.left = Math.max(0, Math.round(origin.values.left - dx));
            if (edges.includes("right")) values.right = Math.max(0, Math.round(origin.values.right + dx));
            if (edges.includes("top")) values.top = Math.max(0, Math.round(origin.values.top - dy));
            if (edges.includes("bottom")) values.bottom = Math.max(0, Math.round(origin.values.bottom + dy));
        } else {
            if (edges.includes("left")) values.left = Math.max(0, Math.round(p.left - point.x));
            if (edges.includes("right")) values.right = Math.max(0, Math.round(point.x - p.left - p.iw));
            if (edges.includes("top")) values.top = Math.max(0, Math.round(p.top - point.y));
            if (edges.includes("bottom")) values.bottom = Math.max(0, Math.round(point.y - p.top - p.ih));
        }
        writePads(constrain(values, p.iw, p.ih, edges, event.shiftKey ?? state.shiftKey));
        draw(); node.setDirtyCanvas?.(true, true);
    }
    viewport.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !state.layout) return;
        state.shiftKey = event.shiftKey;
        const point = pointInLayout(event), layout = state.layout;
        const onImage = point.x >= Math.max(0, layout.left) && point.x <= Math.min(layout.totalW, layout.left + layout.iw)
            && point.y >= Math.max(0, layout.top) && point.y <= Math.min(layout.totalH, layout.top + layout.ih);
        if (onImage && !hitEdges(point, true).length && (layout.totalW > layout.iw || layout.totalH > layout.ih)) {
            state.moveOrigin = { x: event.clientX, y: event.clientY, layout: { ...layout } };
            state.pointer = { clientX: event.clientX, clientY: event.clientY };
            viewport.setPointerCapture?.(event.pointerId);
            event.preventDefault(); event.stopPropagation(); return;
        }
        const edges = hitEdges(pointInLayout(event));
        if (!edges.length) return;
        state.fixedOutput = null;
        const p = state.layout, rect = viewport.getBoundingClientRect();
        state.sourceAnchor = {
            x: (p.x + (p.left + p.iw / 2) * p.scale) / Math.max(1, rect.width) - (state.pan?.x || 0),
            y: (p.y + (p.top + p.ih / 2) * p.scale) / Math.max(1, rect.height) - (state.pan?.y || 0),
        };
        const boundary = hitEdges(pointInLayout(event), true);
        state.dragging = edges;
        state.dragOrigin = null;
        state.pointer = { clientX: event.clientX, clientY: event.clientY };
        if (!boundary.length) updateFromPoint(event);
        state.dragOrigin = { x: event.clientX, y: event.clientY, scale: state.layout.scale, values: { ...current() } };
        draw();
        viewport.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    });
    viewport.addEventListener("pointermove", (event) => {
        state.shiftKey = event.shiftKey;
        state.pointer = { clientX: event.clientX, clientY: event.clientY };
        if (state.moveOrigin) {
            const origin = state.moveOrigin, p = origin.layout;
            const horizontal = Math.max(0, p.totalW - p.iw), vertical = Math.max(0, p.totalH - p.ih);
            const left = clamp(Math.round(p.left + (event.clientX - origin.x) / p.scale), 0, horizontal);
            const top = clamp(Math.round(p.top + (event.clientY - origin.y) / p.scale), 0, vertical);
            writePads({ left, right: horizontal - left, top, bottom: vertical - top });
            draw();
            event.preventDefault(); event.stopPropagation();
        } else if (state.dragging) updateFromPoint(event);
        else draw();
    });
    function startPreviewPan(event) {
        if (event.button !== 1 || !state.layout) return;
        const rect = viewport.getBoundingClientRect();
        state.panOrigin = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan: { ...state.pan }, layout: { ...state.layout }, width: rect.width, height: rect.height };
        state.pointer = null;
        viewport.style.cursor = "grabbing";
        viewport.setPointerCapture?.(event.pointerId);
        event.preventDefault(); event.stopImmediatePropagation(); draw();
    }
    function movePreviewPan(event) {
        if (!state.panOrigin) return;
        const origin = state.panOrigin, p = origin.layout;
        // The source stays inside the viewport; padding and pixels are unchanged.
        const left = p.x + p.left * p.scale, top = p.y + p.top * p.scale;
        const dx = clamp(event.clientX - origin.x, -left, origin.width - left - p.iw * p.scale);
        const dy = clamp(event.clientY - origin.y, -top, origin.height - top - p.ih * p.scale);
        state.pan = { x: (origin.pan.x || 0) + dx / origin.width, y: (origin.pan.y || 0) + dy / origin.height };
        event.preventDefault(); event.stopImmediatePropagation(); draw();
    }
    function finishPreviewPan(event) {
        if (!state.panOrigin) return;
        state.panOrigin = null;
        const rect = viewport.getBoundingClientRect();
        state.pointer = event.type !== "pointercancel" && event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top && event.clientY <= rect.bottom
            ? { clientX: event.clientX, clientY: event.clientY } : null;
        viewport.style.cursor = "default";
        if (viewport.hasPointerCapture?.(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
        event.preventDefault(); event.stopImmediatePropagation(); draw();
    }
    viewport.addEventListener("auxclick", (event) => { if (event.button === 1) { event.preventDefault(); event.stopPropagation(); } });
    function finishMove() {
        if (!state.moveOrigin) return;
        const p = state.layout, rect = viewport.getBoundingClientRect();
        state.sourceAnchor = { x: (p.x + (p.left + p.iw / 2) * p.scale) / Math.max(1, rect.width) - (state.pan?.x || 0), y: (p.y + (p.top + p.ih / 2) * p.scale) / Math.max(1, rect.height) - (state.pan?.y || 0) };
        state.fixedOutput = { cx: (p.x + p.totalW * p.scale / 2) / Math.max(1, rect.width) - (state.pan?.x || 0), cy: (p.y + p.totalH * p.scale / 2) / Math.max(1, rect.height) - (state.pan?.y || 0),
            width: rect.width, height: rect.height, scale: p.scale, totalW: p.totalW, totalH: p.totalH };
        state.moveOrigin = null;
    }
    viewport.addEventListener("pointerup", () => { finishMove(); state.dragging = null; state.dragOrigin = null; draw(); });
    viewport.addEventListener("pointercancel", () => { finishMove(); state.dragging = null; state.dragOrigin = null; state.pointer = null; viewport.style.cursor = "default"; draw(); });
    viewport.addEventListener("pointerleave", () => { if (state.dragging || state.moveOrigin || state.panOrigin) return; state.pointer = null; viewport.style.cursor = "default"; draw(); });
    function shiftChanged(event) {
        if (event.key !== "Shift") return;
        state.shiftKey = event.type === "keydown";
        if (!state.pointer || !state.layout) return;
        if (state.dragging) updateFromPoint({ ...state.pointer, shiftKey: state.shiftKey });
        else draw();
    }
    const clearShift = () => { state.shiftKey = false; if (state.pointer) draw(); };
    window.addEventListener("keydown", shiftChanged);
    window.addEventListener("keyup", shiftChanged);
    window.addEventListener("blur", clearShift);
    // Vue's graph layer forwards these events during ancestor capture. Intercept
    // only preview gestures at document capture, before that forwarding runs.
    function capturePreviewNavigation(event) {
        if (state.disposed || !root.isConnected) return;
        const inside = event.composedPath().includes(viewport);
        const panning = state.panOrigin != null && state.panOrigin.pointerId === event.pointerId;
        if (event.type === "wheel") {
            if (!inside) return;
            event.preventDefault(); event.stopImmediatePropagation();
            if (!event.deltaY) return;
            state.fixedOutput = null;
            const zoom = state.layout ? state.layout.scale / state.layout.fit : state.zoom;
            const limit = state.layout?.zoomLimit || 1;
            state.zoom = clamp(zoom * (event.deltaY < 0 ? 1.1 : 0.9), limit * 0.25, limit);
            draw();
        } else if (event.type === "pointerdown") {
            if (!inside || event.button !== 1) return;
            event.preventDefault(); event.stopImmediatePropagation();
            startPreviewPan(event);
        } else if (panning) {
            if (event.type === "pointermove") movePreviewPan(event);
            else finishPreviewPan(event);
        }
    }
    const navigationEvents = ["wheel", "pointerdown", "pointermove", "pointerup", "pointercancel"];
    for (const type of navigationEvents) document.addEventListener(type, capturePreviewNavigation, { capture: true, passive: false });
    load.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (load.disabled) return;
        const url = loaderFor(node);
        if (url) { try { await setImage(url); } catch (error) { if (!state.disposed) info.textContent = error.message; } return; }
        load.disabled = true; info.textContent = "正在加载上游图像…";
        state.cancelPreview?.();
        const controller = new AbortController();
        state.previewController?.abort();
        state.previewController = controller;
        const finish = (message) => { if (state.disposed || controller.signal.aborted) return; load.disabled = false; if (message) info.textContent = message; };
        try {
            state.cancelPreview = await loadUpstreamPreview(node, async (src) => {
                if (state.disposed || controller.signal.aborted) return;
                state.upstreamPreviewUrl = src;
                try { await setImage(src); } finally { finish(); }
            }, finish, controller.signal);
        } catch (error) { finish(error.message); }
    });
    reset.addEventListener("click", (event) => { event.stopPropagation(); if (state.image) writePads(constrain({ left: 0, right: 0, top: 0, bottom: 0 }, state.image.naturalWidth, state.image.naturalHeight)); state.sourceAnchor = null; state.fixedOutput = null; state.pan = {}; state.zoom = 1; draw(); });
    async function setImage(src) {
        if (state.disposed) return;
        state.cancelImage?.();
        state.imageRequest = (state.imageRequest || 0) + 1;
        const requestId = state.imageRequest;
        if (!src) { state.image = null; draw(); return; }
        return new Promise((resolve, reject) => {
            const img = new Image();
            const cancel = () => { img.onload = img.onerror = null; img.src = ""; state.cancelImage = null; resolve(); };
            state.cancelImage = cancel;
            const finish = () => { img.onload = img.onerror = null; if (state.cancelImage === cancel) state.cancelImage = null; };
            img.onload = () => {
                finish();
                if (!state.disposed && requestId === state.imageRequest) {
                    state.image = img; state.sourceAnchor = null; state.fixedOutput = null; state.pan = {}; state.zoom = 1; enforce();
                    scheduleDisplayRefresh();
                }
                resolve();
            };
            img.onerror = () => { finish(); reject(new Error("图像预览加载失败")); };
            img.src = src;
        });
    }
    state.refresh = () => {
        if (state.disposed) return;
        const url = loaderFor(node) || state.upstreamPreviewUrl;
        setImage(url).catch((error) => { if (!state.disposed) info.textContent = error.message; });
        draw();
    };
    // The frontend exposes executing.detail as the node ID, not the raw server payload.
    const refreshOnExecution = (event) => {
        if (!state.disposed && event.detail != null && String(event.detail) === String(node.id)) {
            load.click();
        }
    };
    api.addEventListener("executing", refreshOnExecution);
    state.loaderKey = loaderInfo(node)?.key || "";
    state.observeLoader = (force = false) => {
        if (state.disposed) return;
        const info = loaderInfo(node);
        const key = info?.key || "";
        if (!force && key === state.loaderKey) return;
        state.loaderKey = key;
        state.refresh();
    };
    function patchLoaderEvents(loader) {
        state.unsubscribeLoader?.();
        state.unsubscribeLoader = subscribeLoader(loader, () => state.observeLoader(true));
    }
    patchLoaderEvents(loaderInfo(node)?.node);
    const original = node.onConnectionsChange; node.onConnectionsChange = function (type, index) {
        const result = original?.apply(this, arguments);
        if (type !== 1 || !["图像", "image"].includes(this.inputs?.[index]?.name)) return result;
        state.cancelPreview?.(); state.cancelPreview = null; load.disabled = false;
        state.previewController?.abort();
        state.upstreamPreviewUrl = null;
        const info = loaderInfo(this); patchLoaderEvents(info?.node); state.loaderKey = info?.key || "";
        state.refresh(); return result;
    };
    const removed = node.onRemoved;
    node.onRemoved = function () {
        if (state.disposed) return removed?.apply(this, arguments);
        state.disposed = true;
        for (const type of navigationEvents) document.removeEventListener(type, capturePreviewNavigation, true);
        api.removeEventListener("executing", refreshOnExecution);
        cancelAnimationFrame(state.displayFrame);
        transformObserver.disconnect();
        mountObserver.disconnect();
        window.removeEventListener("resize", scheduleDisplayRefresh);
        document.removeEventListener("visibilitychange", scheduleDisplayRefresh);
        window.removeEventListener("keydown", shiftChanged);
        window.removeEventListener("keyup", shiftChanged);
        window.removeEventListener("blur", clearShift);
        state.cancelPreview?.();
        state.previewController?.abort();
        state.unsubscribeLoader?.();
        state.cancelImage?.();
        state.imageRequest = (state.imageRequest || 0) + 1;
        state.resizeObserver?.disconnect();
        const pointerId = state.panOrigin?.pointerId;
        if (pointerId != null && viewport.hasPointerCapture?.(pointerId)) viewport.releasePointerCapture(pointerId);
        state.panOrigin = null; state.pointer = null; state.image = null;
        state.upstreamPreviewUrl = null;
        state.widgetGrid?.style.removeProperty("--gh-outpaint-rows");
        state.widgetGrid = null;
        root.remove();
        canvas.width = canvas.height = 0;
        return removed?.apply(this, arguments);
    };
    const originalChanged = node.onWidgetChanged; node.onWidgetChanged = function (name) {
        const result = originalChanged?.apply(this, arguments);
        if (state.writing) return result;
        state.observeLoader();
        const side = Object.keys(SIDES).find((key) => SIDES[key] === name);
        if (side || name === "单位") enforce(side ? [side] : []);
        else draw();
        return result;
    };
    for (const [key, name] of [...Object.entries(SIDES), [null, "单位"], [null, "整除数"], [null, "最大输出长边"]]) {
        const input = internalWidget(name);
        if (!input) continue;
        const callback = input.callback;
        input.callback = function () {
            const result = callback?.apply(this, arguments);
            if (!state.writing) {
                if (key || name === "单位") enforce(key ? [key] : []);
                else draw();
            }
            return result;
        };
    }
    state.restore = () => {
        const saved = internalWidget("gh_visual_ratio")?.value;
        ratio.value = RATIOS.includes(saved) ? saved : node.properties?.gh_visual_ratio || "自由比例";
        internalWidget("gh_visual_ratio").value = ratio.value;
        state.refresh();
        scheduleDisplayRefresh();
    };
    const resizeObserver = new ResizeObserver(() => { draw(); scheduleDisplayRefresh(); });
    resizeObserver.observe(viewport);
    state.resizeObserver = resizeObserver;
    observeDisplayAncestors();
    scheduleDisplayRefresh();
    state.refresh(); return state;
}

app.registerExtension({
    name: "goohaitools.outpaint_visual",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_TYPE) return;
        const created = nodeType.prototype.onNodeCreated;
        const computeSize = nodeType.prototype.computeSize;
        nodeType.prototype.computeSize = function () {
            const size = computeSize?.apply(this, arguments) || [360, 520];
            size[0] = Math.max(size[0], 320);
            size[1] = Math.max(size[1], 420);
            return size;
        };
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            for (const name of ["gh_visual_ratio", "gh_visual_layout"]) {
                const widget = this.widgets?.find((item) => item.name === name);
                if (!widget) continue;
                widget.type = "hidden";
                widget.hidden = true;
                widget.options ??= {};
                widget.options.socketless = true;
                widget.computeSize = () => [0, 0];
                widget.draw = () => {};
                widget.mouse = () => false;
                widget.serializeValue = () => widget.value;
                if (widget.inputEl) widget.inputEl.style.display = "none";
                if (widget.element) widget.element.style.display = "none";
            }
            this.serialize_widgets = true;
            createPreview(this); this.setSize([360, 520]); return result;
        };
        const configured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () { const result = configured?.apply(this, arguments); createPreview(this)?.restore(); return result; };
        const resized = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () { const result = resized?.apply(this, arguments); this.setDirtyCanvas?.(true, true); return result; };
    },
});

