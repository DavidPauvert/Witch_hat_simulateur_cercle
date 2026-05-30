// Bridge to AssemblyScript WASM module
const ENABLE_WASM = true;

let wasmModule: any = null;

/**
 * Asynchronously initializes and loads the AssemblyScript WebAssembly module.
 * If WASM is disabled or already loaded, this function does nothing.
 */
export const initWasm = async () => {
    if (!ENABLE_WASM) return;
    if (wasmModule) return;
    try {
        wasmModule = await import('../../build/release.js');
    } catch (e) {
        console.error('[WASM] Failed to load WASM module:', e);
    }
};

/** Checks if the WebAssembly module has been successfully initialized. */
export const isWasmReady = () => !!wasmModule;

/**
 * Offloads circle fitting logic to WASM for high-performance geometric analysis.
 *
 * @param points - Flattened array of [x, y, x, y, ...] coordinates.
 * @returns An object with center and radius, or null if the fit is invalid.
 */
export function wasmFitCircle(
    points: number[],
): { center: { x: number; y: number }; radius: number } | null {
    if (!wasmModule) return null;

    const floatPoints = new Float64Array(points);
    const result = wasmModule.fitCircle(floatPoints);

    if (result[2] <= 0) return null;

    return {
        center: { x: result[0], y: result[1] },
        radius: result[2],
    };
}

/**
 * Offloads stroke rasterization to WASM. It renders thin, medium, and thick versions
 * of the stroke paths simultaneously into a single flat buffer.
 *
 * @param flatPoints - Flattened array of coordinates with NaN separators between strokes.
 * @param size - Resolution of each layer (width/height).
 * @param coreRadius - Radius for the thin layer.
 * @param softRadius - Radius for the medium layer.
 * @param looseRadius - Radius for the thick layer.
 * @returns An object containing three Uint8Array masks.
 */
export function wasmRenderInkLayers(
    flatPoints: number[],
    size: number,
    coreRadius: number,
    softRadius: number,
    looseRadius: number,
): { core: Uint8Array; soft: Uint8Array; loose: Uint8Array } | null {
    if (!wasmModule) return null;

    const floatPoints = new Float64Array(flatPoints);
    const result = wasmModule.renderInkLayers(
        floatPoints,
        size,
        coreRadius,
        softRadius,
        looseRadius,
    );

    const layerSize = size * size;
    // The WASM function returns one giant buffer; we split it back into three logical layers.
    return {
        core: result.subarray(0, layerSize),
        soft: result.subarray(layerSize, layerSize * 2),
        loose: result.subarray(layerSize * 2, layerSize * 3),
    };
}

/** Counts non-zero pixels in a bitmap. Falls back to a slow JS loop if WASM is unavailable. */
export function wasmCountInk(mask: Uint8Array): number {
    if (!wasmModule) {
        let ink = 0;
        for (const pixel of mask) ink += pixel;
        return ink;
    }
    return wasmModule.countInk(mask);
}

/** Counts overlapping pixels between two bitmaps. Falls back to slow JS loop if needed. */
export function wasmMaskOverlap(a: Uint8Array, b: Uint8Array): number {
    if (!wasmModule) {
        let overlap = 0;
        for (let i = 0; i < a.length; i++) if (a[i] && b[i]) overlap++;
        return overlap;
    }
    return wasmModule.maskOverlap(a, b);
}

/**
 * Downsamples a high-resolution bitmap into a smaller occupancy grid.
 * Used for regional feature comparison in the recognizer.
 *
 * @param mask - The high-res input mask.
 * @param size - Original resolution.
 * @param gridSize - Target downsampled resolution.
 * @returns A Uint8Array of size gridSize * gridSize.
 */
export function wasmOccupiedCells(
    mask: Uint8Array,
    size: number,
    gridSize: number,
): Uint8Array {
    if (!wasmModule) {
        const cells = new Uint8Array(gridSize * gridSize);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (!mask[y * size + x]) continue;
                const cellX = Math.min(
                    gridSize - 1,
                    Math.floor((x / size) * gridSize),
                );
                const cellY = Math.min(
                    gridSize - 1,
                    Math.floor((y / size) * gridSize),
                );
                cells[cellY * gridSize + cellX] = 1;
            }
        }
        return cells;
    }
    return wasmModule.occupiedCells(mask, size, gridSize);
}

/**
 * Computes a distance transform of a mask using WASM.
 *
 * @param mask - The input binary mask.
 * @param size - Resolution of the mask.
 * @returns A Float32Array containing distance values.
 */
export function wasmDistanceTransform(
    mask: Uint8Array,
    size: number,
): Float32Array | null {
    if (!wasmModule) return null;
    return wasmModule.distanceTransform(mask, size);
}

/**
 * Calculates the average distance between two shapes using Chamfer Matching in WASM.
 *
 * @param maskA - The candidate mask.
 * @param dtB - The distance transform of the reference template mask.
 * @returns The average distance score (lower is better).
 */
export function wasmChamferDistance(
    maskA: Uint8Array,
    dtB: Float32Array,
): number {
    if (!wasmModule) return 10000;
    return wasmModule.chamferDistance(maskA, dtB);
}
