// custom_nodes/GoohaiTools-comfyui/web/js/id_photo_clothing.js
// 证件照服装选择_孤海 —— 前端 UI 扩展

import { app } from "../../../scripts/app.js";

const NODE_NAME = "IDPhotoClothingSelector_孤海";
const THUMB_W = 128;
const THUMB_H = 180;
const GAP = 5;
const BORDER_RADIUS = 10;
const COLS = 4;
const SCROLLBAR_EXTRA = 10;
const GALLERY_WIDTH = COLS * THUMB_W + (COLS - 1) * GAP + SCROLLBAR_EXTRA;
const BORDER_HIGHLIGHT = 3;
const SEARCH_AREA_H = 34;
const INNER_GAP = 6;
const PROMPT_TEXTAREA_H = THUMB_H - INNER_GAP - SEARCH_AREA_H; // 180 - 6 - 34 = 140
const TOP_ROW_GAP = 15;
const BOTTOM_PAD = 20;

let _dataCache = null;

async function loadTemplateData() {
    if (_dataCache) return _dataCache;
    try {
        const resp = await fetch("/goohai/id_photo_templates");
        _dataCache = await resp.json();
    } catch (e) {
        console.error("[GoohaiTools] 加载模板数据失败:", e);
        _dataCache = { categories: [], templates: {} };
    }
    return _dataCache;
}

function createCheckmark() {
    const el = document.createElement("div");
    el.textContent = "✓";
    Object.assign(el.style, {
        position: "absolute", top: "2px", right: "2px",
        width: "18px", height: "18px",
        background: "#4CAF50", borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: "13px", fontWeight: "bold",
        zIndex: "10", pointerEvents: "none",
        boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
    });
    return el;
}

function createSelectedBadge() {
    const el = document.createElement("div");
    el.textContent = "已选";
    Object.assign(el.style, {
        position: "absolute", top: "4px", left: "4px",
        padding: "2px 6px",
        background: "#4CAF50",
        borderRadius: "4px",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontSize: "10px", fontWeight: "bold",
        zIndex: "10", pointerEvents: "none",
        boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
        whiteSpace: "nowrap",
    });
    return el;
}

// ==================== 注册扩展 ====================

app.registerExtension({
    name: "goohai.id_photo_clothing",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const origOnCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            origOnCreated?.apply(this, arguments);
            this.color = "#3a4d64";
            this.bgcolor = "#2c3849";
            this._initClothingUI();
        };

        nodeType.prototype._initClothingUI = async function () {
            const node = this;
            const data = await loadTemplateData();

            const allTemplates = data.templates;
            const allCategories = data.categories;

            // ========== 状态 ==========
            const defaultCat = allCategories[0] || "";
            let currentCategory = defaultCat;
            let searchQuery = "";
            let isSearching = false;
            let selectedCategory = "";
            let selectedFilename = "";
            let selectedPrompt = "";

            // ========== 提示词输出 widget ==========
            const promptWidget = node.widgets?.find(w => w.name === "提示词输出");

            // ========== 挂接「风格类型」下拉回调 ==========
            const catWidget = node.widgets?.find(w => w.name === "风格类型");
            if (catWidget) {
                const origCb = catWidget.callback;
                catWidget.callback = function (v) {
                    origCb?.call(this, v);
                    currentCategory = v;
                    searchQuery = "";
                    isSearching = false;
                    searchInput.value = "";
                    clearBtn.style.display = "none";
                    renderGallery();
                };
            }

            // ========== 辅助函数 ==========

            function syncPrompt() {
                if (promptWidget) {
                    promptWidget.value = selectedPrompt;
                    const el = promptWidget.element;
                    if (el) {
                        const ta = el.tagName === "TEXTAREA" ? el : el.querySelector?.("textarea");
                        if (ta) ta.value = selectedPrompt;
                    }
                }
                promptArea.value = selectedPrompt;
                _lastSyncedValue = selectedPrompt;
            }

            function findTemplate(cat, fname) {
                return (allTemplates[cat] || []).find(t => t.filename === fname);
            }

            function deselectAll() {
                selectedCategory = "";
                selectedFilename = "";
                selectedPrompt = "";
                syncPrompt();
                renderGallery();
            }

            function selectTemplate(tpl) {
                selectedCategory = tpl.category;
                selectedFilename = tpl.filename;
                selectedPrompt = tpl.prompt || "";
                syncPrompt();
                renderGallery();
            }

            function buildDisplayList() {
                let pool = [];
                if (isSearching) {
                    // 用任意符号类字符作为分隔符（中文逗号、英文逗号、空格、分号、顿号等），
                    // 将搜索词拆分为多个关键词
                    const keywords = searchQuery
                        .toLowerCase()
                        .split(/[,，、\s;；\-_.!@#$%^&*()+=$${}|\\:";'<>?\/~`]+/)
                        .filter(k => k.length > 0);

                    for (const cat of allCategories) {
                        for (const tpl of (allTemplates[cat] || [])) {
                            const catLower = cat.toLowerCase();
                            const titleLower = tpl.title.toLowerCase();
                            const promptLower = tpl.prompt.toLowerCase();
                            // 所有关键词都必须匹配（AND 逻辑），
                            // 每个关键词只要出现在文件夹名、标题或提示词中的任意一个即可
                            const allMatch = keywords.every(kw =>
                                catLower.includes(kw)
                                || titleLower.includes(kw)
                                || promptLower.includes(kw)
                            );
                            if (allMatch) {
                                pool.push(tpl);
                            }
                        }
                    }
                } else {
                    pool = (allTemplates[currentCategory] || []).slice();
                }

                const list = [];
                const hasSelection = selectedFilename && selectedCategory;

                if (!hasSelection) {
                    list.push({
                        _kind: "none", title: "无", prompt: "",
                        _isSel: false, _isFirst: true,
                    });
                } else {
                    const sel = findTemplate(selectedCategory, selectedFilename);
                    if (sel) {
                        list.push({ _kind: "first_preview", ...sel, _isSel: false, _isFirst: true });
                    } else {
                        list.push({
                            _kind: "none", title: "无", prompt: "",
                            _isSel: false, _isFirst: true,
                        });
                    }
                }

                for (const tpl of pool) {
                    const isSelected = hasSelection
                        && tpl.category === selectedCategory
                        && tpl.filename === selectedFilename;
                    list.push({ _kind: "item", ...tpl, _isSel: isSelected, _isFirst: false });
                }

                return { items: list, poolCount: pool.length };
            }

            // ==================== DOM 构建 ====================

            const container = document.createElement("div");
            Object.assign(container.style, {
                width: "100%",
                boxSizing: "border-box",
                fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif",
                padding: "0px 4px 4px 4px",
            });

            // ========== 顶部横排区域：预览框(左) + 提示词/搜索(右) ==========

            const topRow = document.createElement("div");
            Object.assign(topRow.style, {
                display: "flex",
                flexDirection: "row",
                alignItems: "flex-start",
                width: "100%",
                gap: `${TOP_ROW_GAP}px`,
                marginBottom: "6px",
            });

            // ---- 左侧预览框 ----
            const previewBox = document.createElement("div");
            Object.assign(previewBox.style, {
                width: `${THUMB_W}px`,
                height: `${THUMB_H}px`,
                minWidth: `${THUMB_W}px`,
                boxSizing: "border-box",
                border: `${BORDER_HIGHLIGHT}px solid #4CAF50`,
                borderRadius: `${BORDER_RADIUS}px`,
                overflow: "hidden",
                position: "relative",
                cursor: "pointer",
                flexShrink: "0",
                transition: "transform .1s",
                background: "#1e1e1e",
            });
            previewBox.addEventListener("mouseenter", () => {
                previewBox.style.transform = "scale(1.03)";
            });
            previewBox.addEventListener("mouseleave", () => {
                previewBox.style.transform = "scale(1)";
            });
            previewBox.addEventListener("click", () => deselectAll());
            topRow.appendChild(previewBox);

            // ---- 右侧列：提示词框 + 搜索框 ----
            const rightCol = document.createElement("div");
            Object.assign(rightCol.style, {
                display: "flex",
                flexDirection: "column",
                flex: "1",
                minWidth: "0",
                height: `${THUMB_H}px`,
                boxSizing: "border-box",
                overflow: "hidden",
            });

            // ---- 提示词文本框 ----
            const promptArea = document.createElement("textarea");
            promptArea.placeholder = "服装/发型提示词：选择模板后自动填入，也可随时手动编辑...";
            Object.assign(promptArea.style, {
                width: "100%",
                height: `${PROMPT_TEXTAREA_H}px`,
                minHeight: `${PROMPT_TEXTAREA_H}px`,
                maxHeight: `${PROMPT_TEXTAREA_H}px`,
                resize: "none",
                background: "#222",
                color: "#ddd",
                border: "1px solid #444",
                borderRadius: "6px",
                padding: "6px 8px",
                fontSize: "14px",
                fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif",
                outline: "none",
                boxSizing: "border-box",
                overflow: "auto",
                display: "block",
                lineHeight: "1.5",
                transition: "border-color .2s",
                marginBottom: `${INNER_GAP}px`,
                flexShrink: "0",
            });
            promptArea.addEventListener("focus", () => {
                promptArea.style.borderColor = "#4CAF50";
            });
            promptArea.addEventListener("blur", () => {
                promptArea.style.borderColor = "#444";
            });
            promptArea.addEventListener("keydown", (e) => e.stopPropagation());
            promptArea.addEventListener("input", () => {
                if (promptWidget) {
                    promptWidget.value = promptArea.value;
                    const el = promptWidget.element;
                    if (el) {
                        const ta = el.tagName === "TEXTAREA" ? el : el.querySelector?.("textarea");
                        if (ta) ta.value = promptArea.value;
                    }
                }
                _lastSyncedValue = promptArea.value;
            });
            rightCol.appendChild(promptArea);

            // ---- 搜索框 ----
            const searchWrapper = document.createElement("div");
            Object.assign(searchWrapper.style, {
                position: "relative",
                width: "100%",
                marginBottom: "0px",
                marginTop: "0px",
                flexShrink: "0",
            });

            const magnifier = document.createElement("div");
            magnifier.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="7"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>`;
            Object.assign(magnifier.style, {
                position: "absolute", left: "8px", top: "50%",
                transform: "translateY(-50%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                pointerEvents: "none", zIndex: "2",
            });
            searchWrapper.appendChild(magnifier);

            const searchInput = document.createElement("input");
            searchInput.type = "text";
            searchInput.placeholder = "搜索模板（多个关键词用任意符号隔开，如：西装 领带 男...）";
            Object.assign(searchInput.style, {
                width: "100%",
                padding: "5px 26px 5px 28px",
                border: "1px solid #555", borderRadius: "4px",
                background: "#2a2a2a", color: "#e0e0e0",
                fontSize: "12px", outline: "none",
                boxSizing: "border-box",
                transition: "border-color .2s",
            });
            searchInput.addEventListener("focus", () => {
                searchInput.style.borderColor = "#4CAF50";
            });
            searchInput.addEventListener("blur", () => {
                searchInput.style.borderColor = "#555";
            });
            searchInput.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Escape") searchInput.blur();
            });
            searchInput.addEventListener("input", () => {
                searchQuery = searchInput.value.trim();
                isSearching = searchQuery.length > 0;
                clearBtn.style.display = isSearching ? "flex" : "none";
                renderGallery();
            });
            searchWrapper.appendChild(searchInput);

            const clearBtn = document.createElement("div");
            clearBtn.textContent = "✕";
            Object.assign(clearBtn.style, {
                position: "absolute", right: "8px", top: "50%",
                transform: "translateY(-50%)",
                width: "16px", height: "16px",
                display: "none", alignItems: "center", justifyContent: "center",
                color: "#888", fontSize: "12px", fontWeight: "bold",
                cursor: "pointer", zIndex: "2",
                borderRadius: "50%",
                transition: "color .15s, background .15s",
            });
            clearBtn.addEventListener("mouseenter", () => {
                clearBtn.style.color = "#e0e0e0";
                clearBtn.style.background = "rgba(255,255,255,0.1)";
            });
            clearBtn.addEventListener("mouseleave", () => {
                clearBtn.style.color = "#888";
                clearBtn.style.background = "transparent";
            });
            clearBtn.addEventListener("click", () => {
                searchInput.value = "";
                searchQuery = "";
                isSearching = false;
                clearBtn.style.display = "none";
                searchInput.focus();
                renderGallery();
            });
            searchWrapper.appendChild(clearBtn);
            rightCol.appendChild(searchWrapper);

            topRow.appendChild(rightCol);
            container.appendChild(topRow);

            // ---- 画廊网格 ----
            const gallery = document.createElement("div");
            gallery.className = "goohai-clothing-gallery";
            Object.assign(gallery.style, {
                display: "grid",
                gridTemplateColumns: `repeat(auto-fill, ${THUMB_W}px)`,
                justifyContent: "start",
                gap: `${GAP}px`,
                width: "100%",
                maxHeight: `${3 * THUMB_H + 2 * GAP}px`,
                overflowY: "auto",
                paddingRight: "2px",
                scrollbarWidth: "thin",
                scrollbarColor: "#555 transparent",
            });
            gallery.addEventListener("wheel", (e) => e.stopPropagation());
            container.appendChild(gallery);

            const scrollStyle = document.createElement("style");
            scrollStyle.textContent = `
                .goohai-clothing-gallery::-webkit-scrollbar { width: 6px; }
                .goohai-clothing-gallery::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
                .goohai-clothing-gallery::-webkit-scrollbar-track { background: transparent; }
            `;
            container.appendChild(scrollStyle);

            // ==================== 渲染左侧预览框 ====================

            function renderPreviewBox(firstItem) {
                previewBox.innerHTML = "";

                if (firstItem._kind === "none") {
                    const placeholder = document.createElement("div");
                    Object.assign(placeholder.style, {
                        width: "100%", height: "100%",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "#2d2d2d", color: "#888", fontSize: "16px",
                        borderRadius: `${BORDER_RADIUS - BORDER_HIGHLIGHT}px`,
                    });
                    placeholder.textContent = "无";
                    previewBox.appendChild(placeholder);
                    previewBox.appendChild(createSelectedBadge());
                } else {
                    const img = document.createElement("img");
                    img.src = `/goohai/id_photo_image/${encodeURIComponent(firstItem.category)}/${encodeURIComponent(firstItem.filename)}`;
                    Object.assign(img.style, {
                        width: "100%", height: "100%",
                        objectFit: "cover", display: "block",
                        borderRadius: `${BORDER_RADIUS - BORDER_HIGHLIGHT}px`,
                    });
                    img.onerror = function () {
                        this.style.display = "none";
                        const fb = document.createElement("div");
                        Object.assign(fb.style, {
                            width: "100%", height: "100%",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: "#333", color: "#999", fontSize: "11px",
                            padding: "4px", textAlign: "center",
                            borderRadius: `${BORDER_RADIUS - BORDER_HIGHLIGHT}px`,
                        });
                        fb.textContent = firstItem.title;
                        previewBox.appendChild(fb);
                    };
                    previewBox.appendChild(img);
                    previewBox.appendChild(createSelectedBadge());
                }

                previewBox.title = firstItem.prompt || firstItem.title || "";
            }

            // ==================== 渲染画廊 ====================

            function renderGallery() {
                gallery.innerHTML = "";
                const { items, poolCount } = buildDisplayList();

                // 更新左侧预览框（第一位置项）
                renderPreviewBox(items[0]);

                // 画廊从第二项开始渲染（跳过第一项）
                for (let i = 1; i < items.length; i++) {
                    const item = items[i];
                    const card = document.createElement("div");
                    const showBorder = item._isSel;

                    Object.assign(card.style, {
                        position: "relative", cursor: "pointer",
                        width: `${THUMB_W}px`,
                        height: `${THUMB_H}px`,
                        border: showBorder
                            ? `${BORDER_HIGHLIGHT}px solid #4CAF50`
                            : `1px solid transparent`,
                        borderRadius: `${BORDER_RADIUS}px`,
                        overflow: "hidden",
                        transition: "border-color .15s, transform .1s",
                        background: "#1e1e1e",
                        flexShrink: "0",
                    });
                    card.addEventListener("mouseenter", () => {
                        card.style.transform = "scale(1.03)";
                    });
                    card.addEventListener("mouseleave", () => {
                        card.style.transform = "scale(1)";
                    });

                    const img = document.createElement("img");
                    img.src = `/goohai/id_photo_image/${encodeURIComponent(item.category)}/${encodeURIComponent(item.filename)}`;
                    Object.assign(img.style, {
                        width: `${THUMB_W}px`,
                        height: `${THUMB_H}px`,
                        objectFit: "cover",
                        display: "block",
                        borderRadius: showBorder
                            ? `${BORDER_RADIUS - BORDER_HIGHLIGHT}px`
                            : `${BORDER_RADIUS}px`,
                    });
                    img.loading = "lazy";
                    img.onerror = function () {
                        this.style.display = "none";
                        const fb = document.createElement("div");
                        Object.assign(fb.style, {
                            width: `${THUMB_W}px`,
                            height: `${THUMB_H}px`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: "#333", color: "#999", fontSize: "11px",
                            padding: "4px", textAlign: "center",
                            borderRadius: showBorder
                                ? `${BORDER_RADIUS - BORDER_HIGHLIGHT}px`
                                : `${BORDER_RADIUS}px`,
                        });
                        fb.textContent = item.title;
                        card.appendChild(fb);
                    };
                    card.appendChild(img);

                    const label = document.createElement("div");
                    Object.assign(label.style, {
                        position: "absolute", bottom: "0", left: "0", right: "0",
                        background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
                        color: "#e0e0e0", fontSize: "10px",
                        padding: "8px 4px 3px", textAlign: "center",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        borderRadius: `0 0 ${BORDER_RADIUS}px ${BORDER_RADIUS}px`,
                    });
                    label.textContent = item.title;
                    card.appendChild(label);

                    if (isSearching && item._kind === "item") {
                        const badge = document.createElement("div");
                        Object.assign(badge.style, {
                            position: "absolute", top: "2px", left: "2px",
                            background: "rgba(0,0,0,0.7)", color: "#aaa",
                            fontSize: "9px", padding: "1px 4px", borderRadius: "2px",
                        });
                        badge.textContent = item.category;
                        card.appendChild(badge);
                    }

                    card.title = item.prompt || item.title;

                    if (item._isSel) {
                        card.appendChild(createCheckmark());
                        card.addEventListener("click", deselectAll);
                    } else {
                        card.addEventListener("click", () => selectTemplate(item));
                    }

                    gallery.appendChild(card);
                }

                // 搜索模式下，排除第一项后检查实际可显示的搜索结果数
                const galleryPoolCount = isSearching ? (poolCount > 0 ? poolCount : 0) : (poolCount > 0 ? poolCount - 0 : 0);
                if (isSearching && poolCount === 0) {
                    const noResult = document.createElement("div");
                    Object.assign(noResult.style, {
                        gridColumn: "1 / -1", textAlign: "center",
                        color: "#666", padding: "16px", fontSize: "12px",
                    });
                    noResult.textContent = "未找到匹配的模板";
                    gallery.appendChild(noResult);
                }
            }

            // ==================== 添加 DOM Widget ====================

            const galleryWidget = node.addDOMWidget("clothing_gallery", "div", container, {
                serialize: false,
            });

            galleryWidget.computeSize = () => [0, 0];

            if (promptWidget) {
                promptWidget.computeSize = () => [0, 0];
                if (promptWidget.element) {
                    promptWidget.element.style.display = "none";
                }
            }

            // ==================== 画廊高度自适应 ====================

            function getLayoutMetrics() {
                const TITLE_H = (typeof LiteGraph !== 'undefined' && LiteGraph.NODE_TITLE_HEIGHT) || 30;
                const SLOT_H = (typeof LiteGraph !== 'undefined' && LiteGraph.NODE_SLOT_HEIGHT) || 20;
                return { TITLE_H, SLOT_H };
            }

            // 容器内部除画廊以外的所有固定高度开销
            function getContainerFixedOverhead() {
                // container padding(8) + topRow(THUMB_H) + topRow marginBottom(6)
                return 8 + THUMB_H + 6;
            }

            let _lastAppliedMaxH = 0;

            function updateGalleryHeight() {
                const { TITLE_H, SLOT_H } = getLayoutMetrics();
                const nodeH = node.size[1];
                if (!nodeH || nodeH <= 0) return;

                const catH = SLOT_H;
                const avail = nodeH - TITLE_H - catH - getContainerFixedOverhead() - BOTTOM_PAD;
                const minH = THUMB_H + GAP;
                const maxH = Math.max(minH, avail);

                if (Math.abs(maxH - _lastAppliedMaxH) < 1) return;
                _lastAppliedMaxH = maxH;

                gallery.style.maxHeight = maxH + "px";
            }

            // ---- onResize 钩子 ----
            const origOnResize = node.onResize;
            node.onResize = function (size) {
                if (origOnResize) origOnResize.call(node, size);
                requestAnimationFrame(updateGalleryHeight);
            };

            // ---- 轮询兜底 ----
            const _pollId = setInterval(() => {
                if (!node.graph) { clearInterval(_pollId); return; }
                updateGalleryHeight();
            }, 200);

            // ==================== 同步外部值变化 ====================

            let _lastSyncedValue = promptWidget?.value || "";
            const _syncPollId = setInterval(() => {
                if (!node.graph) { clearInterval(_syncPollId); return; }
                const current = promptWidget?.value || "";
                if (current !== _lastSyncedValue) {
                    _lastSyncedValue = current;
                    promptArea.value = current;
                }
            }, 300);

            // ==================== 恢复已保存状态 ====================

            function restoreState() {
                const saved = promptWidget?.value || "";
                if (!saved) return;

                for (const cat of allCategories) {
                    const tpl = (allTemplates[cat] || []).find(t => t.prompt === saved);
                    if (tpl) {
                        selectedCategory = cat;
                        selectedFilename = tpl.filename;
                        selectedPrompt = tpl.prompt;
                        currentCategory = cat;
                        if (catWidget) catWidget.value = cat;
                        promptArea.value = selectedPrompt;
                        _lastSyncedValue = selectedPrompt;
                        renderGallery();
                        return;
                    }
                }
            }

            // ==================== 初始化 ====================

            restoreState();

            if (!promptWidget?.value) {
                const defaultList = allTemplates[defaultCat] || [];
                if (defaultList.length > 0) {
                    selectedCategory = defaultCat;
                    //默认选择第5张
                    selectedFilename = defaultList[4].filename;
                    //默认选择第5张
                    selectedPrompt = defaultList[4].prompt;
                }
                syncPrompt();
            }

            renderGallery();

            // 首次打开时固定节点大小
            setTimeout(() => {
                const { TITLE_H, SLOT_H } = getLayoutMetrics();
                const defaultGalleryH = 3 * THUMB_H + 2 * GAP;
                const nodeSize = node.computeSize();
                const targetW = Math.max(nodeSize[0], GALLERY_WIDTH + 40);
                const targetH = TITLE_H + SLOT_H + getContainerFixedOverhead() + defaultGalleryH + BOTTOM_PAD;

                gallery.style.maxHeight = defaultGalleryH + "px";
                node.setSize([targetW, targetH]);
                updateGalleryHeight();
            }, 100);
        };
    },
});
