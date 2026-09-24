import { app } from "../../../scripts/app.js";

const NODE_NAME = "TextEncodeQwenImage21GH";
const MAX_IMAGES = 10;
const imageName = (index) => `image_${String(index + 1).padStart(2, "0")}`;

const isImageInput = (slot) => /^image_\d+$/.test(String(slot?.name || ""));
const connected = (slot) => slot?.link != null;

function imageInputs(node) {
    return (node.inputs || [])
        .map((slot, index) => ({ slot, index }))
        .filter(({ slot }) => isImageInput(slot));
}

function syncImageInputs(node) {
    let inputs = imageInputs(node);

    while (inputs.length > MAX_IMAGES) {
        const last = inputs[inputs.length - 1];
        node.removeInput(last.index);
        inputs = imageInputs(node);
    }

    if (!inputs.length) {
        node.addInput(imageName(0), "IMAGE");
        inputs = imageInputs(node);
    }

    let lastConnected = -1;
    inputs.forEach(({ slot }, index) => {
        if (connected(slot)) lastConnected = index;
    });
    const targetCount = Math.min(MAX_IMAGES, Math.max(1, lastConnected + 2));

    while (inputs.length > targetCount) {
        const last = inputs[inputs.length - 1];
        if (connected(last.slot)) break;
        node.removeInput(last.index);
        inputs = imageInputs(node);
    }
    while (inputs.length < targetCount) {
        node.addInput(imageName(inputs.length), "IMAGE");
        inputs = imageInputs(node);
    }

    inputs.forEach(({ slot }, index) => {
        slot.label = `参考图 ${index + 1}`;
        slot.type = "IMAGE";
    });
    node.setDirtyCanvas?.(true, true);
}

function scheduleSync(node) {
    if (node._ghQwen21SyncPending) return;
    node._ghQwen21SyncPending = true;
    requestAnimationFrame(() => {
        node._ghQwen21SyncPending = false;
        syncImageInputs(node);
    });
}

app.registerExtension({
    name: "goohaitools.text_encode_qwen_image_21_gh",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_NAME) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated?.apply(this, arguments);
            scheduleSync(this);
        };

        const originalConnections = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function () {
            originalConnections?.apply(this, arguments);
            scheduleSync(this);
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            originalConfigure?.apply(this, arguments);
            scheduleSync(this);
        };
    },
});
