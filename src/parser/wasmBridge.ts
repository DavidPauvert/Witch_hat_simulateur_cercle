// Bridge to AssemblyScript WASM module
const ENABLE_WASM = true;

let wasmModule: any = null;

export const initWasm = async () => {
    if (!ENABLE_WASM) return;
    if (wasmModule) return;
    try {
        wasmModule = await import('../../build/release.js');
    } catch (e) {
        console.error('[WASM] Failed to load WASM module:', e);
    }
};

export const isWasmReady = () => !!wasmModule;

export function wasmFitCircle(points: number[]): { center: { x: number, y: number }, radius: number } | null {
  if (!wasmModule) return null;

  const floatPoints = new Float64Array(points);
  const result = wasmModule.fitCircle(floatPoints);

  if (result[2] <= 0) return null;

  return {
    center: { x: result[0], y: result[1] },
    radius: result[2]
  };
}

export function wasmRenderInkLayers(
  flatPoints: number[],
  size: number,
  coreRadius: number,
  softRadius: number,
  looseRadius: number
): { core: Uint8Array, soft: Uint8Array, loose: Uint8Array } | null {
    if (!wasmModule) return null;
    
    const floatPoints = new Float64Array(flatPoints);
    const result = wasmModule.renderInkLayers(floatPoints, size, coreRadius, softRadius, looseRadius);
    
    const layerSize = size * size;
    return {
        core: result.subarray(0, layerSize),
        soft: result.subarray(layerSize, layerSize * 2),
        loose: result.subarray(layerSize * 2, layerSize * 3)
    };
}

export function wasmCountInk(mask: Uint8Array): number {
  if (!wasmModule) {
      let ink = 0;
      for (const pixel of mask) ink += pixel;
      return ink;
  }
  return wasmModule.countInk(mask);
}

export function wasmMaskOverlap(a: Uint8Array, b: Uint8Array): number {
  if (!wasmModule) {
      let overlap = 0;
      for (let i = 0; i < a.length; i++) if (a[i] && b[i]) overlap++;
      return overlap;
  }
  return wasmModule.maskOverlap(a, b);
}

export function wasmOccupiedCells(mask: Uint8Array, size: number, gridSize: number): Uint8Array {
  if (!wasmModule) {
      const cells = new Uint8Array(gridSize * gridSize);
      for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
              if (!mask[y * size + x]) continue;
              const cellX = Math.min(gridSize - 1, Math.floor((x / size) * gridSize));
              const cellY = Math.min(gridSize - 1, Math.floor((y / size) * gridSize));
              cells[cellY * gridSize + cellX] = 1;
          }
      }
      return cells;
  }
  return wasmModule.occupiedCells(mask, size, gridSize);
}
