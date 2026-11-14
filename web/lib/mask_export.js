const inWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;

const pngCrcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

export function writeU32(out, offset, value) {
    new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(offset, value);
}

export function pngChunk(type, data = new Uint8Array()) {
    const out = new Uint8Array(12 + data.length);
    writeU32(out, 0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    let crc = 0xffffffff;
    for (let i = 4; i < out.length - 4; i++) crc = pngCrcTable[(crc ^ out[i]) & 0xff] ^ (crc >>> 8);
    writeU32(out, out.length - 4, (crc ^ 0xffffffff) >>> 0);
    return out;
}

export async function deflateBytes(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function rgbaToPngBlob(rgba, width, height, extraChunks = []) {
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    const ihdr = new Uint8Array(13);
    writeU32(ihdr, 0, width);
    writeU32(ihdr, 4, height);
    ihdr[8] = 8;
    ihdr[9] = 6;
    // Blob parts avoid copying the entire encoded PNG again.
    return new Blob([
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", ihdr), ...extraChunks,
        pngChunk("IDAT", await deflateBytes(raw)), pngChunk("IEND"),
    ], { type: "image/png" });
}

function canvas(width, height) {
    if (inWorker) return new OffscreenCanvas(width, height);
    const result = document.createElement("canvas");
    result.width = width; result.height = height;
    return result;
}

function canvasBlob(image) {
    return inWorker ? image.convertToBlob({ type: "image/png" })
        : new Promise((resolve) => image.toBlob(resolve, "image/png"));
}

async function buildMaskImages({ source, paint, rawMask, savePaint, width, height, mode, preserveRgbUnderMask, colorChunk }, previewReady) {
    const output = canvas(width, height);
    const ctx = output.getContext("2d");
    ctx.drawImage(source, 0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    if (mode === "color") ctx.drawImage(paint, 0, 0, width, height);

    // Only the small editor mask needs a pixel scan for the green preview.
    if (mode === "original") {
        const layer = canvas(savePaint.width, savePaint.height);
        const layerCtx = layer.getContext("2d");
        layerCtx.drawImage(savePaint, 0, 0);
        const pixels = layerCtx.getImageData(0, 0, layer.width, layer.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
            pixels.data[i] = 42; pixels.data[i + 1] = 210; pixels.data[i + 2] = 112;
            pixels.data[i + 3] = pixels.data[i + 3] > 5 ? 128 : 0;
        }
        layerCtx.putImageData(pixels, 0, 0);
        ctx.drawImage(layer, 0, 0, width, height);
        previewReady(await canvasBlob(output));
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(source, 0, 0, width, height);
    } else {
        previewReady(await canvasBlob(output));
    }

    const outputData = ctx.getImageData(0, 0, width, height).data;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    if (!preserveRgbUnderMask) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(rawMask, 0, 0, width, height);
        ctx.globalCompositeOperation = "source-over";
    }
    const maskedData = ctx.getImageData(0, 0, width, height).data;
    const small = canvas(rawMask.width, rawMask.height);
    const smallCtx = small.getContext("2d");
    smallCtx.drawImage(rawMask, 0, 0);
    const raw = smallCtx.getImageData(0, 0, small.width, small.height).data;
    smallCtx.clearRect(0, 0, small.width, small.height);
    smallCtx.drawImage(savePaint, 0, 0);
    const mask = smallCtx.getImageData(0, 0, small.width, small.height).data;
    const offsets = new Uint32Array(width);
    for (let x = 0; x < width; x++) offsets[x] = Math.min(small.width - 1, Math.floor(x * small.width / width)) * 4;
    // Merge both exports in one pass, sampling the editor mask without a full-size mask buffer.
    for (let y = 0; y < height; y++) {
        const row = Math.min(small.height - 1, Math.floor(y * small.height / height)) * small.width * 4;
        for (let x = 0, i = y * width * 4; x < width; x++, i += 4) {
            const ri = row + offsets[x];
            if (mask[ri + 3] > 5) outputData[i + 3] = 0;
            if (preserveRgbUnderMask && maskedData[i + 3] < 250) {
                maskedData[i] = maskedData[i + 1] = maskedData[i + 2] = 255;
            }
            if (raw[ri + 3] > 5) {
                maskedData[i] = raw[ri]; maskedData[i + 1] = raw[ri + 1]; maskedData[i + 2] = raw[ri + 2];
                maskedData[i + 3] = 1;
            }
        }
        if (!inWorker && y % 128 === 127) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const outputBlob = await rgbaToPngBlob(outputData, width, height);
    const maskedBlob = await rgbaToPngBlob(maskedData, width, height, colorChunk ? [colorChunk] : []);
    return { outputBlob, maskedBlob };
}

export function exportMaskImages(options) {
    let resolvePreview, rejectPreview;
    const preview = new Promise((resolve, reject) => { resolvePreview = resolve; rejectPreview = reject; });
    // Callers may only consume the file task after an early failure.
    preview.catch(() => {});
    const files = (async () => {
        if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function") {
            return buildMaskImages(options, resolvePreview);
        }
        let worker;
        const bitmaps = [];
        try {
            const message = { ...options };
            for (const key of ["source", "paint", "rawMask", "savePaint"]) {
                message[key] = await createImageBitmap(options[key]);
                bitmaps.push(message[key]);
            }
            worker = new Worker(new URL("./mask_export.js", import.meta.url), { type: "module" });
            return await new Promise((resolve, reject) => {
                worker.onmessage = ({ data }) => {
                    if (data.error) reject(new Error(data.error));
                    else if (data.preview) resolvePreview(data.preview);
                    else resolve(data);
                };
                worker.onerror = (event) => reject(new Error(event.message || "Mask export worker failed"));
                worker.postMessage(message, bitmaps);
            });
        } finally {
            worker?.terminate();
            bitmaps.forEach((bitmap) => bitmap.close());
        }
    })().catch((error) => { rejectPreview(error); throw error; });
    return { preview, files };
}

if (inWorker) self.onmessage = async ({ data }) => {
    try {
        self.postMessage(await buildMaskImages(data, (preview) => self.postMessage({ preview })));
    } catch (error) {
        self.postMessage({ error: error.message });
    } finally {
        for (const key of ["source", "paint", "rawMask", "savePaint"]) data[key].close();
    }
};
