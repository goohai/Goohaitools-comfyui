import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "goohaitools.ignore_groups",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "忽略多组孤海") return;

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            /* ── 首次创建 / 重置时设置默认颜色 ── */
            if (!this.color)   this.color   = "#4E464A";
            if (!this.bgcolor) this.bgcolor = "#4E464A";
            this.size = [400, this.size[1]];
            buildIgnoreGroupsUI(this);
        };

        const origConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            origConfigure?.apply(this, arguments);
            if (this._guhaiSyncGroups) this._guhaiSyncGroups();
        };

        /* 右键上下文菜单  */
        const origGetExtra = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
            if (origGetExtra) origGetExtra.apply(this, arguments);
            options.unshift({
                content: "🎮  忽略多组_孤海 设置",
                callback: () => {
                    if (this._guhaiShowSettings) {
                        this._guhaiShowSettings(
                            Math.round(innerWidth  / 2 - 130),
                            Math.round(innerHeight / 2 - 200)
                        );
                    }
                }
            });
        };
    },
});


function buildIgnoreGroupsUI(node) {

    /* ═══════════════════ 状态 ═══════════════════ */
    let filter    = "";
    let mode      = "default";
    let active    = null;
    let activeSet = null;
    let nameColor = null;
    let igDisable = false;
    let selfChanging = false;
    let dirty         = true;
    let sortOrder     = "position";
    let colorFilter   = "none";
    let prevVisibleTitles = new Set();   

    if (node.properties) {
        if (node.properties.guhai_ig_filter     != null) filter    = node.properties.guhai_ig_filter;
        if (node.properties.guhai_ig_mode       != null) mode      = node.properties.guhai_ig_mode;
        if (node.properties.guhai_ig_active     != null) active    = node.properties.guhai_ig_active;
        if (node.properties.guhai_ig_active_set != null) activeSet = node.properties.guhai_ig_active_set;
        if (node.properties.guhai_ig_name_color != null) nameColor = node.properties.guhai_ig_name_color;
        if (node.properties.guhai_ig_disable    != null) igDisable = !!node.properties.guhai_ig_disable;
        if (node.properties.guhai_ig_sort_order  != null) sortOrder   = node.properties.guhai_ig_sort_order;
        if (node.properties.guhai_ig_color_filter!= null) colorFilter = node.properties.guhai_ig_color_filter;
    }

    function save() {
        node.properties = node.properties || {};
        node.properties.guhai_ig_filter      = filter;
        node.properties.guhai_ig_mode        = mode;
        node.properties.guhai_ig_active      = active;
        node.properties.guhai_ig_active_set  = activeSet;
        node.properties.guhai_ig_name_color  = nameColor;
        node.properties.guhai_ig_disable     = igDisable;
        node.properties.guhai_ig_sort_order  = sortOrder;
        node.properties.guhai_ig_color_filter = colorFilter;
    }


    /* ═══════════════════ Canvas 布局常量 ═══════════════════ */
    const HEADER_H  = 14;
    const ROW_H     = 34;
    const ROW_GAP   = 15;
    const PAD_X     = 16;
    const ROW_PAD_L = 26;
    const ROW_PAD_R = 16;
    const TOGGLE_W  = 67;
    const TOGGLE_H  = 26;
    const KNOB_R    = 11;


    /* ═══════════════════ 几何工具 ═══════════════════ */
    function gBounds(g) {
        if (g._bounding) return [...g._bounding];
        if (g.bounding)  return [...g.bounding];
        const p = g.pos || [0, 0], s = g.size || [0, 0];
        return [p[0], p[1], s[0], s[1]];
    }

    function getGroupColor(g) {
        if (g.color) {
            let c = g.color;
            if (typeof c === "number") {
                return "#" + c.toString(16).padStart(6, "0");
            }
            if (typeof c === "string" && c.startsWith("#") && (c.length === 4 || c.length === 7)) {
                if (c.length === 4) {
                    return "#" + c[1]+c[1] + c[2]+c[2] + c[3]+c[3];
                }
                return c;
            }
        }
        return "";
    }

    function nBounds(n) {
        const p = n.pos || [0, 0];
        const s = n.size || [100, 60];

        if (n.collapsed || n._collapsed) {
            const titleH = (typeof LiteGraph !== "undefined" && LiteGraph.NODE_TITLE_HEIGHT) || 30;

            let collapsedW = n._collapsed_width;
            if (!collapsedW || collapsedW <= 0) {
                const title = (typeof n.getTitle === "function" ? n.getTitle() : n.title) || "";
                collapsedW = Math.max(80, title.length * 7 + 50);
            }

            return [p[0], p[1], collapsedW, titleH];
        }

        return [p[0], p[1], s[0], s[1]];
    }

    function hit(a, b) {
        return !(a[0] + a[2] <= b[0] || a[0] >= b[0] + b[2] ||
                 a[1] + a[3] <= b[1] || a[1] >= b[1] + b[3]);
    }

    function inside(inner, outer) {
        return inner[0] >= outer[0] && inner[1] >= outer[1] &&
               inner[0] + inner[2] <= outer[0] + outer[2] &&
               inner[1] + inner[3] <= outer[1] + outer[3];
    }


    /* ═══════════════════ 组数据 ═══════════════════ */
    function rawGroups() {
        const g = app.graph;
        if (!g || !g._groups) return [];
        return g._groups.map(gr => {
            const color = getGroupColor(gr);
            return {
                title:  (gr.title || "").trim() || "Unnamed",
                bounds: gBounds(gr),
                ref:    gr,
                color:  color,
            };
        });
    }

    function visible() {
        let list = rawGroups();
        /* 自动屏蔽空内容的组：过滤掉内部无任何节点的组 */
        list = list.filter(g => collectNodes(g).length > 0);
        if (filter.trim()) {
            const kw = filter.trim().toLowerCase();
            list = list.filter(g => g.title.toLowerCase().includes(kw));
        }
        if (colorFilter && colorFilter !== "none") {
            list = list.filter(g => {
                if (colorFilter === "__transparent__") {
                    return !g.color;
                }
                return g.color && g.color.toLowerCase() === colorFilter.toLowerCase();
            });
        }
        if (sortOrder === "position") {
            list.sort((a, b) => {
                const ax = a.bounds[0], ay = a.bounds[1];
                const bx = b.bounds[0], by = b.bounds[1];
                if (ay !== by) return ay - by;
                return ax - bx;
            });
        } else {
            list.sort((a, b) =>
                a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
            );
        }
        return list;
    }

    function collectNodes(grp) {
        const g = app.graph;
        if (!g || !g._nodes) return [];
        const all  = rawGroups();
        const pb   = grp.bounds;
        const rects = [pb];
        all.forEach(ag => {
            if (ag.ref !== grp.ref && inside(ag.bounds, pb)) {
                rects.push(ag.bounds);
            }
        });
        return g._nodes.filter(n => {
            const nb = nBounds(n);
            return rects.some(r => hit(nb, r));
        });
    }


    /* 递归获取所有完全嵌套的子组 */
    function getAllNestedGroups(parentGroup) {
        const all = rawGroups();
        const result = [];
        const visited = new Set();
        visited.add(parentGroup.ref);

        function findNested(parent) {
            all.forEach(ag => {
                if (!visited.has(ag.ref) && inside(ag.bounds, parent.bounds)) {
                    visited.add(ag.ref);
                    result.push(ag);
                    findNested(ag);
                }
            });
        }

        findNested(parentGroup);
        return result;
    }


    /* ═══════════════════ 旁路 / 恢复 ═══════════════════ */
    function bypassGroup(grp) {
        collectNodes(grp).forEach(n => {
            if (igDisable) {
                n.mode = 2;
            } else {
                n.mode = 4;
            }
        });
    }

    function restoreGroup(grp) {
        collectNodes(grp).forEach(n => {
            n.mode = 0;
            if (n.flags) n.flags.disabled = false;
        });
    }

    function isNodeActive(n) {
        return n.mode !== 4 && n.mode !== 2 && !n.flags?.disabled;
    }


    /* ═══════════════════ 组状态检测与外部同步 ═══════════════════ */


    function getGroupState(grp) {
        const nodes = collectNodes(grp);
        if (nodes.length === 0) return true;
        const allActive   = nodes.every(n => isNodeActive(n));
        const allInactive = nodes.every(n => !isNodeActive(n));
        if (allActive)   return true;
        if (allInactive) return false;
        return null;
    }

    function computeStateSig(list) {
        return list.map(g => {
            const s = getGroupState(g);
            return g.title + ":" + (s === true ? "1" : s === false ? "0" : "m");
        }).join("\x00");
    }

    function syncExternalState() {

        const list = rawGroups();
        let changed = false;

        if (mode === "default") {
            if (!Array.isArray(activeSet)) return;
            list.forEach(g => {
                const gs = getGroupState(g);
                const isActive = activeSet.includes(g.title);
                if (gs === true && !isActive) {
                    activeSet.push(g.title);
                    changed = true;
                } else if (gs === false && isActive) {
                    activeSet = activeSet.filter(t => t !== g.title);
                    changed = true;
                }
            });
        } else if (mode === "at_most_one") {
            if (active) {
                const grp = list.find(g => g.title === active);
                if (grp && getGroupState(grp) === false) {
                    active = null;
                    changed = true;
                }
            }
        }

        if (changed) save();
    }


    /* ═══════════════════ Canvas 绘图辅助 ═══════════════════ */

    function rrect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function ellipsis(ctx, text, maxW) {
        if (ctx.measureText(text).width <= maxW) return text;
        let t = text;
        while (t.length > 1 && ctx.measureText(t + "…").width > maxW) {
            t = t.slice(0, -1);
        }
        return t + "…";
    }

    function hexToRgba(hex, alpha) {
        if (!hex || hex.length < 7) return `rgba(120,120,120,${alpha})`;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    function drawGear(ctx, cx, cy, r) {
        const teeth  = 8;
        const outerR = r;
        const innerR = r * 0.65;
        const holeR  = r * 0.3;
        const step   = (Math.PI * 2) / teeth;
        const q      = step * 0.25;

        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < teeth; i++) {
            const a = i * step - Math.PI / 2;
            if (i === 0) {
                ctx.moveTo(cx + outerR * Math.cos(a - q), cy + outerR * Math.sin(a - q));
            } else {
                ctx.lineTo(cx + outerR * Math.cos(a - q), cy + outerR * Math.sin(a - q));
            }
            ctx.lineTo(cx + outerR * Math.cos(a + q), cy + outerR * Math.sin(a + q));
            const va = a + step / 2;
            ctx.lineTo(cx + innerR * Math.cos(va - q), cy + innerR * Math.sin(va - q));
            ctx.lineTo(cx + innerR * Math.cos(va + q), cy + innerR * Math.sin(va + q));
        }
        ctx.closePath();
        ctx.fillStyle = "rgba(120,120,120,0.15)";
        ctx.fill();
        ctx.strokeStyle = "rgba(120,120,120,0.4)";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, holeR, 0, Math.PI * 2);
        ctx.fillStyle = "#2a2a2a";
        ctx.fill();
        ctx.strokeStyle = "rgba(153,153,153,0.6)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }


    /* ═══════════════════ 核心刷新 ═══════════════════ */
    let lastSig = "";
    let lastStateSig = "";

    function refresh(forceApply) {
        const list = visible();
        const currentVisibleTitles = new Set(list.map(g => g.title));
        const sig  = list.map(g => g.title).join("\x00");
        const listChanged = (sig !== lastSig);
        lastSig = sig;

        let stateChanged = false;

        if (mode === "default") {
            if (!Array.isArray(activeSet)) {
                activeSet = [];

                rawGroups().forEach(g => {
                    const gs = getGroupState(g);
                    if (gs !== false) {
                        activeSet.push(g.title);
                    }
                });
                stateChanged = true;
            } else {
 
                const allTitles = new Set(rawGroups().map(g => g.title));
                const before = activeSet.length;
                activeSet = activeSet.filter(t => allTitles.has(t));
                if (activeSet.length !== before) stateChanged = true;


                if (listChanged) {
                    list.forEach(g => {
                        if (!prevVisibleTitles.has(g.title)) {
                            const gs = getGroupState(g);
                            const idx = activeSet.indexOf(g.title);
                            if (gs === true && idx < 0) {
                                activeSet.push(g.title);
                                stateChanged = true;
                            } else if (gs === false && idx >= 0) {
                                activeSet.splice(idx, 1);
                                stateChanged = true;
                            }

                        }
                    });
                }
            }
        } else {
  
            const allGroupsList = rawGroups();
            if (active && !allGroupsList.find(g => g.title === active)) {
                active = (mode === "always_one" && allGroupsList.length) ? allGroupsList[0].title : null;
                stateChanged = true;
            }
            if (mode === "always_one" && !active && allGroupsList.length) {
                active = allGroupsList[0].title;
                stateChanged = true;
            }
        }

        if (stateChanged) save();

        if (forceApply || stateChanged || listChanged) {
            selfChanging = true;
            try {
                list.forEach(g => {
                    let isOn;
                    if (mode === "default") {
                        isOn = activeSet.includes(g.title);
                    } else {
                        isOn = (g.title === active);
                    }
                    if (isOn) restoreGroup(g);
                    else      bypassGroup(g);
                });
                try { app.graph.change(); } catch (_) { /* ignore */ }
            } finally {
                selfChanging = false;
            }
        }


        prevVisibleTitles = currentVisibleTitles;
    }


    /* ═══════════════════ 切换逻辑 ═══════════════════ */
    function handleToggle(title) {
        if (mode === "default") {
            if (!Array.isArray(activeSet)) activeSet = [];

            const list = visible();
            const grp  = list.find(g => g.title === title);
            const idx  = activeSet.indexOf(title);
            const turnOn = idx < 0;

            if (turnOn) {
                if (!activeSet.includes(title)) activeSet.push(title);
                if (grp) {
                    getAllNestedGroups(grp).forEach(ng => {
                        if (!activeSet.includes(ng.title)) activeSet.push(ng.title);
                    });
                }
            } else {
                const offSet = new Set();
                offSet.add(title);
                if (grp) {
                    getAllNestedGroups(grp).forEach(ng => offSet.add(ng.title));
                }
                activeSet = activeSet.filter(t => !offSet.has(t));
            }
        } else if (mode === "always_one") {
            if (active === title) return;
            active = title;
        } else {
            if (active === title) {
                active = null;
            } else {
                active = title;
            }
        }
        save();
        refresh(true);
    }


    /* ═══════════════════ 选项设置═══════════════════ */

    /* 跟踪当前弹窗的清理函数，确保重复打开时先关闭旧的 */
    let _settingsCleanup = null;

    function showSettings(x, y) {
        /* 清理上一次弹窗（如果仍存在） */
        if (_settingsCleanup) { _settingsCleanup(); _settingsCleanup = null; }

        /* ── 全屏透明遮罩── */
        const overlay = document.createElement("div");
        overlay.id = "guhai_ig_overlay";
        Object.assign(overlay.style, {
            position: "fixed",
            inset: "0",
            zIndex: "99998",
            background: "transparent",
            cursor: "default",
        });
        document.body.appendChild(overlay);

        const pop = document.createElement("div");
        pop.id = "guhai_ig_pop";
        Object.assign(pop.style, {
            position: "fixed",
            left: Math.min(x, innerWidth  - 280) + "px",
            top:  Math.min(y, innerHeight - 560) + "px",
            background: "#2a2a2a",
            border: "1px solid #555",
            borderRadius: "8px",
            padding: "14px 18px",
            zIndex: "99999",
            minWidth: "250px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
            color: "#e0e0e0",
            fontFamily: "inherit",
        });

        /* ── 统一关闭函数 ── */
        function closePopup() {
            if (overlay.parentNode) overlay.remove();
            if (pop.parentNode)     pop.remove();
            document.removeEventListener("keydown", onEsc);
            document.removeEventListener("mousedown", closeColorPanel);
            _settingsCleanup = null;
        }

        _settingsCleanup = closePopup;

        /* 遮罩层点击 → 关闭 */
        overlay.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closePopup();
        });

        /* Escape 键 → 关闭 */
        function onEsc(e) {
            if (e.key === "Escape") closePopup();
        }
        document.addEventListener("keydown", onEsc);


        /* ── 实时应用函数 ── */
        function applyAll() {
            filter      = fInput.value;
            colorFilter = cFilter;
            nameColor   = cInput.value || null;
            igDisable   = dRadioDisable.checked;
            sortOrder   = sSelect.value;

            const newMode = mSelect.value;

            if (newMode !== mode) {
                if (newMode === "default") {
                    activeSet = visible().map(g => g.title);
                } else if (newMode === "always_one") {
                    const list = visible();
                    if (activeSet && activeSet.length) {
                        active = activeSet[0];
                    } else if (list.length) {
                        active = list[0].title;
                    } else {
                        active = null;
                    }
                    activeSet = null;
                } else {
                    const list = visible();
                    if (activeSet && activeSet.length) {
                        active = activeSet[0];
                    } else if (mode === "always_one" && active) {
                        /* keep */
                    } else {
                        active = null;
                    }
                    activeSet = null;
                }
                mode = newMode;
            } else {
                mode = newMode;
                if (mode === "always_one" && !active) {
                    const list = visible();
                    if (list.length) active = list[0].title;
                }
            }

            save();
            refresh(true);
        }

        /* ── 标题 ── */
        const titleEl = document.createElement("div");
        titleEl.textContent = "🎮  忽略多组_孤海 设置";
        Object.assign(titleEl.style, {
            fontSize: "15px", fontWeight: "bold", marginBottom: "14px",
            color: "#e0e0e0",
            borderBottom: "1px solid #444", paddingBottom: "8px",
        });
        pop.appendChild(titleEl);

        /* ── 关闭方式（绕过 / 禁用）── */
        const dLabel = document.createElement("div");
        dLabel.textContent = "路由控制";
        Object.assign(dLabel.style, {
            fontSize: "13px", fontWeight: "bold", marginBottom: "6px",
        });
        pop.appendChild(dLabel);

        const dRow = document.createElement("div");
        Object.assign(dRow.style, {
            display: "flex", alignItems: "center", gap: "20px",
            marginBottom: "14px",
        });

        const dRadioBypass = document.createElement("input");
        dRadioBypass.type = "radio";
        dRadioBypass.name = "guhai_ig_close_mode";
        dRadioBypass.value = "bypass";
        dRadioBypass.checked = !igDisable;
        dRadioBypass.style.cursor = "pointer";

        const dLblBypass = document.createElement("label");
        dLblBypass.style.cursor = "pointer";
        dLblBypass.style.fontSize = "13px";
        dLblBypass.appendChild(dRadioBypass);
        dLblBypass.appendChild(document.createTextNode(" 绕过（ctrl+b）"));

        const dRadioDisable = document.createElement("input");
        dRadioDisable.type = "radio";
        dRadioDisable.name = "guhai_ig_close_mode";
        dRadioDisable.value = "disable";
        dRadioDisable.checked = !!igDisable;
        dRadioDisable.style.cursor = "pointer";

        const dLblDisable = document.createElement("label");
        dLblDisable.style.cursor = "pointer";
        dLblDisable.style.fontSize = "13px";
        dLblDisable.appendChild(dRadioDisable);
        dLblDisable.appendChild(document.createTextNode(" 禁用（ctrl+m）"));

        dRow.appendChild(dLblBypass);
        dRow.appendChild(dLblDisable);
        pop.appendChild(dRow);

        dRadioBypass.addEventListener("change", applyAll);
        dRadioDisable.addEventListener("change", applyAll);

        /* ── 关键词筛选 ── */
        const fLabel = document.createElement("div");
        fLabel.textContent = "关键词筛选";
        Object.assign(fLabel.style, {
            fontSize: "13px", fontWeight: "bold", marginBottom: "4px",
        });
        pop.appendChild(fLabel);

        const fInput = document.createElement("input");
        fInput.type = "text";
        fInput.value = filter;
        fInput.placeholder = "留空 = 显示所有组";
        Object.assign(fInput.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", outline: "none", boxSizing: "border-box",
            marginBottom: "14px",
        });
        pop.appendChild(fInput);

        let filterTimer = null;
        fInput.addEventListener("input", () => {
            if (filterTimer) clearTimeout(filterTimer);
            filterTimer = setTimeout(applyAll, 200);
        });

        /* ── 颜色筛选 ── */
        const cLabel = document.createElement("div");
        cLabel.textContent = "颜色筛选";
        Object.assign(cLabel.style, {
            fontSize: "13px", fontWeight: "bold", marginBottom: "4px",
        });
        pop.appendChild(cLabel);

        let cFilter = colorFilter || "none";

        const cdContainer = document.createElement("div");
        Object.assign(cdContainer.style, {
            position: "relative", width: "100%",
            marginBottom: "14px",
        });

        const cdTrigger = document.createElement("div");
        Object.assign(cdTrigger.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", boxSizing: "border-box",
            cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
            userSelect: "none",
        });

        const cdColorRect = document.createElement("span");
        Object.assign(cdColorRect.style, {
            display: "inline-block", width: "44px", height: "14px",
            borderRadius: "2px", border: "1px solid #555", flexShrink: "0",
        });

        const cdColorText = document.createElement("span");
        Object.assign(cdColorText.style, { flex: "1" });

        const cdArrow = document.createElement("span");
        cdArrow.textContent = "\u25BE";
        Object.assign(cdArrow.style, { marginLeft: "auto", fontSize: "11px", color: "#888" });

        cdTrigger.appendChild(cdColorRect);
        cdTrigger.appendChild(cdColorText);
        cdTrigger.appendChild(cdArrow);

        function updateColorPreview() {
            if (cFilter === "none") {
                cdColorRect.style.display = "none";
                cdColorText.textContent = "无";
            } else if (cFilter === "__transparent__") {
                cdColorRect.style.display = "inline-block";
                cdColorRect.style.background = "transparent";
                cdColorRect.textContent = "";
                cdColorText.textContent = "透明色";
            } else {
                cdColorRect.style.display = "inline-block";
                cdColorRect.style.background = cFilter;
                cdColorRect.textContent = "";
                cdColorText.textContent = cFilter.toUpperCase();
            }
        }
        updateColorPreview();

        cdContainer.appendChild(cdTrigger);

        let cdPanel = null;

        function buildColorOptions() {
            const allRaw = rawGroups();
            const colorMap = new Map();
            allRaw.forEach(g => {
                const c = g.color || "__transparent__";
                if (!colorMap.has(c)) colorMap.set(c, g);
            });

            const colors = Array.from(colorMap.keys());

            if (cdPanel) { cdPanel.remove(); cdPanel = null; }

            cdPanel = document.createElement("div");
            Object.assign(cdPanel.style, {
                position: "absolute", left: "0", right: "0", top: "calc(100% + 2px)",
                background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
                zIndex: "100001", maxHeight: "200px", overflowY: "auto",
                boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            });

            function makeColorItem(bgColor, label, value, isTransparent, isNone) {
                const item = document.createElement("div");
                Object.assign(item.style, {
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "5px 8px", cursor: "pointer", fontSize: "13px",
                    transition: "background 0.15s",
                });
                item.addEventListener("mouseenter", () => { item.style.background = "#3a3a3a"; });
                item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });

                if (!isNone) {
                    const rect = document.createElement("span");
                    Object.assign(rect.style, {
                        display: "inline-block", width: "44px", height: "16px",
                        borderRadius: "2px", border: "1px solid #555",
                        background: isTransparent ? "transparent" : bgColor,
                        flexShrink: "0",
                    });
                    item.appendChild(rect);
                }

                const txt = document.createElement("span");
                txt.textContent = label;
                txt.style.color = "#fff";
                item.appendChild(txt);

                item.addEventListener("click", (e) => {
                    e.stopPropagation();
                    cFilter = value;
                    updateColorPreview();
                    if (cdPanel) { cdPanel.remove(); cdPanel = null; }
                    applyAll();
                });

                return item;
            }

            cdPanel.appendChild(makeColorItem("#2a2a2a", "无", "none", false, true));

            colors.forEach(c => {
                if (c === "__transparent__") {
                    cdPanel.appendChild(makeColorItem("#2A2A2A", "透明色", "__transparent__", true, false));
                } else {
                    cdPanel.appendChild(makeColorItem(c, c.toUpperCase(), c, false, false));
                }
            });

            cdContainer.appendChild(cdPanel);
        }

        cdTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            if (cdPanel) {
                cdPanel.remove();
                cdPanel = null;
            } else {
                buildColorOptions();
            }
        });

        pop.appendChild(cdContainer);

        const closeColorPanel = (e) => {
            if (cdPanel && !cdContainer.contains(e.target)) {
                cdPanel.remove();
                cdPanel = null;
            }
        };
        document.addEventListener("mousedown", closeColorPanel);

        /* ── 切换模式 ── */
        const mLabel = document.createElement("div");
        mLabel.textContent = "切换模式";
        Object.assign(mLabel.style, {
            fontSize: "13px", fontWeight: "bold", marginBottom: "4px",
        });
        pop.appendChild(mLabel);

        const mSelect = document.createElement("select");
        Object.assign(mSelect.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", outline: "none", boxSizing: "border-box",
            marginBottom: "14px",
        });
        [
            ["default",     "默认"],
            ["always_one",  "始终开启1个"],
            ["at_most_one", "最多开启1个"],
        ].forEach(([val, txt]) => {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = txt;
            mSelect.appendChild(opt);
        });
        mSelect.value = mode;
        pop.appendChild(mSelect);

        mSelect.addEventListener("change", applyAll);

        /* ── 排序── */
        const sLabel = document.createElement("div");
        sLabel.textContent = "排序";
        Object.assign(sLabel.style, {
            fontSize: "13px", fontWeight: "bold", marginBottom: "4px",
        });
        pop.appendChild(sLabel);

        const sSelect = document.createElement("select");
        Object.assign(sSelect.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", outline: "none", boxSizing: "border-box",
            marginBottom: "14px",
        });
        [
            ["position", "按位置"],
            ["alphabet", "按首字母"],
        ].forEach(([val, txt]) => {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = txt;
            sSelect.appendChild(opt);
        });
        sSelect.value = sortOrder;
        pop.appendChild(sSelect);

        sSelect.addEventListener("change", applyAll);

        /* ── 主题颜色 ── */
        const tcLabel = document.createElement("div");
        tcLabel.textContent = "主题颜色";
        Object.assign(tcLabel.style, {
            fontSize: "13px", fontWeight: "bold", marginBottom: "4px",
        });
        pop.appendChild(tcLabel);

        const colorRow = document.createElement("div");
        Object.assign(colorRow.style, {
            display: "flex", alignItems: "center", gap: "8px",
            marginBottom: "16px",
        });

        const cInput = document.createElement("input");
        cInput.type = "color";
        cInput.value = nameColor || "#ac8686";
        Object.assign(cInput.style, {
            width: "36px", height: "28px", padding: "0",
            border: "1px solid #555", borderRadius: "4px",
            background: "#1a1a1a", cursor: "pointer",
        });
        colorRow.appendChild(cInput);

        const cHex = document.createElement("input");
        cHex.type = "text";
        cHex.value = nameColor || "#ac8686";
        Object.assign(cHex.style, {
            flex: "1", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", outline: "none", boxSizing: "border-box",
        });
        colorRow.appendChild(cHex);

        cInput.addEventListener("input", () => {
            cHex.value = cInput.value;
            applyAll();
        });
        cHex.addEventListener("input", () => {
            if (/^#[0-9a-fA-F]{6}$/.test(cHex.value)) {
                cInput.value = cHex.value;
                applyAll();
            }
        });
        pop.appendChild(colorRow);

        /* ── 挂载弹窗 ── */
        document.body.appendChild(pop);
        fInput.focus();

        pop.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    }

    node._guhaiShowSettings = showSettings;


    /* ═══════════════════ Canvas 自定义 Widget ═══════════════════ */
    let _w = 400, _y = 0;

    node.addCustomWidget({
        name: "guhai_ig",
        type: "ig_custom",

        /* ── 每帧绘制 ── */
        draw(ctx, node, widgetWidth, y, H) {
            _w = widgetWidth;
            _y = y;

            const gearCX = widgetWidth - 18;
            const gearCY = y + HEADER_H / 2;
            drawGear(ctx, gearCX, gearCY, 5);

            const list = visible();

            if (!list.length) {
                ctx.font = "13px sans-serif";
                ctx.fillStyle = "#888";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(
                    filter.trim() ? "无匹配的组" : "工作流中无编组或空的编组",
                    widgetWidth / 2,
                    y + HEADER_H + 20
                );
                return;
            }

            const effectiveColor = nameColor || "#ac8686";

            list.forEach((g, i) => {
                const rowX = PAD_X;
                const rowY = y + HEADER_H + i * (ROW_H + ROW_GAP);
                const rowW = widgetWidth - PAD_X * 2;
                const isOn = mode === "default"
                    ? activeSet.includes(g.title)
                    : g.title === active;

                /* 胶囊背景填充 */
                rrect(ctx, rowX, rowY, rowW, ROW_H, ROW_H / 2);
                ctx.fillStyle = "#2B2F38";
                ctx.fill();

                /* 胶囊边框描边 */
                rrect(ctx, rowX, rowY, rowW, ROW_H, ROW_H / 2);
                ctx.strokeStyle = "#6E7581";
                ctx.lineWidth = 1;
                ctx.stroke();

                /* 开关轨道 */
                const tx = rowX + rowW - ROW_PAD_R - TOGGLE_W;
                const ty = rowY + (ROW_H - TOGGLE_H) / 2;

                ctx.save();
                if (isOn) {
                    ctx.shadowColor = hexToRgba(effectiveColor, 0.35);
                    ctx.shadowBlur = 10;
                    ctx.fillStyle = effectiveColor;
                } else {
                    ctx.shadowColor = "transparent";
                    ctx.shadowBlur = 0;
                    ctx.fillStyle = "#606060";
                }
                rrect(ctx, tx, ty, TOGGLE_W, TOGGLE_H, TOGGLE_H / 2);
                ctx.fill();
                ctx.restore();

                /* 旋钮 */
                const kx = isOn ? tx + TOGGLE_W - KNOB_R - 3 : tx + KNOB_R + 3;
                const ky = ty + TOGGLE_H / 2;

                ctx.save();
                ctx.shadowColor = "rgba(0,0,0,0.3)";
                ctx.shadowBlur = 4;
                ctx.fillStyle = isOn ? "rgb(230,230,230)" : "rgb(128,128,128)";
                ctx.beginPath();
                ctx.arc(kx, ky, KNOB_R, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                /* 标签文字 */
                const textX = rowX + ROW_PAD_L;
                const maxTextW = tx - textX - 10;
                ctx.save();
                ctx.globalAlpha = isOn ? 1.0 : 0.5;
                ctx.font = "bold 20px sans-serif";
                ctx.fillStyle = effectiveColor;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(
                    ellipsis(ctx, g.title, maxTextW),
                    textX,
                    rowY + ROW_H / 2
                );
                ctx.restore();
            });
        },

        /* ── 鼠标事件 ── */
        mouse(event, pos, node) {
            if (event.type !== "pointerdown" && event.type !== "mousedown") {
                return false;
            }

            const localX = pos[0];
            const localY = pos[1] - _y;

            const gearCX = _w - 18;
            const gearCY = HEADER_H / 2;
            const gdx = localX - gearCX;
            const gdy = localY - gearCY;
            if (gdx * gdx + gdy * gdy < 7 * 7) {
                showSettings(event.clientX, event.clientY);
                return true;
            }

            const list = visible();
            for (let i = 0; i < list.length; i++) {
                const rowX = PAD_X;
                const rowY = HEADER_H + i * (ROW_H + ROW_GAP);
                const rowW = _w - PAD_X * 2;

                if (localX >= rowX && localX <= rowX + rowW &&
                    localY >= rowY && localY <= rowY + ROW_H) {
                    handleToggle(list[i].title);
                    return true;
                }
            }

            return false;
        },

        computeSize(width) {
            const cnt = Math.max(visible().length, 1);
            return [400, HEADER_H + cnt * (ROW_H + ROW_GAP) - ROW_GAP + 10];
        },
    });


    /* ═══════════════════ 脏标记系统 ═══════════════════ */
    if (app.graph && typeof app.graph.change === "function") {
        const origGraphChange = app.graph.change;
        app.graph.change = function () {
            if (!selfChanging) dirty = true;
            return origGraphChange.apply(this, arguments);
        };
    }

    function onKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) &&
            (e.key === "m" || e.key === "b" || e.key === "M" || e.key === "B")) {
            setTimeout(() => { dirty = true; }, 100);
        }
    }
    document.addEventListener("keydown", onKeyDown);


    /* ═══════════════════ 定时同步 ═══════════════════ */
    let pageVisible = !document.hidden;
    function onVisibilityChange() {
        const nowVisible = !document.hidden;
        if (nowVisible && !pageVisible) {
            pageVisible = true;
            dirty = true;
        } else {
            pageVisible = nowVisible;
        }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    const timer = setInterval(() => {
        if (!node.graph) {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            document.removeEventListener("keydown", onKeyDown);
            return;
        }

        if (!pageVisible || !dirty) return;
        dirty = false;

        const list = visible();

        const sig = list.map(g => g.title).join("\x00");
        const listChanged = (sig !== lastSig);
        const stateSig = computeStateSig(list);
        const stateChanged = (stateSig !== lastStateSig);

        if (listChanged || stateChanged) {
            lastStateSig = stateSig;

            selfChanging = true;
            try {
                syncExternalState();
                if (listChanged) {
                    refresh(false);
                }
                try { app.graph.change(); } catch (_) {}
            } finally {
                selfChanging = false;
            }
        }
    }, 500);


    /* ═══════════════════ 工作流加载后同步 ═══════════════════ */
    node._guhaiSyncGroups = () => {
        filter     = (node.properties && node.properties.guhai_ig_filter)      || "";
        mode       = (node.properties && node.properties.guhai_ig_mode)        || "default";
        active     = (node.properties && node.properties.guhai_ig_active)      || null;
        activeSet  = (node.properties && node.properties.guhai_ig_active_set)  || null;
        nameColor  = (node.properties && node.properties.guhai_ig_name_color)  || null;
        igDisable  = (node.properties && node.properties.guhai_ig_disable)     || false;
        sortOrder  = (node.properties && node.properties.guhai_ig_sort_order)  || "position";
        colorFilter= (node.properties && node.properties.guhai_ig_color_filter)|| "none";
        lastSig = "";
        lastStateSig = "";
        prevVisibleTitles = new Set();  
        dirty = true;
        refresh(true);
    };


    /* ═══════════════════ 初始构建 ═══════════════════ */
    refresh(false);
    lastStateSig = computeStateSig(visible());
    dirty = false;
}
