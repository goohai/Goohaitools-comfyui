import { app } from "../../../scripts/app.js";

const MAX_IMAGES = 10;
const NODE_NAME = "QwenImagePromptOptimizer";
const PROMPT_HEIGHT_PROPERTY = "qwen_prompt_height";
const MIN_PROMPT_HEIGHT = 64;
const SEED_WIDGET_NAMES = new Set(["种子值", "seed"]);
const SEED_MODE_WIDGET_NAMES = new Set(["种子模式", "seed_mode"]);
const LAST_SEED_MODE_PROPERTY = "goohai_last_executed_seed_mode";
const imageName = (index) => `图像_${String(index + 1).padStart(2, "0")}`;
const isImageInput = (slot) => {
    const name = String(slot?.name || "");
    return name.startsWith("图像_") || name.startsWith("image_");
};

function connected(slot) {
    return slot?.link != null;
}

function promptWidget(node) {
    return node.widgets?.find((item) => item.name === "用户提示词" || item.name === "user_prompt");
}

function updateSeedWidget(node, seed) {
    const widget = node.widgets?.find((item) => SEED_WIDGET_NAMES.has(item.name));
    if (!widget || !Number.isFinite(Number(seed))) return;
    widget.value = Number(seed);
    widget.callback?.(widget.value);
}

function widgetValue(node, names) {
    return node.widgets?.find((item) => names.has(item.name))?.value;
}

function nextRandomSeed() {
    if (globalThis.crypto?.getRandomValues) {
        const value = new Uint32Array(1);
        globalThis.crypto.getRandomValues(value);
        return Number(value[0]) || 1;
    }
    return (Math.floor(Math.random() * 0xFFFFFFFF) + 1) >>> 0;
}

function prepareRuntimeSeeds() {
    const nodes = app.graph?._nodes || app.graph?._nodes_by_id && Object.values(app.graph._nodes_by_id) || [];
    for (const node of nodes) {
        if (node?.comfyClass !== NODE_NAME && node?.type !== NODE_NAME) continue;
        const mode = widgetValue(node, SEED_MODE_WIDGET_NAMES);
        if (mode === "随机") updateSeedWidget(node, nextRandomSeed());
    }
}

function prepareRuntimeSeedModes() {
    const nodes = app.graph?._nodes || app.graph?._nodes_by_id && Object.values(app.graph._nodes_by_id) || [];
    const restores = [];
    for (const node of nodes) {
        if (node?.comfyClass !== NODE_NAME && node?.type !== NODE_NAME) continue;
        const widget = node.widgets?.find((item) => SEED_MODE_WIDGET_NAMES.has(item.name));
        if (!widget) continue;
        const selectedMode = widget.value;
        const lastExecutedMode = node._goohaiLastExecutedSeedMode
            || node.properties?.[LAST_SEED_MODE_PROPERTY];
        const queuedMode = selectedMode === "固定"
            && lastExecutedMode === "随机"
            ? "随机"
            : selectedMode;
        node._goohaiQueuedSeedMode = selectedMode;
        if (queuedMode !== selectedMode) {
            widget.value = queuedMode;
            restores.push(() => { widget.value = selectedMode; });
        }
    }
    return restores;
}

function installQueueSeedHook() {
    if (app._goohaiQwenRuntimeSeedHook) return;
    if (typeof app.queuePrompt !== "function") {
        setTimeout(installQueueSeedHook, 250);
        return;
    }
    const originalQueuePrompt = app.queuePrompt;
    app.queuePrompt = async function () {
        prepareRuntimeSeeds();
        const restores = prepareRuntimeSeedModes();
        try {
            return await originalQueuePrompt.apply(this, arguments);
        } finally {
            for (const restore of restores.reverse()) restore();
        }
    };
    app._goohaiQwenRuntimeSeedHook = true;
}

function asPromptHeight(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(MIN_PROMPT_HEIGHT, Math.round(number)) : fallback;
}

function measurePromptLayout(node, widget) {
    const originalWidgetComputeSize = node._qwenOriginalWidgetComputeSize || widget.computeSize;
    const originalNodeComputeSize = node._qwenOriginalNodeComputeSize || node.computeSize;
    if (typeof originalWidgetComputeSize !== "function" || typeof originalNodeComputeSize !== "function") {
        return null;
    }

    const currentComputeSize = widget.computeSize;
    widget.computeSize = originalWidgetComputeSize;
    const naturalWidgetSize = originalWidgetComputeSize.call(widget, node.size?.[0]) || [0, 160];
    const naturalNodeSize = originalNodeComputeSize.call(node) || [0, 0];
    widget.computeSize = currentComputeSize;

    const naturalPromptHeight = Math.max(MIN_PROMPT_HEIGHT, Math.round(Number(naturalWidgetSize[1] || 160)));
    const fixedNodeHeight = Math.max(0, Math.round(Number(naturalNodeSize[1] || 0) - naturalPromptHeight));
    return { originalWidgetComputeSize, originalNodeComputeSize, naturalPromptHeight, fixedNodeHeight };
}

function applyPromptLayout(node, forceSize = false) {
    const widget = promptWidget(node);
    if (!widget) return;

    if (!node._qwenOriginalWidgetComputeSize) node._qwenOriginalWidgetComputeSize = widget.computeSize;
    if (!node._qwenOriginalNodeComputeSize) node._qwenOriginalNodeComputeSize = node.computeSize;
    const layout = measurePromptLayout(node, widget);
    if (!layout) return;

    const hadSavedHeight = node.properties && Object.prototype.hasOwnProperty.call(node.properties, PROMPT_HEIGHT_PROPERTY);
    const initialHeight = Math.max(MIN_PROMPT_HEIGHT, Math.round(layout.naturalPromptHeight * 0.5));
    const savedHeight = hadSavedHeight
        ? asPromptHeight(node.properties[PROMPT_HEIGHT_PROPERTY], initialHeight)
        : initialHeight;

    node.properties = node.properties || {};
    node.properties[PROMPT_HEIGHT_PROPERTY] = savedHeight;
    node._qwenPromptFixedNodeHeight = layout.fixedNodeHeight;
    node._qwenPromptHeight = savedHeight;
    node._qwenPromptReady = false;
    widget.computeSize = () => [0, node._qwenPromptHeight];

    const expectedHeight = layout.fixedNodeHeight + savedHeight;
    if (forceSize || !Array.isArray(node.size) || Math.abs(Number(node.size[1]) - expectedHeight) > 1) {
        node._qwenPromptInternalResize = true;
        node.setSize?.([Math.max(1, Number(node.size?.[0]) || 1), expectedHeight]);
        node._qwenPromptInternalResize = false;
    }
    node._qwenPromptReady = true;
    node.setDirtyCanvas?.(true, true);
}

function updatePromptHeightFromNodeSize(node, size) {
    if (!node._qwenPromptReady || node._qwenPromptInternalResize) return;
    const totalHeight = Number(size?.[1] ?? node.size?.[1]);
    const fixedHeight = Number(node._qwenPromptFixedNodeHeight);
    if (!Number.isFinite(totalHeight) || !Number.isFinite(fixedHeight)) return;
    const nextHeight = asPromptHeight(totalHeight - fixedHeight, node._qwenPromptHeight || MIN_PROMPT_HEIGHT);
    if (Math.abs(nextHeight - node._qwenPromptHeight) <= 1) return;
    node._qwenPromptHeight = nextHeight;
    node.properties = node.properties || {};
    node.properties[PROMPT_HEIGHT_PROPERTY] = nextHeight;
    node.setDirtyCanvas?.(true, true);
}

function sync(node) {
    let inputs = node.inputs || [];
    let imageIndexes = inputs
        .map((slot, index) => ({ slot, index }))
        .filter(({ slot }) => isImageInput(slot));
    if (!imageIndexes.length) {
        node.addInput(imageName(0), "IMAGE");
        imageIndexes = [{ slot: node.inputs[node.inputs.length - 1], index: node.inputs.length - 1 }];
    }
    let lastConnected = -1;
    imageIndexes.forEach(({ slot }, imageIndex) => {
        if (connected(slot)) lastConnected = Math.max(lastConnected, imageIndex);
    });
    const target = Math.min(MAX_IMAGES, Math.max(1, lastConnected + 2));
    while (imageIndexes.length > target) {
        const last = imageIndexes[imageIndexes.length - 1];
        if (connected(last.slot)) break;
        node.removeInput(last.index);
        imageIndexes = (node.inputs || [])
            .map((slot, index) => ({ slot, index }))
            .filter(({ slot }) => isImageInput(slot));
    }
    while (imageIndexes.length < target) {
        node.addInput(imageName(imageIndexes.length), "IMAGE");
        imageIndexes = (node.inputs || [])
            .map((slot, index) => ({ slot, index }))
            .filter(({ slot }) => isImageInput(slot));
    }
    const slots = node.inputs || [];
    let number = 0;
    for (const slot of slots) {
        if (!isImageInput(slot)) continue;
        slot.name = imageName(number);
        slot.label = `图像 ${number + 1}`;
        number += 1;
    }
    node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "goohaitools.qwen_image_prompt_optimizer",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_NAME) return;
        installQueueSeedHook();
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated?.apply(this, arguments);
            this._qwenImageSyncQueued = false;
            this._qwenImageScheduleSync = () => {
                if (this._qwenImageSyncQueued) return;
                this._qwenImageSyncQueued = true;
                requestAnimationFrame(() => {
                    this._qwenImageSyncQueued = false;
                    sync(this);
                });
            };
            this._qwenImageScheduleSync();
            requestAnimationFrame(() => applyPromptLayout(this, false));
        };
        const originalResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            originalResize?.apply(this, arguments);
            updatePromptHeightFromNodeSize(this, arguments[0]);
        };
        const originalConnections = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function () {
            originalConnections?.apply(this, arguments);
            this._qwenImageScheduleSync?.();
            requestAnimationFrame(() => applyPromptLayout(this, false));
        };
        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            originalConfigure?.apply(this, arguments);
            this._qwenImageScheduleSync?.();
            requestAnimationFrame(() => applyPromptLayout(this, true));
        };
        const originalExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            originalExecuted?.apply(this, arguments);
            const seed = Array.isArray(message?.seed) ? message.seed[0] : message?.seed;
            updateSeedWidget(this, seed);
            if (this._goohaiQueuedSeedMode) {
                this._goohaiLastExecutedSeedMode = this._goohaiQueuedSeedMode;
                this.properties = this.properties || {};
                this.properties[LAST_SEED_MODE_PROPERTY] = this._goohaiQueuedSeedMode;
            }
        };
    },
});
