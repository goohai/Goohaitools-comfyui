import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "goohaitools.ignore_groups",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "忽略多组孤海") return;

        const origCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origCreated?.apply(this, arguments);
            this.color   = this.color   || "#4E464A";
            this.bgcolor = this.bgcolor || "#4E464A";
            this.size = [400, this.size[1]];
            buildIgnoreGroupsUI(this);
        };

        const origConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            origConfigure?.apply(this, arguments);
            if (this._guhaiSyncGroups) this._guhaiSyncGroups();
        };

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
        if (node.properties.guhai_ig_filter      != null) filter    = node.properties.guhai_ig_filter;
        if (node.properties.guhai_ig_mode        != null) mode      = node.properties.guhai_ig_mode;
        if (node.properties.guhai_ig_active      != null) active    = node.properties.guhai_ig_active;
        if (node.properties.guhai_ig_active_set  != null) activeSet = node.properties.guhai_ig_active_set;
        if (node.properties.guhai_ig_name_color  != null) nameColor = node.properties.guhai_ig_name_color;
        if (node.properties.guhai_ig_disable     != null) igDisable = !!node.properties.guhai_ig_disable;
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


    /* ═══════════════════ 布局常量 ═══════════════════ */
    const HEADER_H  = 14;
    const ROW_H     = 34;
    const ROW_GAP   = 15;
    const PAD_X     = 16;
    const ROW_PAD_L = 26;
    const ROW_PAD_R = 16;
    const TOGGLE_W  = 67;
    const TOGGLE_H  = 26;
    const KNOB_R    = 11;


    /* ═══════════════════ DOM CSS 注入 ═══════════════════ */
    if (!document.getElementById("guhai-ig-styles")) {
        const s = document.createElement("style");
        s.id = "guhai-ig-styles";
        s.textContent = `
            .guhai-ig {
                position: relative; width: 100%; box-sizing: border-box;
                overflow: hidden; user-select: none;
                pointer-events: auto;
                margin-top: -10px;
                padding-bottom: 10px;
            }
            .guhai-ig-header {
                height: ${HEADER_H}px; display: flex;
                justify-content: flex-end; align-items: center;
                padding: 0 6px;
            }
            .guhai-ig-gear {
                width: 16px; height: 16px; cursor: pointer;
                opacity: 0.6; transition: opacity .15s;
                display: flex; align-items: center; justify-content: center;
                pointer-events: auto;
            }
            .guhai-ig-gear:hover { opacity: 1; }
            .guhai-ig-gear svg { width: 13px; height: 13px; }
            .guhai-ig-empty {
                color: #888; text-align: center;
                padding: 20px 16px; font-size: 13px;
            }
            .guhai-ig-row {
                display: flex; align-items: center; justify-content: space-between;
                height: ${ROW_H}px;
                margin: 0 ${PAD_X}px ${ROW_GAP}px;
                padding: 0 ${ROW_PAD_R}px 0 ${ROW_PAD_L}px;
                background: #2B2F38; border: 1px solid #6E7581;
                border-radius: ${ROW_H / 2}px;
                cursor: pointer; box-sizing: border-box;
                transition: border-color .15s;
                pointer-events: auto;
            }
            .guhai-ig-row:hover { border-color: #8E95A1; }
            .guhai-ig-row:last-child { margin-bottom: 5px; }
            .guhai-ig-label {
                font-weight: bold; font-size: 20px; flex: 1;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                margin-right: 10px; transition: opacity .15s;
            }
            .guhai-ig-toggle {
                width: ${TOGGLE_W}px; height: ${TOGGLE_H}px; border-radius: ${TOGGLE_H / 2}px;
                background: #606060; position: relative; flex-shrink: 0;
                transition: background .2s ease, box-shadow .2s ease;
            }
            .guhai-ig-knob {
                width: ${KNOB_R * 2}px; height: ${KNOB_R * 2}px; border-radius: 50%;
                background: rgb(128,128,128);
                position: absolute; top: 2px; left: 3px;
                transition: left .2s ease, background .2s ease;
                box-shadow: 0 1px 4px rgba(0,0,0,0.3);
            }
            .guhai-ig-toggle.on .guhai-ig-knob {
                left: calc(${TOGGLE_W}px - ${KNOB_R * 2}px - 3px);
                background: rgb(230,230,230);
            }
        `;
        document.head.appendChild(s);
    }


    /* ═══════════════════ 滚轮转发给 canvas ═══════════════════ */
    function forwardWheelToCanvas(e) {
        e.preventDefault();
        e.stopPropagation();
        try {
            const canvasEl = (app.canvas && app.canvas.canvas) || document.querySelector("canvas");
            if (canvasEl) {
                canvasEl.dispatchEvent(new WheelEvent("wheel", {
                    clientX: e.clientX, clientY: e.clientY,
                    deltaY: e.deltaY, deltaX: e.deltaX,
                    deltaMode: e.deltaMode, bubbles: true, cancelable: true,
                }));
            }
        } catch (_) {}
    }


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
        list = list.filter(g => collectNodes(g, list).length > 0);
        if (filter.trim()) {
            const kw = filter.trim().toLowerCase();
            list = list.filter(g => g.title.toLowerCase().includes(kw));
        }
        if (colorFilter && colorFilter !== "none") {
            list = list.filter(g => {
                if (colorFilter === "__transparent__") return !g.color;
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

    function collectNodes(grp, allGroups) {
        const g = app.graph;
        if (!g || !g._nodes) return [];
        const all  = allGroups || rawGroups();
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
            if (igDisable) { n.mode = 2; } else { n.mode = 4; }
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


    /* ═══════════════════ 组状态检测 ═══════════════════ */
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


    /* ═══════════════════ 外部同步 ═══════════════════ */
    function syncExternalState() {
        // 【修复】节点不在当前活跃图的节点列表中时，跳过同步
        if (!app.graph || !app.graph._nodes || app.graph._nodes.indexOf(node) < 0) return;

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
            if (!active) {
                for (const g of list) {
                    if (getGroupState(g) === true) {
                        active = g.title;
                        changed = true;
                        break;
                    }
                }
            }
        }

        if (changed) save();
    }


    /* ═══════════════════ 颜色工具 ═══════════════════ */
    function hexToRgba(hex, alpha) {
        if (!hex || hex.length < 7) return `rgba(120,120,120,${alpha})`;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }


    /* ═══════════════════ DOM UI ═══════════════════ */
    const gearSVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="3" fill="rgba(120,120,120,0.3)" stroke="rgba(153,153,153,0.6)" stroke-width="1"/>
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58z"
            fill="rgba(120,120,120,0.25)" stroke="rgba(120,120,120,0.4)" stroke-width="1.2"/>
    </svg>`;

    const rootEl = document.createElement("div");
    rootEl.className = "guhai-ig";
    rootEl.style.visibility = "hidden";

    let _lastBuildSig = "";

    function calcHeight() {
        const cnt = Math.max(visible().length, 1);
        return HEADER_H + cnt * (ROW_H + ROW_GAP) - ROW_GAP + 10;
    }

    function buildStatefulSig() {
        const list = visible();
        const effectiveColor = nameColor || "#469b66";
        let sig = list.map(g => {
            const isOn = mode === "default"
                ? (Array.isArray(activeSet) && activeSet.includes(g.title))
                : g.title === active;
            return g.title + (isOn ? ":1" : ":0");
        }).join("\x00");
        sig += "|" + effectiveColor + "|" + (mode || "");
        return sig;
    }

    function buildDom(force) {
        const sig = buildStatefulSig();
        if (sig === _lastBuildSig && !force) return;
        _lastBuildSig = sig;

        const list = visible();
        const effectiveColor = nameColor || "#469b66";

        rootEl.innerHTML = "";

        rootEl.addEventListener("wheel", forwardWheelToCanvas, { passive: false });

        const header = document.createElement("div");
        header.className = "guhai-ig-header";
        const gear = document.createElement("div");
        gear.className = "guhai-ig-gear";
        gear.innerHTML = gearSVG;
        gear.title = "设置";
        gear.addEventListener("mousedown", (e) => {
            e.preventDefault(); e.stopPropagation();
            showSettings(e.clientX, e.clientY);
        });
        gear.addEventListener("pointerdown", (e) => e.stopPropagation());
        gear.addEventListener("wheel", forwardWheelToCanvas, { passive: false });
        header.appendChild(gear);
        rootEl.appendChild(header);

        if (!list.length) {
            const empty = document.createElement("div");
            empty.className = "guhai-ig-empty";
            empty.textContent = filter.trim() ? "无匹配的组" : "工作流中无编组或空的编组";
            rootEl.appendChild(empty);
        } else {
            const h = calcHeight();
            rootEl.style.minHeight = h + "px";
            rootEl.style.height    = h + "px";

            list.forEach((g) => {
                const isOn = mode === "default"
                    ? activeSet.includes(g.title)
                    : g.title === active;

                const row = document.createElement("div");
                row.className = "guhai-ig-row";

                const label = document.createElement("div");
                label.className = "guhai-ig-label";
                label.style.color = effectiveColor;
                label.style.opacity = isOn ? "1" : "0.5";
                label.textContent = g.title;

                const toggle = document.createElement("div");
                toggle.className = "guhai-ig-toggle" + (isOn ? " on" : "");
                toggle.style.background = isOn ? effectiveColor : "#606060";
                toggle.style.boxShadow = isOn ? "0 0 8px " + hexToRgba(effectiveColor, 0.35) : "none";

                const knob = document.createElement("div");
                knob.className = "guhai-ig-knob";
                toggle.appendChild(knob);
                row.appendChild(label);
                row.appendChild(toggle);

                row.addEventListener("mousedown", (e) => {
                    e.preventDefault(); e.stopPropagation();
                    handleToggle(g.title);
                });
                row.addEventListener("pointerdown", (e) => e.stopPropagation());
                row.addEventListener("wheel", forwardWheelToCanvas, { passive: false });

                rootEl.appendChild(row);
            });
        }
    }


    /* ═══════════════════ DOM Widget 注册 ═══════════════════ */
    const domWidget = node.addDOMWidget("guhai_ig", "ig_custom", rootEl, {
        serialize: false,
        hideOnZoom: false,
    });

    if (domWidget) {
        domWidget.computeSize = function () {
            return [400, calcHeight()];
        };
    }

    node.computeSize = function () {
        return [400, calcHeight()];
    };


    /* ═══════════════════ 核心刷新 ═══════════════════ */
    let lastSig = "";
    let lastStateSig = "";
    let _preserveActive = false;

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
            if (!_preserveActive) {
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
        }

        _preserveActive = false;
        if (stateChanged) save();

        if (forceApply || stateChanged || listChanged) {
            selfChanging = true;
            try {
                list.forEach(g => {
                    const isOn = mode === "default"
                        ? activeSet.includes(g.title)
                        : g.title === active;
                    if (isOn) restoreGroup(g);
                    else      bypassGroup(g);
                });
                try { app.graph.change(); } catch (_) {}
            } finally {
                selfChanging = false;
            }
        }

        prevVisibleTitles = currentVisibleTitles;

        buildDom(forceApply || stateChanged || listChanged);
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
            if (active === title) { active = null; }
            else { active = title; }
        }
        save();
        refresh(true);
    }


    /* ═══════════════════ 选项设置 ═══════════════════ */
    let _settingsCleanup = null;

    function showSettings(x, y) {
        if (_settingsCleanup) { _settingsCleanup(); _settingsCleanup = null; }

        const overlay = document.createElement("div");
        overlay.id = "guhai_ig_overlay";
        Object.assign(overlay.style, {
            position: "fixed", inset: "0", zIndex: "99998",
            background: "transparent", cursor: "default",
        });
        overlay.addEventListener("wheel", forwardWheelToCanvas, { passive: false });
        document.body.appendChild(overlay);

        const pop = document.createElement("div");
        pop.id = "guhai_ig_pop";
        Object.assign(pop.style, {
            position: "fixed",
            left: Math.min(x, innerWidth  - 280) + "px",
            top:  Math.min(y, innerHeight - 560) + "px",
            background: "#2a2a2a", border: "1px solid #555",
            borderRadius: "8px", padding: "14px 18px",
            zIndex: "99999", minWidth: "250px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
            color: "#e0e0e0", fontFamily: "inherit",
        });
        pop.addEventListener("wheel", forwardWheelToCanvas, { passive: false });

        function closePopup() {
            if (overlay.parentNode) overlay.remove();
            if (pop.parentNode)     pop.remove();
            document.removeEventListener("keydown", onEsc);
            document.removeEventListener("mousedown", closeColorPanel);
            _settingsCleanup = null;
        }
        _settingsCleanup = closePopup;

        overlay.addEventListener("mousedown", (e) => {
            e.preventDefault(); e.stopPropagation(); closePopup();
        });
        function onEsc(e) { if (e.key === "Escape") closePopup(); }
        document.addEventListener("keydown", onEsc);

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
                    if (activeSet && activeSet.length) { active = activeSet[0]; }
                    else if (visible().length) { active = visible()[0].title; }
                    else { active = null; }
                    activeSet = null;
                } else {
                    if (activeSet && activeSet.length) { active = activeSet[0]; }
                    else if (mode === "always_one" && active) { /* 保持 active 不变 */ }
                    else { active = null; }
                    activeSet = null;
                }
                mode = newMode;
            } else {
                if (mode === "always_one" && !active) {
                    const list = visible();
                    if (list.length) active = list[0].title;
                }
            }
            save();
            refresh(true);
        }

        const titleEl = document.createElement("div");
        titleEl.textContent = "🎮  忽略多组_孤海 设置";
        Object.assign(titleEl.style, {
            fontSize: "15px", fontWeight: "bold", marginBottom: "14px",
            color: "#e0e0e0", borderBottom: "1px solid #444", paddingBottom: "8px",
        });
        pop.appendChild(titleEl);

        const dLabel = document.createElement("div");
        dLabel.textContent = "路由控制";
        Object.assign(dLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "6px" });
        pop.appendChild(dLabel);

        const dRow = document.createElement("div");
        Object.assign(dRow.style, { display: "flex", alignItems: "center", gap: "20px", marginBottom: "14px" });

        const dRadioBypass = document.createElement("input");
        dRadioBypass.type = "radio"; dRadioBypass.name = "guhai_ig_close_mode";
        dRadioBypass.value = "bypass"; dRadioBypass.checked = !igDisable; dRadioBypass.style.cursor = "pointer";
        const dLblBypass = document.createElement("label");
        dLblBypass.style.cursor = "pointer"; dLblBypass.style.fontSize = "13px";
        dLblBypass.appendChild(dRadioBypass); dLblBypass.appendChild(document.createTextNode(" 绕过（ctrl+b）"));

        const dRadioDisable = document.createElement("input");
        dRadioDisable.type = "radio"; dRadioDisable.name = "guhai_ig_close_mode";
        dRadioDisable.value = "disable"; dRadioDisable.checked = !!igDisable; dRadioDisable.style.cursor = "pointer";
        const dLblDisable = document.createElement("label");
        dLblDisable.style.cursor = "pointer"; dLblDisable.style.fontSize = "13px";
        dLblDisable.appendChild(dRadioDisable); dLblDisable.appendChild(document.createTextNode(" 禁用（ctrl+m）"));

        dRow.appendChild(dLblBypass); dRow.appendChild(dLblDisable); pop.appendChild(dRow);
        dRadioBypass.addEventListener("change", applyAll);
        dRadioDisable.addEventListener("change", applyAll);

        const fLabel = document.createElement("div");
        fLabel.textContent = "关键词筛选";
        Object.assign(fLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "4px" });
        pop.appendChild(fLabel);

        const fInput = document.createElement("input");
        fInput.type = "text"; fInput.value = filter; fInput.placeholder = "留空 = 显示所有组";
        Object.assign(fInput.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", outline: "none", boxSizing: "border-box", marginBottom: "14px",
        });
        pop.appendChild(fInput);
        let filterTimer = null;
        fInput.addEventListener("input", () => {
            if (filterTimer) clearTimeout(filterTimer);
            filterTimer = setTimeout(applyAll, 200);
        });

        const cLabel = document.createElement("div");
        cLabel.textContent = "颜色筛选";
        Object.assign(cLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "4px" });
        pop.appendChild(cLabel);

        let cFilter = colorFilter || "none";

        const cdContainer = document.createElement("div");
        Object.assign(cdContainer.style, { position: "relative", width: "100%", marginBottom: "14px" });

        const cdTrigger = document.createElement("div");
        Object.assign(cdTrigger.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", boxSizing: "border-box",
            cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", userSelect: "none",
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
        cdTrigger.appendChild(cdColorRect); cdTrigger.appendChild(cdColorText); cdTrigger.appendChild(cdArrow);

        function updateColorPreview() {
            if (cFilter === "none") {
                cdColorRect.style.display = "none"; cdColorText.textContent = "无";
            } else if (cFilter === "__transparent__") {
                cdColorRect.style.display = "inline-block"; cdColorRect.style.background = "transparent";
                cdColorText.textContent = "透明色";
            } else {
                cdColorRect.style.display = "inline-block"; cdColorRect.style.background = cFilter;
                cdColorText.textContent = cFilter.toUpperCase();
            }
        }
        updateColorPreview();
        cdContainer.appendChild(cdTrigger);

        let cdPanel = null;
        function buildColorOptions() {
            const allRaw = rawGroups();
            const colorMap = new Map();
            allRaw.forEach(g => { const c = g.color || "__transparent__"; if (!colorMap.has(c)) colorMap.set(c, g); });
            const colors = Array.from(colorMap.keys());
            if (cdPanel) { cdPanel.remove(); cdPanel = null; }
            cdPanel = document.createElement("div");
            Object.assign(cdPanel.style, {
                position: "absolute", left: "0", right: "0", top: "calc(100% + 2px)",
                background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
                zIndex: "100001", maxHeight: "200px", overflowY: "auto",
                boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            });
            cdPanel.addEventListener("wheel", forwardWheelToCanvas, { passive: false });
            function makeColorItem(bgColor, label, value, isTransparent, isNone) {
                const item = document.createElement("div");
                Object.assign(item.style, {
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "5px 8px", cursor: "pointer", fontSize: "13px", transition: "background 0.15s",
                });
                item.addEventListener("mouseenter", () => { item.style.background = "#3a3a3a"; });
                item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
                if (!isNone) {
                    const rect = document.createElement("span");
                    Object.assign(rect.style, {
                        display: "inline-block", width: "44px", height: "16px",
                        borderRadius: "2px", border: "1px solid #555",
                        background: isTransparent ? "transparent" : bgColor, flexShrink: "0",
                    });
                    item.appendChild(rect);
                }
                const txt = document.createElement("span");
                txt.textContent = label; txt.style.color = "#fff"; item.appendChild(txt);
                item.addEventListener("click", (e) => {
                    e.stopPropagation(); cFilter = value; updateColorPreview();
                    if (cdPanel) { cdPanel.remove(); cdPanel = null; } applyAll();
                });
                return item;
            }
            cdPanel.appendChild(makeColorItem("#2a2a2a", "无", "none", false, true));
            colors.forEach(c => {
                if (c === "__transparent__") { cdPanel.appendChild(makeColorItem("#2A2A2A", "透明色", "__transparent__", true, false)); }
                else { cdPanel.appendChild(makeColorItem(c, c.toUpperCase(), c, false, false)); }
            });
            cdContainer.appendChild(cdPanel);
        }
        cdTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            if (cdPanel) { cdPanel.remove(); cdPanel = null; } else { buildColorOptions(); }
        });
        pop.appendChild(cdContainer);

        const closeColorPanel = (e) => {
            if (cdPanel && !cdContainer.contains(e.target)) { cdPanel.remove(); cdPanel = null; }
        };
        document.addEventListener("mousedown", closeColorPanel);

        const mLabel = document.createElement("div");
        mLabel.textContent = "切换模式";
        Object.assign(mLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "4px" });
        pop.appendChild(mLabel);

        const mSelect = document.createElement("select");
        Object.assign(mSelect.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", outline: "none", boxSizing: "border-box", marginBottom: "14px",
        });
        [["default","默认"],["always_one","始终开启1个"],["at_most_one","最多开启1个"]].forEach(([val, txt]) => {
            const opt = document.createElement("option"); opt.value = val; opt.textContent = txt; mSelect.appendChild(opt);
        });
        mSelect.value = mode; pop.appendChild(mSelect);
        mSelect.addEventListener("change", applyAll);

        const sLabel = document.createElement("div");
        sLabel.textContent = "排序";
        Object.assign(sLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "4px" });
        pop.appendChild(sLabel);

        const sSelect = document.createElement("select");
        Object.assign(sSelect.style, {
            width: "100%", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", outline: "none", boxSizing: "border-box", marginBottom: "14px",
        });
        [["position","按位置"],["alphabet","按首字母"]].forEach(([val, txt]) => {
            const opt = document.createElement("option"); opt.value = val; opt.textContent = txt; sSelect.appendChild(opt);
        });
        sSelect.value = sortOrder; pop.appendChild(sSelect);
        sSelect.addEventListener("change", applyAll);

        const tcLabel = document.createElement("div");
        tcLabel.textContent = "主题颜色";
        Object.assign(tcLabel.style, { fontSize: "13px", fontWeight: "bold", marginBottom: "4px" });
        pop.appendChild(tcLabel);

        const colorRow = document.createElement("div");
        Object.assign(colorRow.style, { display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" });

        const cInput = document.createElement("input");
        cInput.type = "color"; cInput.value = nameColor || "#469b66";
        Object.assign(cInput.style, {
            width: "36px", height: "28px", padding: "0",
            border: "1px solid #555", borderRadius: "4px", background: "#1a1a1a", cursor: "pointer",
        });
        colorRow.appendChild(cInput);

        const cHex = document.createElement("input");
        cHex.type = "text"; cHex.value = nameColor || "#469b66";
        Object.assign(cHex.style, {
            flex: "1", padding: "5px 8px", fontSize: "13px",
            background: "#1a1a1a", border: "1px solid #555", borderRadius: "4px",
            color: "#e0e0e0", outline: "none", boxSizing: "border-box",
        });
        colorRow.appendChild(cHex);

        cInput.addEventListener("input", () => { cHex.value = cInput.value; applyAll(); });
        cHex.addEventListener("input", () => {
            if (/^#[0-9a-fA-F]{6}$/.test(cHex.value)) { cInput.value = cHex.value; applyAll(); }
        });
        pop.appendChild(colorRow);

        document.body.appendChild(pop);
        fInput.focus();
        pop.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); });
    }

    node._guhaiShowSettings = showSettings;


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
        if (nowVisible && !pageVisible) { pageVisible = true; dirty = true; }
        else { pageVisible = nowVisible; }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    const timer = setInterval(() => {
        if (!node.graph) {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            document.removeEventListener("keydown", onKeyDown);
            return;
        }

        // 适用于所有情况：多标签页切换（graph 对象不同）以及
        // 同标签页内加载新工作流（graph 对象被复用但 _nodes 被重新 configure）
        if (!app.graph || !app.graph._nodes || app.graph._nodes.indexOf(node) < 0) return;

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
                } else {
                    buildDom(true);
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
        _preserveActive = true;
        dirty = true;
        refresh(true);
    };


    /* ═══════════════════ 初始构建 ═══════════════════ */
    refresh(false);
    lastStateSig = computeStateSig(visible());
    dirty = false;

    requestAnimationFrame(() => { rootEl.style.visibility = "visible"; });
}
