import { app } from "../../../scripts/app.js";

// 比例与分辨率：控件按当前选择动态显隐，并在输出插槽名称前显示预计尺寸。
// 计算逻辑与 nodes/比例与分辨率.py 保持一致。

const RATIO_VALUES = {
    "1:1": [1, 1], "2:3": [2, 3], "3:2": [3, 2], "3:4": [3, 4],
    "4:3": [4, 3], "5:7": [5, 7], "9:16": [9, 16], "16:9": [16, 9],
    "21:9": [21, 9], "1:2": [1, 2], "2:1": [2, 1],
};

function getWidget(node, name) {
    return node.widgets?.find((w) => w.name === name);
}

function widgetValue(node, name, fallback) {
    const w = getWidget(node, name);
    return w && w.value !== undefined ? w.value : fallback;
}

function connectedImageInfo(node) {
    const input = node.inputs?.find((slot) => slot.name === "图像" || slot.label === "图像");
    if (!input || input.link == null || !node.graph?.links) {
        return { connected: false, size: null };
    }
    const link = node.graph.links[input.link];
    const origin = link && node.graph.getNodeById?.(link.origin_id);
    const image = origin?.imgs?.[origin.imageIndex ?? 0] || origin?.imgs?.[0];
    const width = Number(image?.naturalWidth || image?.width || 0);
    const height = Number(image?.naturalHeight || image?.height || 0);
    return { connected: true, size: width > 0 && height > 0 ? [width, height] : null };
}

function roundToMultiple(value, multiple) {
    value = Math.max(1, Number(value) || 1);
    multiple = Math.trunc(Number(multiple) || 0);
    if (multiple <= 0) return Math.max(1, Math.round(value));
    return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function estimateSize(node) {
    const ratioName = String(widgetValue(node, "比例", "原始比例"));
    const mode = String(widgetValue(node, "模式", "固定长边"));
    const fixed = Number(widgetValue(node, "固定边像素", 1024));
    const mp = Math.max(0.2, Number(widgetValue(node, "百万像素", 2.0)) || 2.0);
    const customW = Number(widgetValue(node, "自定宽度", 1024));
    const customH = Number(widgetValue(node, "自定高度", 1024));
    const multiple = Number(widgetValue(node, "倍数取整", 16));

    // “原始比例”时区分三种状态：没有连接图像、已连接且可读尺寸、
    // 已连接但前端无法穿透中间节点读取尺寸。第三种不能伪显示 1:1。
    const imageInfo = ratioName === "原始比例" ? connectedImageInfo(node) : null;
    if (ratioName === "原始比例" && imageInfo.connected && !imageInfo.size) {
        if (node._ghRatioResolutionExecutedSize) {
            return { ...node._ghRatioResolutionExecutedSize };
        }
        return { width: null, height: null, ratio: null, unknown: true };
    }

    let w, h;
    if (ratioName === "自定义宽高") {
        w = customW;
        h = customH;
    } else {
        // 尽量从上游预览读取原图尺寸；无法读取时按后端无图像回退规则预览 1:1。
        const pair = ratioName === "原始比例"
            ? (imageInfo.size || [1, 1])
            : (RATIO_VALUES[ratioName] || [1, 1]);
        const rw = pair[0];
        const rh = pair[1];
        if (mode === "固定长边") {
            const scale = fixed / Math.max(rw, rh);
            w = rw * scale; h = rh * scale;
        } else if (mode === "固定短边") {
            const scale = fixed / Math.min(rw, rh);
            w = rw * scale; h = rh * scale;
        } else if (mode === "固定宽度") {
            w = fixed; h = fixed * rh / rw;
        } else if (mode === "固定高度") {
            h = fixed; w = fixed * rw / rh;
        } else if (mode === "总像素") {
            // 与 ComfyUI 官方 Resolution Selector 一致：MP 按 1024²
            // 计算目标面积，随后每条边按倍数就近取整。
            const area = mp * 1024 * 1024;
            const scale = Math.sqrt(area / (rw * rh));
            w = rw * scale;
            h = rh * scale;
        } else {
            const scale = fixed / Math.max(rw, rh);
            w = rw * scale; h = rh * scale;
        }
    }

    if (mode === "总像素" && ratioName !== "自定义宽高") {
        w = roundToMultiple(w, multiple);
        h = roundToMultiple(h, multiple);
    } else {
        w = roundToMultiple(w, multiple);
        h = roundToMultiple(h, multiple);
    }
    return { width: w, height: h, ratio: h ? w / h : 0 };
}

function displaySize(node) {
    const estimated = estimateSize(node);
    // 只有前端确实无法穿透中间节点读取图像尺寸时，才暂时沿用最近一次
    // 后端执行结果；可实时计算的参数始终以当前控件值为准。
    if (estimated?.unknown && node._ghRatioResolutionExecutedSize) {
        return { ...node._ghRatioResolutionExecutedSize };
    }
    return estimated;
}

function setWidgetVisible(widget, visible) {
    if (!widget) return;
    if (!widget._ghRatioResolutionOriginals) {
        widget._ghRatioResolutionOriginals = {
            computeSize: widget.computeSize,
            draw: widget.draw,
            mouse: widget.mouse,
        };
    }
    widget.hidden = !visible;
    if (visible) {
        widget.computeSize = widget._ghRatioResolutionOriginals.computeSize;
        widget.draw = widget._ghRatioResolutionOriginals.draw;
        widget.mouse = widget._ghRatioResolutionOriginals.mouse;
    } else {
        widget.computeSize = () => [0, 0];
        widget.draw = () => {};
        widget.mouse = () => false;
    }
}

function updateNodeView(node) {
    const ratioName = String(widgetValue(node, "比例", "原始比例"));
    const mode = String(widgetValue(node, "模式", "固定长边"));
    const isCustom = ratioName === "自定义宽高";
    const isTotalPixels = mode === "总像素";

    // 自定义宽高不需要模式、固定边像素或百万像素；
    // 总像素只需要百万像素。
    setWidgetVisible(getWidget(node, "模式"), !isCustom);
    setWidgetVisible(getWidget(node, "固定边像素"), !isCustom && !isTotalPixels);
    setWidgetVisible(getWidget(node, "百万像素"), !isCustom && isTotalPixels);
    setWidgetVisible(getWidget(node, "自定宽度"), isCustom);
    setWidgetVisible(getWidget(node, "自定高度"), isCustom);

    const size = displaySize(node);
    updateOutputNames(node, size);
    node._ghRatioResolutionSize = size;
    scheduleNodes2DomRefresh();
    // LiteGraph 旧版不会总是在 hidden 改变后自动重新计算节点高度。
    // 重新计算尺寸，避免隐藏项留下空白区域。
    if (typeof node.computeSize === "function" && Array.isArray(node.size)) {
        const nextSize = node.computeSize();
        if (Array.isArray(nextSize) && nextSize.length >= 2) {
            node.size[1] = nextSize[1];
        }
    }
    node.setDirtyCanvas?.(true, true);
}

function refreshNode(node) {
    invalidateExecutedSize(node);
    updateNodeView(node);
}

function asNumber(value) {
    if (Array.isArray(value)) value = value[0];
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function applyExecutedSize(node, message) {
    const output = message?.output || message;
    if (!output) return;
    const metadata = Array.isArray(output.ratio_resolution)
        ? output.ratio_resolution[0]
        : output.ratio_resolution;
    const width = asNumber(metadata?.width ?? output.宽度 ?? output.width ?? output[2]);
    const height = asNumber(metadata?.height ?? output.高度 ?? output.height ?? output[3]);
    if (width === null || height === null || width <= 0 || height <= 0) return;

    const size = { width: Math.round(width), height: Math.round(height), ratio: width / height, unknown: false, executed: true };
    node._ghRatioResolutionExecutedSize = size;
    node._ghRatioResolutionSize = size;
    updateOutputNames(node, size);
    scheduleNodes2DomRefresh();
    node.setDirtyCanvas?.(true, true);
}

function invalidateExecutedSize(node) {
    if (!node?._ghRatioResolutionExecutedSize) return;
    delete node._ghRatioResolutionExecutedSize;
}

function updateOutputNames(node, size) {
    const outputs = node.outputs || [];
    if (outputs[0]) {
        outputs[0].name = "比值";
        outputs[0].label = "比值";
    }
    if (outputs[1]) {
        outputs[1].name = "宽度";
        outputs[1].label = "宽度";
        outputs[1].color = outputs[1].color_on = outputs[1].color_off = "#2aa6c2";
    }
    if (outputs[2]) {
        outputs[2].name = "高度";
        outputs[2].label = "高度";
        outputs[2].color = outputs[2].color_on = outputs[2].color_off = "#2aa6c2";
    }
}

// LiteGraph 旧版和 Nodes 2.0 使用的是两套完全不同的输出标签渲染器：
// 旧版走 canvas，Nodes 2.0 走 Vue DOM。输出名称保持稳定，数值由各自渲染层绘制。
function setLegacyOutputLabels(node, labelsOnly) {
    const outputs = node.outputs || [];
    for (const [index, label] of [[1, "宽度"], [2, "高度"]]) {
        const output = outputs[index];
        if (!output) continue;
        output.name = label;
        output.label = label;
    }
}

function outputLocalY(node, index) {
    const output = node.outputs?.[index];
    const direct = Number(output?.pos?.[1]);
    if (Number.isFinite(direct)) return direct;
    if (typeof node.getConnectionPos === "function") {
        const point = node.getConnectionPos(false, index, [0, 0]);
        const y = Number(point?.[1]) - Number(node.pos?.[1] || 0);
        if (Number.isFinite(y)) return y;
    }
    return null;
}

function installGlobalOutputRenderer() {
    if (globalThis.__ghRatioResolutionDrawHooked) return;
    if (typeof LGraphCanvas === "undefined" || !LGraphCanvas.prototype?.drawNode) {
        // 某些前端版本在扩展注册时还未完成 LiteGraph 初始化。
        // 延迟重试，避免颜色覆盖钩子因为加载时序而失效。
        if (!globalThis.__ghRatioResolutionDrawRetry) {
            globalThis.__ghRatioResolutionDrawRetry = true;
            let attempts = 0;
            const retry = () => {
                globalThis.__ghRatioResolutionDrawRetry = false;
                if (!globalThis.__ghRatioResolutionDrawHooked && attempts++ < 30) {
                    installGlobalOutputRenderer();
                }
            };
            setTimeout(retry, 100);
        }
        return;
    }
    globalThis.__ghRatioResolutionDrawHooked = true;
    const originalDrawNode = LGraphCanvas.prototype.drawNode;
    LGraphCanvas.prototype.drawNode = function (node, ctx, ...args) {
        if (node?.type !== "GoohaiRatioAndResolution") {
            return originalDrawNode.call(this, node, ctx, ...args);
        }

        const size = displaySize(node);
        node._ghRatioResolutionSize = size;
        updateOutputNames(node, size);
        // 默认 canvas 绘制期间只显示一次灰色标签，再叠加数值。
        setLegacyOutputLabels(node, true);
        const result = originalDrawNode.call(this, node, ctx, ...args);
        setLegacyOutputLabels(node, false);
        const cyan = "#2aa6c2";
        const fontFamily = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_FONT)
            ? LiteGraph.NODE_FONT
            : "sans-serif";

        ctx.save();
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "right";
        for (const [index, value, label] of [[1, size.width, "宽度"], [2, size.height, "高度"]]) {
            const y = outputLocalY(node, index);
            if (!Number.isFinite(y)) continue;

            if (!size.unknown && Number.isFinite(value)) {
                const fontSize = (typeof LiteGraph !== "undefined" && Number.isFinite(Number(LiteGraph.NODE_TEXT_SIZE)))
                    ? Math.max(8, Number(LiteGraph.NODE_TEXT_SIZE) - 2)
                    : 12;
                ctx.font = `${fontSize}px ${fontFamily}`;
                const right = node.size[0] - 10;
                const labelWidth = ctx.measureText(label).width;
                ctx.fillStyle = cyan;
                ctx.fillText(String(value), right - labelWidth - 12, y + 5);
            }
        }
        ctx.restore();
        return result;
    };
}

const OUTPUT_VALUE_CYAN = "#2aa6c2";

function installNodes2LabelStyles() {
    if (typeof document === "undefined" || document.getElementById("gh-ratio-resolution-label-styles")) return;
    const style = document.createElement("style");
    style.id = "gh-ratio-resolution-label-styles";
    style.textContent = `
      [data-gh-ratio-resolution-label="1"] {
        color: transparent !important;
        font-size: 0 !important;
        white-space: nowrap !important;
      }
      [data-gh-ratio-resolution-label="1"]::before {
        content: attr(data-gh-ratio-value);
        display: inline-block;
        color: ${OUTPUT_VALUE_CYAN} !important;
        font-family: inherit !important;
        font-size: var(--gh-ratio-value-size, 12px) !important;
        font-weight: inherit !important;
      }
      [data-gh-ratio-resolution-label="1"]::after {
        content: attr(data-gh-ratio-name);
        display: inline-block;
        color: #cfd3dc !important;
        font-family: inherit !important;
        font-size: var(--gh-ratio-label-size, 14px) !important;
        font-weight: inherit !important;
        margin-left: 10px;
      }
    `;
    document.head.appendChild(style);
}

function refreshNodes2OutputLabels() {
    if (typeof document === "undefined" || typeof NodeFilter === "undefined") return;
    installNodes2LabelStyles();
    const roots = document.querySelectorAll("[data-node-id]");
    for (const root of roots) {
        const id = root.getAttribute("data-node-id");
        const node = app.graph?.getNodeById?.(Number(id)) || app.graph?.getNodeById?.(id);
        if (node?.type !== "GoohaiRatioAndResolution") continue;
        const size = displaySize(node);
        const labels = root.querySelectorAll(".lg-slot--output .text-node-component-slot-text");
        for (const labelElement of labels) {
            const label = labelElement.textContent.trim();
            if (label !== "宽度" && label !== "高度") continue;
            const value = label === "宽度" ? size?.width : size?.height;
            const nativeSize = Number.parseFloat(getComputedStyle(labelElement).fontSize) || 14;
            labelElement.dataset.ghRatioResolutionLabel = "1";
            labelElement.dataset.ghRatioValue = size?.unknown ? "" : String(value ?? "");
            labelElement.dataset.ghRatioName = label;
            labelElement.style.setProperty("--gh-ratio-label-size", `${nativeSize}px`);
            labelElement.style.setProperty("--gh-ratio-value-size", `${Math.max(8, nativeSize - 2)}px`);
            tintNodes2OutputDot(labelElement);
        }
    }
}

function tintNodes2OutputDot(labelElement) {
    const row = labelElement.closest?.(".lg-slot--output");
    const dot = row?.querySelector?.('[data-testid="slot-dot"]');
    if (!dot) return;
    dot.style.setProperty("background-color", OUTPUT_VALUE_CYAN, "important");
    dot.querySelectorAll?.("circle, path").forEach((shape) => {
        shape.style.setProperty("fill", OUTPUT_VALUE_CYAN, "important");
    });
}

function scheduleNodes2DomRefresh() {
    if (typeof document === "undefined" || globalThis.__ghRatioResolutionDomRefreshQueued) return;
    globalThis.__ghRatioResolutionDomRefreshQueued = true;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            globalThis.__ghRatioResolutionDomRefreshQueued = false;
            refreshNodes2OutputLabels();
        });
    });
}

function installNodes2DomRenderer() {
    if (globalThis.__ghRatioResolutionDomRendererInstalled || typeof document === "undefined") return;
    globalThis.__ghRatioResolutionDomRendererInstalled = true;
    installNodes2LabelStyles();
    scheduleNodes2DomRefresh();
}

function hookWidgetCallbacks(node) {
    if (node._ghRatioResolutionHooked) return;
    node._ghRatioResolutionHooked = true;
    for (const widget of node.widgets || []) {
        if (widget._ghRatioResolutionCallback) continue;
        const original = widget.callback;
        widget.callback = function (value) {
            const result = original?.apply(this, arguments);
            refreshNode(node);
            return result;
        };
        widget._ghRatioResolutionCallback = true;
    }
    const originalWidgetChanged = node.onWidgetChanged;
    node.onWidgetChanged = function (name, value, widget) {
        const result = originalWidgetChanged?.apply(this, arguments);
        refreshNode(this);
        return result;
    };
}

app.registerExtension({
    name: "goohaitools.ratio_resolution",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "GoohaiRatioAndResolution") return;

        installGlobalOutputRenderer();
        installNodes2DomRenderer();

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            requestAnimationFrame(() => {
                hookWidgetCallbacks(this);
                updateNodeView(this);
            });
            return result;
        };

        const originalConfigured = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = originalConfigured?.apply(this, arguments);
            requestAnimationFrame(() => {
                hookWidgetCallbacks(this);
                updateNodeView(this);
            });
            return result;
        };

        const originalConnections = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function () {
            const result = originalConnections?.apply(this, arguments);
            refreshNode(this);
            return result;
        };

        const originalExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            const result = originalExecuted?.apply(this, arguments);
            applyExecutedSize(this, message);
            return result;
        };

        // 新版前端通常通过 API 的 executed 事件派发结果，兼容无法触发
        // nodeType.onExecuted 的情况。
        const api = globalThis.api;
        if (api?.addEventListener && !globalThis.__ghRatioResolutionExecutedListener) {
            globalThis.__ghRatioResolutionExecutedListener = true;
            api.addEventListener("executed", ({ detail }) => {
                const nodeId = String(detail?.node ?? detail?.display_node ?? "");
                const node = app.graph?.getNodeById?.(Number(nodeId)) || app.graph?.getNodeById?.(nodeId);
                if (node?.type === "GoohaiRatioAndResolution") applyExecutedSize(node, detail);
            });
        }
    },
});
