import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const UPSCALE_TYPE = "H3TiledUpscaleGH";
const INTERNAL_NODE_TYPES = new Set(["H3TiledEncodeGH", "H3TiledSampleGH", "H3TiledFinishGH"]);
const upscaleNodes = new Set();
const PROMPT_MIN_HEIGHT = 64;

function resizeUpscalePrompt(node) {
    const state = node._ghUpscaleStatus;
    const delta = node.size[1] - state.resizeHeight;
    state.resizeHeight = node.size[1];
    state.promptHeight = Math.max(PROMPT_MIN_HEIGHT, state.promptHeight + delta);
    node.properties.gh_h3_prompt_height = state.promptHeight;
}

function syncUpscaleLayout(node, body) {
    const state = node._ghUpscaleStatus;
    if (!state || state.disposed || state.sizing) return;
    const host = state.root.closest(".dom-widget");
    host?.style.setProperty("pointer-events", "none", "important");
    const preview = node.widgets?.find((item) => item.name === "$$canvas-image-preview");
    const image = node.imgs?.[node.imageIndex ?? 0] || node.imgs?.[0];
    const vueImage = body?.querySelector(".image-preview, img[data-testid='main-image'], img[alt]");
    const hasPreview = Boolean(image || vueImage || preview);
    const promptRow = body?.querySelector('[data-widget-name="prompt"]');
    if (promptRow) {
        promptRow.style.height = `${state.promptHeight}px`;
        promptRow.style.maxHeight = `${state.promptHeight}px`;
        promptRow.style.minHeight = `${PROMPT_MIN_HEIGHT}px`;
    }
    if (state.previewWidget !== preview && preview) {
        state.previewWidget = preview;
        const imageWidth = image?.naturalWidth || image?.width || 1;
        const imageHeight = image?.naturalHeight || image?.height || 1;
        state.previewHeight = Math.max(220, (node.size[0] - 20) * imageHeight / imageWidth);
        const layout = preview.computeLayoutSize.bind(preview);
        preview.computeLayoutSize = function () {
            return { ...layout(), minHeight: state.previewHeight, maxHeight: state.previewHeight };
        };
    }
    if (state.manualResize || app.canvas?.resizing_node === node) {
        state.hasPreview = hasPreview;
        return;
    }
    if (!state.compactPending && state.hasPreview === hasPreview) return;
    state.compactPending = false;
    state.hasPreview = hasPreview;
    state.sizing = true;
    try {
        // Preserve the prompt's height when preview widgets are added or removed.
        const size = node.computeSize();
        size[0] = node.size[0];
        size[1] += state.promptHeight - PROMPT_MIN_HEIGHT;
        node.setSize(size);
    } finally {
        state.sizing = false;
    }
    node.setDirtyCanvas?.(true, true);
}

function renderUpscaleStatus(root, status) {
    const plan = document.createElement("div");
    plan.textContent = status.plan || "连接图像后显示分块信息";
    plan.title = plan.textContent;
    plan.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    const line = document.createElement("div");
    line.style.whiteSpace = "nowrap";
    if (status.batch_count > 1) line.append(`图像 ${status.batch}/${status.batch_count} | `);
    if (status.tile) {
        const count = document.createElement("span");
        count.textContent = `${status.tile}/${status.tile_count}`;
        count.style.color = "#78bf5f";
        line.append(count, " | ");
    }
    if (status.phase === "修复完成") {
        const done = document.createElement("span");
        done.textContent = "✓";
        done.style.color = "#78bf5f";
        done.title = "修复完成";
        line.append(done);
    } else {
        line.append(status.phase || "待运行");
        if (status.total > 0) {
            const percent = document.createElement("span");
            percent.textContent = ` ${Math.round(status.completed / status.total * 100)} %`;
            percent.style.color = "#78bf5f";
            line.append(percent);
        }
    }
    root.replaceChildren(plan, line);
}

function pinUpscaleStatus(node) {
    const state = node._ghUpscaleStatus;
    if (!state || state.disposed) return;
    const widgets = node.widgets;
    const index = widgets?.indexOf(state.widget);
    const controlsEnd = widgets?.findIndex((item) => item.name === "release_models");
    const targetIndex = controlsEnd >= 0 ? controlsEnd + 1 - (index < controlsEnd ? 1 : 0) : index;
    if (index >= 0 && index !== targetIndex) {
        widgets.splice(index, 1);
        widgets.splice(targetIndex, 0, state.widget);
        node.setDirtyCanvas?.(true, true);
    }
    const vueNode = document.querySelector(`.lg-node[data-node-id="${CSS.escape(String(node.id))}"]`);
    for (const handle of vueNode?.querySelectorAll("[data-corner]") || []) {
        handle.style.zIndex = "50";
        handle.style.pointerEvents = "auto";
    }
    const body = vueNode?.querySelector(`[data-testid="node-body-${CSS.escape(String(node.id))}"]`);
    let parameters = body?.querySelector('[data-testid="node-widgets"]');
    while (parameters && parameters.parentElement !== body) parameters = parameters.parentElement;
    if (body && parameters && parameters.nextElementSibling !== state.vueRoot) {
        body.insertBefore(state.vueRoot, parameters.nextSibling);
    }
    if (!body) state.vueRoot.remove();
    syncUpscaleLayout(node, body);
    if (!state.running) {
        const size = upscaleSourceSize(node);
        const inputKey = `${node.inputs?.[0]?.link}:${size}`;
        if (state.inputKey !== inputKey) {
            state.inputKey = inputKey;
            scheduleUpscalePlan(node);
        }
    }
}

function upscaleSourceSize(node) {
    const state = node._ghUpscaleStatus;
    if (!node.graph) return null;
    const source = node.getInputNode?.(0);
    if (!source) return null;
    const image = source.imgs?.[source.imageIndex ?? 0] || source.imgs?.[0];
    if (image?.naturalWidth && image?.naturalHeight) return [image.naturalWidth, image.naturalHeight];
    const sourceElement = document.querySelector(`.lg-node[data-node-id="${CSS.escape(String(source.id))}"] img[data-testid="main-image"]`);
    if (sourceElement?.naturalWidth) return [sourceElement.naturalWidth, sourceElement.naturalHeight];
    return state.sourceLink === node.inputs?.[0]?.link ? state.sourceSize : null;
}

function setUpscaleStatus(node, status) {
    const state = node._ghUpscaleStatus;
    if (!state) return;
    state.status = status;
    renderUpscaleStatus(state.root, status);
    renderUpscaleStatus(state.vueRoot, status);
    pinUpscaleStatus(node);
    node.setDirtyCanvas?.(true, true);
}

function scheduleUpscalePlan(node) {
    const state = node._ghUpscaleStatus;
    if (!state || state.disposed || state.running) return;
    clearTimeout(state.planTimer);
    const version = ++state.planVersion;
    state.planTimer = setTimeout(async () => {
        const size = upscaleSourceSize(node);
        if (!size) {
            if (node.inputs?.[0]?.link == null || !state.status?.plan) setUpscaleStatus(node, { phase: "待运行" });
            return;
        }
        const output = node.widgets.find((widget) => widget.name === "output_long_edge")?.value;
        const tile = node.widgets.find((widget) => widget.name === "tile_size")?.value;
        const key = `${node.inputs?.[0]?.link}:${size}:${output}:${tile}`;
        if (state.planKey === key) return;
        try {
            const response = await api.fetchApi("/goohai/h3_upscale/plan", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ width: size[0], height: size[1], output_long_edge: output, tile_size: tile }),
            });
            const data = await response.json();
            if (state.disposed || state.running || state.planVersion !== version) return;
            if (!response.ok) throw new Error(data.error || "分块预估失败");
            state.planKey = key;
            setUpscaleStatus(node, { ...data, phase: "待运行" });
        } catch (error) {
            if (!state.disposed && !state.running && state.planVersion === version) {
                state.planKey = null;
                setUpscaleStatus(node, { phase: error.message });
            }
        }
    }, 120);
}

function installUpscaleStatus(node) {
    if (node._ghUpscaleStatus) return;
    const root = document.createElement("div");
    root.style.cssText = "box-sizing:border-box;width:100%;padding:2px 10px 6px;color:var(--input-text,#ddd);font:14px/20px sans-serif;overflow:hidden;pointer-events:none;";
    const vueRoot = root.cloneNode(false);
    vueRoot.style.flex = "0 0 auto";
    const widget = node.addDOMWidget("gh_h3_upscale_status", "gh_h3_upscale_status", root, {
        serialize: false, hideOnZoom: false, margin: 0, getMinHeight: () => 48, getMaxHeight: () => 48,
        surfaces: { canvas: "shown", vueNode: "never", panel: "never" },
    });
    widget.serialize = false;
    widget.options.onDraw = () => root.closest(".dom-widget")?.style.setProperty("pointer-events", "none", "important");
    const prompt = node.widgets.find((item) => item.name === "prompt");
    prompt.options.getMinHeight = () => PROMPT_MIN_HEIGHT;
    prompt.options.getMaxHeight = () => node._ghUpscaleStatus.promptHeight;
    node._ghUpscaleStatus = {
        root, vueRoot, widget, prompt,
        promptHeight: Math.max(PROMPT_MIN_HEIGHT, Number(node.properties.gh_h3_prompt_height) || 96),
        lastNodeHeight: node.size[1],
        running: false, planVersion: 0, compactPending: true,
    };
    upscaleNodes.add(node);
    for (const name of ["output_long_edge", "tile_size"]) {
        const slider = node.widgets.find((item) => item.name === name);
        const callback = slider.callback;
        slider.callback = function () {
            const result = callback?.apply(this, arguments);
            scheduleUpscalePlan(node);
            return result;
        };
    }
    setUpscaleStatus(node, { phase: "待运行" });
    scheduleUpscalePlan(node);
}

app.registerExtension({
    name: "goohaitools.h3_upscale_status",
    addCustomNodeDefs(definitions) {
        for (const name of INTERNAL_NODE_TYPES) delete definitions[name];
    },
    beforeRegisterVueAppNodeDefs(definitions) {
        for (let index = definitions.length - 1; index >= 0; index--) {
            if (INTERNAL_NODE_TYPES.has(definitions[index].name)) definitions.splice(index, 1);
        }
    },
    nodeCreated(node) {
        // Core creates schema widgets after onNodeCreated; nodeCreated runs after them.
        if ((node.comfyClass || node.type) === UPSCALE_TYPE) installUpscaleStatus(node);
    },
    setup() {
        api.addEventListener("goohai_h3_upscale_status", ({ detail }) => {
            for (const node of upscaleNodes) {
                if (String(node.id) !== String(detail.node_id)) continue;
                const state = node._ghUpscaleStatus;
                state.running = detail.phase !== "修复完成";
                state.planVersion++;
                clearTimeout(state.planTimer);
                state.planKey = null;
                state.sourceLink = node.inputs?.[0]?.link;
                state.sourceSize = [detail.source_width, detail.source_height];
                if (!state.running) {
                    const output = node.widgets.find((widget) => widget.name === "output_long_edge")?.value;
                    const tile = node.widgets.find((widget) => widget.name === "tile_size")?.value;
                    state.planKey = `${state.sourceLink}:${state.sourceSize}:${output}:${tile}`;
                }
                setUpscaleStatus(node, detail);
            }
        });
        for (const event of ["execution_error", "execution_interrupted"]) {
            api.addEventListener(event, () => {
                for (const node of upscaleNodes) {
                    if (!node._ghUpscaleStatus.running) continue;
                    node._ghUpscaleStatus.running = false;
                    setUpscaleStatus(node, { ...node._ghUpscaleStatus.status, phase: event === "execution_error" ? "运行失败" : "已中断", total: 0 });
                }
            });
        }
        let frame = null;
        const observer = new MutationObserver(() => {
            if (frame !== null || !upscaleNodes.size) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                for (const node of upscaleNodes) pinUpscaleStatus(node);
            });
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
        document.addEventListener("load", (event) => {
            if (event.target instanceof HTMLImageElement) {
                for (const node of upscaleNodes) scheduleUpscalePlan(node);
            }
        }, true);
        document.addEventListener("pointerdown", (event) => {
            const corner = event.target instanceof Element ? event.target.closest("[data-corner]") : null;
            const nodeId = corner?.closest("[data-node-id]")?.dataset.nodeId;
            for (const node of upscaleNodes) {
                const state = node._ghUpscaleStatus;
                if (String(node.id) === nodeId) {
                    state.manualResize = true;
                    state.resizeHeight = node.size[1];
                }
            }
        }, true);
        document.addEventListener("pointermove", () => {
            if (![...upscaleNodes].some((node) => node._ghUpscaleStatus.manualResize)) return;
            requestAnimationFrame(() => {
                for (const node of upscaleNodes) {
                    if (!node._ghUpscaleStatus.manualResize) continue;
                    resizeUpscalePrompt(node);
                    pinUpscaleStatus(node);
                }
            });
        });
        for (const event of ["pointerup", "pointercancel"]) {
            document.addEventListener(event, () => {
                requestAnimationFrame(() => {
                    for (const node of upscaleNodes) {
                        const state = node._ghUpscaleStatus;
                        if (!state.manualResize && !state.canvasResize) continue;
                        resizeUpscalePrompt(node);
                        state.manualResize = false;
                        state.canvasResize = false;
                    }
                });
            }, true);
        }
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== UPSCALE_TYPE) return;
        const getWidgetOnPos = nodeType.prototype.getWidgetOnPos;
        nodeType.prototype.getWidgetOnPos = function (x, y) {
            // Native resize detection runs only when no widget owns the pointer.
            if (!this.flags.collapsed && this.findResizeDirection(x, y)) return;
            return getWidgetOnPos.apply(this, arguments);
        };
        for (const name of ["onConfigure", "onConnectionsChange"]) {
            const original = nodeType.prototype[name];
            nodeType.prototype[name] = function () {
                const result = original?.apply(this, arguments);
                if (name === "onConfigure" && this._ghUpscaleStatus) {
                    const state = this._ghUpscaleStatus;
                    state.promptHeight = Math.max(PROMPT_MIN_HEIGHT, Number(this.properties.gh_h3_prompt_height) || 96);
                    state.compactPending = true;
                }
                scheduleUpscalePlan(this);
                return result;
            };
        }
        const resized = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            const state = this._ghUpscaleStatus;
            if (state && !state.sizing && app.canvas?.resizing_node === this) {
                if (!state.canvasResize) {
                    state.canvasResize = true;
                    state.resizeHeight = state.lastNodeHeight ?? this.size[1];
                }
                resizeUpscalePrompt(this);
            }
            if (state) state.lastNodeHeight = this.size[1];
            return resized?.apply(this, arguments);
        };
        const foreground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function () {
            const result = foreground?.apply(this, arguments);
            pinUpscaleStatus(this);
            return result;
        };
        const executed = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            const result = executed?.apply(this, arguments);
            const status = message?.gh_h3_upscale?.[0];
            if (status && this._ghUpscaleStatus) {
                const state = this._ghUpscaleStatus;
                state.running = false;
                state.planVersion++;
                clearTimeout(state.planTimer);
                state.sourceLink = this.inputs?.[0]?.link;
                state.sourceSize = [status.source_width, status.source_height];
                const output = this.widgets.find((widget) => widget.name === "output_long_edge")?.value;
                const tile = this.widgets.find((widget) => widget.name === "tile_size")?.value;
                state.planKey = `${state.sourceLink}:${state.sourceSize}:${output}:${tile}`;
                setUpscaleStatus(this, status);
            }
            return result;
        };
        const removed = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            const state = this._ghUpscaleStatus;
            if (state) {
                state.disposed = true;
                clearTimeout(state.planTimer);
                state.vueRoot.remove();
            }
            upscaleNodes.delete(this);
            return removed?.apply(this, arguments);
        };
    },
});
