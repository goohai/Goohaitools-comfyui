import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "goohaitools.any_exists",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "GoohaiAnyExists") return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            originalCreated?.apply(this, arguments);
            this._ghAnyType = "ANY";
            this.size[0] = Math.max(this.size[0] || 0, 210);
            this._ghEnsureTypeWidget?.();
            requestAnimationFrame(() => this._ghSyncAnyType?.());
        };

        nodeType.prototype._ghEnsureTypeWidget = function () {
            let widget = this.widgets?.find((w) => w.name === "gh_input_type");
            if (!widget) {
                this.addWidget("text", "gh_input_type", this.properties?.gh_input_type || "ANY", () => {});
                widget = this.widgets?.find((w) => w.name === "gh_input_type");
            }
            if (widget) {
                widget.type = "hidden";
                widget.hidden = true;
                widget.computeSize = () => [0, 0];
                widget.draw = () => {};
                widget.mouse = () => false;
            }
            this.serialize_widgets = true;
            return widget;
        };

        const originalConnections = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, index, connected, linkInfo) {
            originalConnections?.apply(this, arguments);
            // LiteGraph 触发本事件时，graph.links 可能尚未完成写入。
            requestAnimationFrame(() => this._ghSyncAnyType?.());
        };

        nodeType.prototype._ghSyncAnyType = function () {
            // 旧版脚本曾修改 input.name，刷新后 ComfyUI 会按后端定义再补一个
            // “Any”输入。优先保留已连接的插槽，并移除其余重复插槽。
            const aliases = new Set([
                "Any", "图像", "遮罩", "音频", "视频", "模型", "CLIP", "VAE",
                "字符串", "条件", "Latent", "整数", "浮点", "布尔"
            ]);
            const candidates = (this.inputs || [])
                .map((slot, index) => ({ slot, index }))
                .filter(({ slot }) => aliases.has(slot.name) || aliases.has(slot.label));
            let kept = candidates.find(({ slot }) => slot.link != null) || candidates[0];
            for (let i = candidates.length - 1; i >= 0; i--) {
                const candidate = candidates[i];
                if (kept && candidate.slot !== kept.slot && candidate.slot.link == null) {
                    this.removeInput(candidate.index);
                }
            }
            const input = kept?.slot || this.inputs?.[0];
            let detected = "ANY";
            if (input?.link != null && this.graph?.links) {
                const link = this.graph.links[input.link];
                const origin = link && this.graph.getNodeById(link.origin_id);
                const output = origin?.outputs?.[link.origin_slot];
                if (output?.type && output.type !== "*") detected = String(output.type).toUpperCase();
            }
            this._ghAnyType = detected;
            const labelMap = {
                IMAGE: "图像", MASK: "遮罩", AUDIO: "音频", VIDEO: "视频",
                MODEL: "模型", CLIP: "CLIP", VAE: "VAE", STRING: "字符串",
                CONDITIONING: "条件", LATENT: "Latent", INT: "整数", FLOAT: "浮点",
                BOOLEAN: "布尔", ANY: "Any"
            };
            const label = labelMap[detected] || detected;
            if (input) {
                input.type = detected === "ANY" ? "*" : detected;
                input.name = "Any";
                input.label = label;
            }
            if (this.outputs) {
                const anyOutput = this.outputs[0];
                if (anyOutput) {
                    anyOutput.type = detected === "ANY" ? "*" : detected;
                    anyOutput.name = "Any";
                    anyOutput.label = label;
                }
            }
            const widget = this._ghEnsureTypeWidget?.();
            if (widget) widget.value = detected;
            this.properties = this.properties || {};
            this.properties.gh_input_type = detected;
            this.size[0] = Math.max(this.size[0] || 0, 210);
            this.setDirtyCanvas?.(true, true);
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            originalConfigure?.apply(this, arguments);
            this._ghEnsureTypeWidget?.();
            requestAnimationFrame(() => this._ghSyncAnyType?.());
        };
    },
});
