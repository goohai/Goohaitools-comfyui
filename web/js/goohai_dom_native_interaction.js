import { app } from "/scripts/app.js";

let spacePressed = false;

const isEditableTarget = (target) => target instanceof HTMLElement && (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement
);

window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !isEditableTarget(event.target)) spacePressed = true;
}, true);
window.addEventListener("keyup", (event) => {
    if (event.code !== "Space") return;
    const wasPressed = spacePressed;
    spacePressed = false;
    const canvas = app.canvas?.canvas;
    if (wasPressed && app.canvas?.read_only && canvas && event.target !== canvas) {
        canvas.dispatchEvent(new KeyboardEvent("keyup", {
            key: " ",
            code: "Space",
            bubbles: true,
            cancelable: true,
        }));
    }
}, true);
window.addEventListener("blur", () => { spacePressed = false; });

const pointerInit = (event) => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary,
    width: event.width,
    height: event.height,
    pressure: event.pressure,
    tangentialPressure: event.tangentialPressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    twist: event.twist,
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

const sendPointerToNative = (root, type, source, widget, nodeDrag) => {
    const vueNode = root.closest(".lg-node");
    const target = vueNode || app.canvas?.canvas;
    if (!target) return;

    const wasHidden = widget?.hidden;
    if (!vueNode && nodeDrag && type === "pointerdown" && widget) widget.hidden = true;
    try {
        target.dispatchEvent(new PointerEvent(type, pointerInit(source)));
    } finally {
        if (!vueNode && nodeDrag && type === "pointerdown" && widget) widget.hidden = wasHidden;
    }
};

const ensureNativeSpaceMode = (event) => {
    if (app.canvas?.read_only || !app.canvas?.canvas) return;
    app.canvas.canvas.dispatchEvent(new KeyboardEvent("keydown", {
        key: " ",
        code: "Space",
        bubbles: true,
        cancelable: true,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
    }));
};

export function installNativeNodePointerBridge(root, {
    getWidget = () => null,
    shouldForwardLeft = () => false,
    onTap = null,
    forwardWheel = true,
} = {}) {
    let active = null;

    if (forwardWheel) {
        root.addEventListener("wheel", (event) => {
            if (!app.canvas?.processMouseWheel) return;
            event.preventDefault();
            event.stopPropagation();
            app.canvas.processMouseWheel(event);
        }, { capture: true, passive: false });
    }

    root.addEventListener("pointerdown", (event) => {
        const middle = event.button === 1;
        const spaceLeft = event.button === 0 && (spacePressed || app.canvas?.read_only);
        const nodeLeft = event.button === 0 && !spaceLeft && shouldForwardLeft(event);
        if (!middle && !spaceLeft && !nodeLeft) return;

        active = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            down: pointerInit(event),
            middle,
            spaceLeft,
            nodeLeft,
            started: middle || spaceLeft,
            moved: false,
        };

        if (spaceLeft) ensureNativeSpaceMode(event);
        if (active.started) {
            try { root.setPointerCapture?.(event.pointerId); } catch (_) {}
            sendPointerToNative(root, "pointerdown", active.down, getWidget(), false);
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
        }

        // 普通左键先保留给 DOM 组件；只有移动达到阈值后才接管为节点拖动。
        event.stopPropagation();
    }, true);

    root.addEventListener("pointermove", (event) => {
        if (!active || event.pointerId !== active.pointerId) return;

        const dx = event.clientX - active.startX;
        const dy = event.clientY - active.startY;
        if (!active.moved && dx * dx + dy * dy > 9) active.moved = true;

        if (active.nodeLeft && active.moved && !active.started) {
            active.started = true;
            try { root.setPointerCapture?.(event.pointerId); } catch (_) {}
            sendPointerToNative(root, "pointerdown", active.down, getWidget(), true);
        }
        if (active.started) sendPointerToNative(root, "pointermove", event, getWidget(), false);

        if (active.started) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        }
    }, true);

    const finish = (event) => {
        if (!active || event.pointerId !== active.pointerId) return;
        const state = active;
        active = null;

        if (state.started) {
            sendPointerToNative(root, "pointerup", event, getWidget(), false);
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        } else if (state.nodeLeft && !state.moved) {
            onTap?.(event);
        }

        if (state.started) {
            try { root.releasePointerCapture?.(event.pointerId); } catch (_) {}
        }
    };

    root.addEventListener("pointerup", finish, true);
    root.addEventListener("pointercancel", finish, true);
}
