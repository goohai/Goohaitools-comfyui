import { app } from "../../../scripts/app.js";

/* ═══════════════════════════════════════════════════
   结婚登记照服装 孤海 — 画廊 Widget
   ═══════════════════════════════════════════════════ */

app.registerExtension({
    name: "goohai.marriage.registration",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "结婚登记照服装_孤海") return;

        const prev = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = prev?.apply(this, arguments);
            
            // 立即锁定尺寸，防止闪烁
            this.setSize([660, 920]);
            this.resizable = false;
            this.size = [660, 920]; // 双重锁定
            
            if (!this._marryInitDone) {
                this._marryInitDone = true;
                _initGallery(this);
            }
            return r;
        };
    },
});

/* ────────────────────────────────────────────────── */
function _initGallery(node) {

    /* 注入滚动条样式（只一次） */
    if (!document.getElementById("_marry_scroll_css")) {
        const st = document.createElement("style");
        st.id = "_marry_scroll_css";
        st.textContent = `
            ._mscroll::-webkit-scrollbar{width:6px}
            ._mscroll::-webkit-scrollbar-track{background:transparent}
            ._mscroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:3px}
            ._mscroll::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28)}
        `;
        document.head.appendChild(st);
    }

    /* ── 状态 ── */
    let images = [];       // 文件名列表
    let thumbs = [];       // [{w, im, c}, ...]

    /* ── 找到 / 创建隐藏的 cloth_name widget ── */
    let nameW = node.widgets.find(w => w.name === "cloth_name");
    if (!nameW) {
        nameW = node.addWidget("text", "cloth_name", "", () => {});
        nameW.hidden = true;
    }
    nameW.computeSize = () => [0, 0];

    const idxW = node.widgets.find(w => w.name === "服装序号");

    /* ════════════════ DOM 结构 ════════════════ */

    const root = _mk("div", {
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        padding: "5px",
        overflow: "hidden",
        background: "transparent",
        fontFamily: "'Microsoft YaHei','SimHei',Arial,sans-serif",
        fontSize: "12px",
        color: "#ddd",
        userSelect: "none",
        width: "650px",
        height: "910px",
    });

    /* —— 预览区（居中） —— */
    const pvRow = _mk("div", {
        flexShrink: "0",
        display: "flex",
        justifyContent: "center",
        marginBottom: "12px",
        position: "relative",
    });
    const pvBox = _mk("div", {
        width: "600px",
        height: "300px",
        borderRadius: "10px",
        overflow: "hidden",
        border: "2px solid #ffffff",
        background: "#6c1e27", // 修改为 #6c1e27
        flexShrink: "0",
        position: "relative",
    });
    const pvImg = _mk("img", {
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
    });
    pvImg.draggable = false;
    pvBox.appendChild(pvImg);

    // 添加“已选”标签
    const selectedLabel = _mk("div", {
        position: "absolute",
        top: "10px",
        left: "10px",
        background: "#00cc00",
        color: "#fff",
        padding: "4px 8px",
        borderRadius: "4px",
        fontSize: "14px",
        fontWeight: "bold",
        zIndex: "10",
    });
    selectedLabel.textContent = "已选";
    pvBox.appendChild(selectedLabel);

    // 添加“无”文字显示
    const noImageLabel = _mk("div", {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        color: "#ffffff", // 白色文字，在深色背景上更明显
        fontSize: "24px",
        fontWeight: "bold",
        zIndex: "5",
        display: "none", // 默认隐藏
    });
    noImageLabel.textContent = "无";
    pvBox.appendChild(noImageLabel);

    pvRow.appendChild(pvBox);
    root.appendChild(pvRow);

    /* —— 画廊滚动区 —— */
    const scroll = _mk("div", {
        flex: "1",
        minHeight: "0",
        overflowY: "auto",
        overflowX: "hidden",
        maxHeight: "540px",  
    });
    scroll.className = "_mscroll";
    scroll.style.scrollbarWidth = "thin";
    scroll.style.scrollbarColor = "rgba(255,255,255,.18) transparent";

    const grid = _mk("div", {
        display: "grid",
        gridTemplateColumns: "repeat(3, 200px)",
        gap: "8px",
        justifyContent: "center",
        padding: "2px 0",
    });
    scroll.appendChild(grid);
    root.appendChild(scroll);

    /* —— DOM Widget —— */
    const dw = node.addDOMWidget(
        "marriage_gallery",
        "marriage_gallery",
        root,
        { hideOnZoom: false }
    );
    dw.serialize = false;

    /* 固定高度计算 */
    dw.computeSize = function (nodeW) {
        return [660, 920];
    };

    /* ════════════════ 辅助函数 ════════════════ */

    function _url(name) {
        return "/marriage_registration/image?name=" + encodeURIComponent(name);
    }

    function _preview(i) {
        if (i >= 0 && i < images.length) {
            pvImg.src = _url(images[i]);
            pvImg.style.display = "block";
            noImageLabel.style.display = "none";
        } else {
            // 序号为0或无效时，清空预览并显示“无”
            pvImg.src = "";
            pvImg.style.display = "none";
            noImageLabel.style.display = "block";
        }
    }

    function _highlight(i) {
        thumbs.forEach((t, j) => {
            const sel = j === i;
            t.w.style.border = sel
                ? "3px solid #00cc00"
                : "1px solid white";
            t.c.style.display = sel ? "flex" : "none";
        });
    }

    function _clearSelection() {
        _highlight(-1);
        _preview(-1);
        nameW.value = "";
    }

    function _pickByMouse(i) {
        if (i < 0 || i >= images.length) return;
        nameW.value = images[i];
        _highlight(i);
        _preview(i);
        if (idxW) idxW.value = i + 1;
    }

    /* ════════════════ 构建画廊 ════════════════ */

    function _buildGallery() {
        grid.innerHTML = "";
        thumbs = [];

        if (!images.length) {
            const msg = _mk("div", {
                gridColumn: "1 / -1",
                textAlign: "center",
                color: "#888",
                padding: "40px 0",
                fontSize: "14px",
            });
            msg.textContent = "暂无服装图片，请将图片放入 marriage registration 文件夹";
            grid.appendChild(msg);
            return;
        }

        images.forEach((fname, i) => {
            const wrap = _mk("div", {
                width: "200px",
                height: "100px",
                borderRadius: "10px",
                overflow: "hidden",
                position: "relative",
                cursor: "pointer",
                border: "1px solid white",
                background: "#111",
                boxSizing: "border-box",
                transition: "border-color .15s ease",
            });

            const im = _mk("img", {
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
                transition: "transform .2s ease",
                pointerEvents: "none",
            });
            im.src = _url(fname);
            im.loading = "lazy";
            im.draggable = false;

            const ck = _mk("div", {
                position: "absolute",
                top: "5px",
                right: "5px",
                width: "22px",
                height: "22px",
                background: "#00cc00",
                borderRadius: "50%",
                display: "none",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: "13px",
                fontWeight: "bold",
                pointerEvents: "none",
                zIndex: "2",
            });
            ck.textContent = "✓";

            const lb = _mk("div", {
                position: "absolute",
                top: "5px",
                left: "5px",
                color: "#fff",
                fontSize: "12px",
                fontWeight: "bold",
                pointerEvents: "none",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                background: "transparent",
            });
            lb.textContent = fname.replace(/\.[^/.]+$/, "");

            wrap.append(im, ck, lb);

            wrap.addEventListener("mouseenter", () => im.style.transform = "scale(1.05)");
            wrap.addEventListener("mouseleave", () => im.style.transform = "scale(1)");
            wrap.addEventListener("click", () => _pickByMouse(i));

            grid.appendChild(wrap);
            thumbs.push({ w: wrap, im, c: ck });
        });
    }

    /* ════════════════ 监听 服装序号 变化 ════════════════ */

    if (idxW) {
        const origCb = idxW.callback;
        idxW.callback = function (v) {
            if (origCb) origCb.call(this, v);
            if (!images.length) return;
            
            if (v === 0) {
                // 序号为0时，清空选择并显示“无”
                _clearSelection();
            } else {
                // 序号为正数时，正常处理
                const index = Math.max(0, Math.min(v - 1, images.length - 1));
                _preview(index);
                _highlight(index);
                nameW.value = images[index];
            }
        };
    }

    /* ════════════════ 初始化 ════════════════ */

    fetch("/marriage_registration/list")
        .then(r => r.ok ? r.json() : Promise.reject("HTTP " + r.status))
        .then(d => {
            images = d.images || [];
            _buildGallery();
            if (!images.length) return;

            // 获取当前序号
            const currentIdx = idxW ? idxW.value : 0;
            
            if (currentIdx === 0) {
                // 序号为0时，清空选择并显示“无”
                _clearSelection();
            } else {
                // 序号为正数时，正常初始化
                const initialIndex = Math.max(0, Math.min(currentIdx - 1, images.length - 1));
                _highlight(initialIndex);
                _preview(initialIndex);
                nameW.value = images[initialIndex];
            }
        })
        .catch(e => console.error("[MarriageGallery]", e));
}

/* ── DOM 快捷创建 ── */
function _mk(tag, css) {
    const e = document.createElement(tag);
    if (css) Object.assign(e.style, css);
    return e;
}