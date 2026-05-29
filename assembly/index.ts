// AssemblyScript implementation of heavy math functions

/**
 * Fits a circle to a set of points using least squares.
 * points: [x1, y1, x2, y2, ...]
 */
export function fitCircle(points: Float64Array): Float64Array {
  const count = points.length / 2;
  const result = new Float64Array(3); // [centerX, centerY, radius]

  if (count < 8) return result;

  let sumX: f64 = 0.0;
  let sumY: f64 = 0.0;
  let sumX2: f64 = 0.0;
  let sumY2: f64 = 0.0;
  let sumXY: f64 = 0.0;
  let sumX3: f64 = 0.0;
  let sumY3: f64 = 0.0;
  let sumX2Y: f64 = 0.0;
  let sumXY2: f64 = 0.0;

  for (let i = 0; i < count; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const x2 = x * x;
    const y2 = y * y;
    sumX += x;
    sumY += y;
    sumX2 += x2;
    sumY2 += y2;
    sumXY += x * y;
    sumX3 += x2 * x;
    sumY3 += y2 * y;
    sumX2Y += x2 * y;
    sumXY2 += x * y2;
  }

  const matrix0 = [sumX2, sumXY, sumX];
  const matrix1 = [sumXY, sumY2, sumY];
  const matrix2 = [sumX, sumY, f64(count)];
  
  const matrix = [matrix0, matrix1, matrix2];
  const vector = [sumX3 + sumXY2, sumX2Y + sumY3, sumX2 + sumY2];

  const solved = solve3(matrix, vector);
  if (!solved) return result;

  const a = solved[0];
  const b = solved[1];
  const c = solved[2];

  const centerX = a / 2.0;
  const centerY = b / 2.0;
  const radiusSquared = c + centerX * centerX + centerY * centerY;

  if (radiusSquared <= 0) return result;

  result[0] = centerX;
  result[1] = centerY;
  result[2] = Math.sqrt(radiusSquared);
  return result;
}

function solve3(matrix: f64[][], vector: f64[]): f64[] | null {
  const a0 = [matrix[0][0], matrix[0][1], matrix[0][2], vector[0]];
  const a1 = [matrix[1][0], matrix[1][1], matrix[1][2], vector[1]];
  const a2 = [matrix[2][0], matrix[2][1], matrix[2][2], vector[2]];
  
  const a = [a0, a1, a2];

  for (let column = 0; column < 3; column++) {
    let pivot = column;
    for (let row = column + 1; row < 3; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot][column]) < 1e-8) {
      return null;
    }

    const temp = a[column];
    a[column] = a[pivot];
    a[pivot] = temp;

    const divisor = a[column][column];
    for (let item = column; item < 4; item++) {
      a[column][item] /= divisor;
    }

    for (let row = 0; row < 3; row++) {
      if (row === column) continue;
      const factor = a[row][column];
      for (let item = column; item < 4; item++) {
        a[row][item] -= factor * a[column][item];
      }
    }
  }

  return [a[0][3], a[1][3], a[2][3]];
}

/**
 * Marks a circular area on a mask.
 */
function markMask(mask: Uint8Array, size: i32, x: f64, y: f64, radius: f64): void {
  const centerX = i32(Math.round(x * f64(size - 1)));
  const centerY = i32(Math.round(y * f64(size - 1)));
  const radiusSq = radius * radius;
  const iRadius = i32(Math.ceil(radius));

  for (let offsetY = -iRadius; offsetY <= iRadius; offsetY++) {
    for (let offsetX = -iRadius; offsetX <= iRadius; offsetX++) {
      const distSq = f64(offsetX * offsetX + offsetY * offsetY);
      if (distSq > radiusSq + 0.0001) continue;

      const pixelX = centerX + offsetX;
      const pixelY = centerY + offsetY;
      if (pixelX >= 0 && pixelX < size && pixelY >= 0 && pixelY < size) {
        mask[pixelY * size + pixelX] = 1;
      }
    }
  }
}

/**
 * Renders multiple ink layers for a set of strokes.
 * returns [coreMask, softMask, looseMask] as a single flat array or similar.
 * For simplicity, we'll return a single Uint8Array containing all 3 layers concatenated.
 */
export function renderInkLayers(
  flatPoints: Float64Array, // [x1, y1, x2, y2, ..., NaN, NaN, ...]
  size: i32,
  coreRadius: f64,
  softRadius: f64,
  looseRadius: f64
): Uint8Array {
  const layerSize = size * size;
  const result = new Uint8Array(layerSize * 3);
  
  const coreMask = result.subarray(0, layerSize);
  const softMask = result.subarray(layerSize, layerSize * 2);
  const looseMask = result.subarray(layerSize * 2, layerSize * 3);

  let i = 0;
  const len = flatPoints.length;
  
  while (i < len) {
    let startX = flatPoints[i++];
    let startY = flatPoints[i++];
    
    if (isNaN(startX)) continue;

    // First point of stroke
    markMask(coreMask, size, startX, startY, coreRadius);
    markMask(softMask, size, startX, startY, softRadius);
    markMask(looseMask, size, startX, startY, looseRadius);

    while (i < len) {
      const nextX = flatPoints[i++];
      const nextY = flatPoints[i++];
      
      if (isNaN(nextX)) break; // End of stroke

      // Draw segment from (startX, startY) to (nextX, nextY)
      const dx = nextX - startX;
      const dy = nextY - startY;
      const steps = i32(Math.max(1.0, Math.ceil(Math.sqrt(dx * dx + dy * dy) * f64(size) * 2.0)));

      for (let step = 1; step <= steps; step++) {
        const local = f64(step) / f64(steps);
        const px = startX + dx * local;
        const py = startY + dy * local;
        
        markMask(coreMask, size, px, py, coreRadius);
        markMask(softMask, size, px, py, softRadius);
        markMask(looseMask, size, px, py, looseRadius);
      }
      
      startX = nextX;
      startY = nextY;
    }
  }

  return result;
}

export function countInk(mask: Uint8Array): i32 {
  let ink: i32 = 0;
  for (let i = 0, len = mask.length; i < len; i++) {
    if (mask[i]) ink++;
  }
  return ink;
}

export function maskOverlap(a: Uint8Array, b: Uint8Array): i32 {
  let overlap: i32 = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] && b[i]) overlap++;
  }
  return overlap;
}

export function occupiedCells(mask: Uint8Array, size: i32, gridSize: i32): Uint8Array {
  const cells = new Uint8Array(gridSize * gridSize);
  const sizeF = f64(size);
  const gridSizeF = f64(gridSize);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (!mask[idx]) continue;
      
      const cellX = i32(Math.floor((f64(x) / sizeF) * gridSizeF));
      const cellY = i32(Math.floor((f64(y) / sizeF) * gridSizeF));
      
      const clampedX = cellX < 0 ? 0 : (cellX >= gridSize ? gridSize - 1 : cellX);
      const clampedY = cellY < 0 ? 0 : (cellY >= gridSize ? gridSize - 1 : cellY);
      
      const cellIdx: i32 = clampedY * gridSize + clampedX;
      cells[cellIdx] = 1;
    }
  }
  return cells;
}
