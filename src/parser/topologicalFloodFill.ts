import {
    boundsForStrokes,
    clamp,
    distance,
    mean,
    stddev,
} from '../utils/geometry';
import { Point, Stroke, AppConfig, Bounds } from '../types';

const MAX_NORMALIZED_RMSE = 0.18;
const MIN_PERFECTION = 0.28;
const CELL_SIZE_PX = 1;
const PADDING_PX = 18;
const STROKE_RADIUS_PX = 3;
const STROKE_SAMPLE_STEP_PX = 0.75;
const MIN_ENCLOSED_AREA_PX = 3500;
const MIN_ENCLOSED_AREA_RATIO = 0.08;

export interface Raster {
    width: number;
    height: number;
    size: number;
    offsetX: number;
    offsetY: number;
    cellSize: number;
    sourceBounds: Bounds;
    blocked: Uint8Array;
    water: Uint8Array;
    outsideEdge: Uint8Array;
    strokeIdsByCell: Set<string>[];
}

export interface TopologicalClosureResult {
    closed: boolean;
    enclosedAreaPx: number;
    minEnclosedAreaPx: number;
    componentCount: number;
    center?: Point;
    radius?: number;
    rmse?: number;
    normalizedRmse?: number;
    perfection?: number;
    edgePixelCount: number;
    edgePixels?: Point[];
    strokeIds: string[];
    raster: {
        width: number;
        height: number;
        cellSize: number;
        offsetX: number;
        offsetY: number;
        blockedPixelCount: number;
        waterPixelCount: number;
        dryPixelCount: number;
    };
}

/**
 * Calculates the world-space center coordinates for a specific grid cell in the raster.
 *
 * @param index - The flat index of the cell in the raster grid.
 * @param raster - The raster metadata.
 * @returns A Point object with x and y coordinates.
 */
function cellCenter(index: number, raster: Raster): Point {
    const x = index % raster.width;
    const y = Math.floor(index / raster.width);
    return {
        x: raster.offsetX + (x + 0.5) * raster.cellSize,
        y: raster.offsetY + (y + 0.5) * raster.cellSize,
    };
}

/**
 * Creates and initializes a Raster structure based on the bounding box of the strokes.
 * It automatically adjusts the cell size (resolution) to stay within performance limits.
 *
 * @param strokes - The strokes to be rasterized.
 * @param config - Application configuration for performance limits.
 * @returns A new Raster object.
 */
function createRaster(strokes: Stroke[], config: AppConfig): Raster {
    const strokeRadius = STROKE_RADIUS_PX;
    // Add padding to ensure the flood fill can completely surround the drawing.
    const padding = PADDING_PX + strokeRadius + 2;
    const sourceBounds = boundsForStrokes(strokes);
    const offsetX_raw = Math.floor(sourceBounds.minX - padding);
    const offsetY_raw = Math.floor(sourceBounds.minY - padding);
    const maxX_raw = Math.ceil(sourceBounds.maxX + padding);
    const maxY_raw = Math.ceil(sourceBounds.maxY + padding);

    const rawWidth = Math.max(3, maxX_raw - offsetX_raw + 1);
    const rawHeight = Math.max(3, maxY_raw - offsetY_raw + 1);

    let cellSize = CELL_SIZE_PX;
    const maxArea = config.limits.maxRasterArea;

    // Complex: Adaptive Resolution Scaling.
    // If the drawing is very large, a 1px grid would consume too much memory/CPU.
    // We increase the cellSize (decreasing resolution) so the total number of cells
    // stays within the `maxRasterArea` limit.
    if (rawWidth * rawHeight > maxArea) {
        const targetArea = maxArea * 0.9;
        const scale = Math.sqrt(targetArea / (rawWidth * rawHeight));
        cellSize = CELL_SIZE_PX / scale;
    }

    const offsetX = offsetX_raw;
    const offsetY = offsetY_raw;
    const width = Math.max(3, Math.ceil((maxX_raw - offsetX) / cellSize) + 1);
    const height = Math.max(3, Math.ceil((maxY_raw - offsetY) / cellSize) + 1);
    const size = width * height;

    return {
        width,
        height,
        size,
        offsetX,
        offsetY,
        cellSize,
        sourceBounds,
        blocked: new Uint8Array(size),
        water: new Uint8Array(size),
        outsideEdge: new Uint8Array(size),
        strokeIdsByCell: Array.from({ length: size }, () => new Set<string>()),
    };
}

/** Converts grid coordinates to a flat index. */
function gridIndex(x: number, y: number, width: number): number {
    return y * width + x;
}

/** Marks a cell as "blocked" by ink and records which stroke passed through it. */
function markBlockedCell(
    raster: Raster,
    x: number,
    y: number,
    strokeId: string,
): void {
    if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) {
        return;
    }
    const index = gridIndex(x, y, raster.width);
    raster.blocked[index] = 1;
    raster.strokeIdsByCell[index].add(strokeId);
}

/**
 * Renders a circular "disk" of ink onto the raster grid.
 *
 * @param raster - The raster to draw on.
 * @param point - The center of the disk.
 * @param radiusPx - The radius of the disk in world pixels.
 * @param strokeId - The ID of the stroke being rendered.
 */
function markInkDisk(
    raster: Raster,
    point: Point,
    radiusPx: number,
    strokeId: string,
): void {
    const gx = (point.x - raster.offsetX) / raster.cellSize;
    const gy = (point.y - raster.offsetY) / raster.cellSize;
    const radius = radiusPx / raster.cellSize;
    const minX = Math.floor(gx - radius);
    const maxX = Math.ceil(gx + radius);
    const minY = Math.floor(gy - radius);
    const maxY = Math.ceil(gy + radius);
    const radiusSquared = radius * radius;

    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const dx = x + 0.5 - gx;
            const dy = y + 0.5 - gy;
            // Standard circle equation: x^2 + y^2 <= r^2
            if (dx * dx + dy * dy <= radiusSquared) {
                markBlockedCell(raster, x, y, strokeId);
            }
        }
    }
}

/**
 * Transforms vector strokes (arrays of points) into a bitmap grid.
 * This "thickens" the lines to ensure there are no gaps for the flood fill to leak through.
 */
function rasterizeStrokes(strokes: Stroke[], raster: Raster): void {
    const sampleStep = STROKE_SAMPLE_STEP_PX;
    const strokeRadius = STROKE_RADIUS_PX;

    for (const stroke of strokes) {
        if (!stroke.points?.length) {
            continue;
        }
        markInkDisk(raster, stroke.points[0], strokeRadius, stroke.id);
        for (let index = 1; index < stroke.points.length; index += 1) {
            const previous = stroke.points[index - 1];
            const current = stroke.points[index];
            const segmentLength = distance(previous, current);
            const steps = Math.max(1, Math.ceil(segmentLength / sampleStep));
            // Linear interpolation between stroke points to ensure a continuous line.
            for (let step = 1; step <= steps; step += 1) {
                const t = step / steps;
                markInkDisk(
                    raster,
                    {
                        x: previous.x + (current.x - previous.x) * t,
                        y: previous.y + (current.y - previous.y) * t,
                    },
                    strokeRadius,
                    stroke.id,
                );
            }
        }
    }
}

/** Utility to add a cell to the flood-fill queue if it hasn't been visited yet. */
function enqueueWater(
    index: number,
    raster: Raster,
    queueState: { queue: Int32Array; head: number; tail: number },
): void {
    if (raster.blocked[index] || raster.water[index]) {
        return;
    }
    raster.water[index] = 1;
    queueState.queue[queueState.tail] = index;
    queueState.tail += 1;
}

/**
 * Performs a BFS flood-fill from all edges of the grid.
 * This identifies all areas that are "reachable" from the outside.
 * Any areas that are NOT reached (and not ink) are considered "enclosed".
 */
function floodExterior(raster: Raster): void {
    const queueState = {
        queue: new Int32Array(raster.size),
        head: 0,
        tail: 0,
    };

    // Seed the flood from all four boundaries of the grid.
    for (let x = 0; x < raster.width; x += 1) {
        enqueueWater(gridIndex(x, 0, raster.width), raster, queueState);
        enqueueWater(
            gridIndex(x, raster.height - 1, raster.width),
            raster,
            queueState,
        );
    }
    for (let y = 1; y < raster.height - 1; y += 1) {
        enqueueWater(gridIndex(0, y, raster.width), raster, queueState);
        enqueueWater(
            gridIndex(raster.width - 1, y, raster.width),
            raster,
            queueState,
        );
    }

    const directions: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];

    while (queueState.head < queueState.tail) {
        const index = queueState.queue[queueState.head];
        queueState.head += 1;
        const x = index % raster.width;
        const y = Math.floor(index / raster.width);

        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= raster.width || ny >= raster.height) {
                continue;
            }
            const neighbor = gridIndex(nx, ny, raster.width);
            if (raster.blocked[neighbor]) {
                // If we hit ink, mark it as an "outside edge".
                raster.outsideEdge[neighbor] = 1;
            } else {
                enqueueWater(neighbor, raster, queueState);
            }
        }
    }
}

/**
 * Finds contiguous groups of "dry" cells (not ink, not water).
 * These represent holes or enclosed regions within the drawing.
 *
 * @returns The number of components found and the indices of the largest one.
 */
function findDryComponents(raster: Raster): {
    componentCount: number;
    largest: number[];
} {
    const visited = new Uint8Array(raster.size);
    const queue = new Int32Array(raster.size);
    const directions: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    let componentCount = 0;
    let largest: number[] = [];

    for (let start = 0; start < raster.size; start += 1) {
        // Skip ink, already-flooded areas, or already-visited dry areas.
        if (raster.blocked[start] || raster.water[start] || visited[start]) {
            continue;
        }

        componentCount += 1;
        const cells: number[] = [];
        let head = 0;
        let tail = 0;
        visited[start] = 1;
        queue[tail] = start;
        tail += 1;

        while (head < tail) {
            const index = queue[head];
            head += 1;
            cells.push(index);
            const x = index % raster.width;
            const y = Math.floor(index / raster.width);

            for (const [dx, dy] of directions) {
                const nx = x + dx;
                const ny = y + dy;
                if (
                    nx < 0 ||
                    ny < 0 ||
                    nx >= raster.width ||
                    ny >= raster.height
                ) {
                    continue;
                }
                const neighbor = gridIndex(nx, ny, raster.width);
                if (
                    !raster.blocked[neighbor] &&
                    !raster.water[neighbor] &&
                    !visited[neighbor]
                ) {
                    visited[neighbor] = 1;
                    queue[tail] = neighbor;
                    tail += 1;
                }
            }
        }

        if (cells.length > largest.length) {
            largest = cells;
        }
    }

    return {
        componentCount,
        largest,
    };
}

/**
 * Identifies the set of world-space points and original strokes that form the boundary
 * between the exterior "water" and the interior "dry" land.
 */
function collectOutsideEdge(raster: Raster): {
    edgePixels: Point[];
    strokeIds: string[];
} {
    const edgePixels: Point[] = [];
    const strokeIds = new Set<string>();

    for (let index = 0; index < raster.size; index += 1) {
        if (!raster.outsideEdge[index]) {
            continue;
        }
        edgePixels.push(cellCenter(index, raster));
        for (const strokeId of raster.strokeIdsByCell[index]) {
            strokeIds.add(strokeId);
        }
    }

    return {
        edgePixels,
        strokeIds: [...strokeIds],
    };
}

/**
 * Checks how "circular" the boundary of the enclosed area is.
 *
 * @param edgePixels - The boundary pixels of the enclosed region.
 * @returns Geometric metrics: center, radius, and perfection score.
 */
function scoreCircle(edgePixels: Point[]): {
    center: Point;
    radius: number;
    rmse: number;
    normalizedRmse: number;
    perfection: number;
} {
    if (edgePixels.length < 8) {
        return {
            center: { x: 0, y: 0 },
            radius: 0,
            rmse: Infinity,
            normalizedRmse: Infinity,
            perfection: 0,
        };
    }

    const center = {
        x: mean(edgePixels.map((point) => point.x)),
        y: mean(edgePixels.map((point) => point.y)),
    };
    const distances = edgePixels.map((point) => distance(point, center));
    const radius = mean(distances);

    // Root Mean Square Error (RMSE) measures the average distance of pixels from the ideal circle perimeter.
    const rmse = stddev(distances);
    const normalizedRmse = rmse / Math.max(1, radius);
    // Perfection is a 0-1 score where 1 is a mathematically perfect circle.
    const perfection = clamp(1 - normalizedRmse / MAX_NORMALIZED_RMSE);

    return {
        center,
        radius,
        rmse,
        normalizedRmse,
        perfection,
    };
}

/** Simple utility to count truthy values in a byte array. */
function countCells(mask: Uint8Array): number {
    let count = 0;
    for (const value of mask) {
        count += value ? 1 : 0;
    }
    return count;
}

/**
 * Core algorithm for detecting hand-drawn closed shapes (like the spell circle).
 * It uses a grid-based topological analysis:
 * 1. Rasterize strokes onto a grid.
 * 2. Flood-fill the grid from the outside.
 * 3. Identify any "bubbles" (enclosed dry areas).
 * 4. Verify if the bubble is large enough and circular enough.
 *
 * This approach is extremely robust to overlapping strokes, small gaps (due to raster thickening),
 * and complex drawing orders.
 *
 * @param strokes - The strokes to analyze.
 * @param config - Application configuration.
 * @returns Detailed result indicating if a closure was found and its geometric properties.
 */
export function analyzeTopologicalClosure(
    strokes: Stroke[],
    config: AppConfig,
): TopologicalClosureResult {
    if (!strokes.length) {
        return {
            closed: false,
            enclosedAreaPx: 0,
            minEnclosedAreaPx: 0,
            componentCount: 0,
            edgePixelCount: 0,
            strokeIds: [],
            raster: {
                width: 0,
                height: 0,
                cellSize: 0,
                offsetX: 0,
                offsetY: 0,
                blockedPixelCount: 0,
                waterPixelCount: 0,
                dryPixelCount: 0,
            },
        };
    }

    const raster = createRaster(strokes, config);
    rasterizeStrokes(strokes, raster);
    floodExterior(raster);

    const dry = findDryComponents(raster);
    // Calculate the physical area of the largest hole.
    const enclosedAreaPx =
        dry.largest.length * raster.cellSize * raster.cellSize;
    const boundsAreaPx =
        raster.width * raster.height * raster.cellSize * raster.cellSize;

    // Minimum area threshold prevents tiny accidental loops (like in an 'e' or 'o') from being seen as the main ring.
    const minAreaPx = Math.max(
        MIN_ENCLOSED_AREA_PX,
        boundsAreaPx * MIN_ENCLOSED_AREA_RATIO,
    );
    const edge = collectOutsideEdge(raster);
    const circle = scoreCircle(edge.edgePixels);

    // A closure is valid if it's big enough, round enough, and has a reasonable radius.
    const closed =
        enclosedAreaPx >= minAreaPx &&
        circle.radius >= config.ring.minRadius &&
        circle.perfection >= MIN_PERFECTION;

    return {
        closed,
        enclosedAreaPx,
        minEnclosedAreaPx: minAreaPx,
        componentCount: dry.componentCount,
        center: circle.center,
        radius: circle.radius,
        rmse: circle.rmse,
        normalizedRmse: circle.normalizedRmse,
        perfection: circle.perfection,
        edgePixelCount: edge.edgePixels.length,
        edgePixels: edge.edgePixels,
        strokeIds: edge.strokeIds,
        raster: {
            width: raster.width,
            height: raster.height,
            cellSize: raster.cellSize,
            offsetX: raster.offsetX,
            offsetY: raster.offsetY,
            blockedPixelCount: countCells(raster.blocked),
            waterPixelCount: countCells(raster.water),
            dryPixelCount: dry.largest.length,
        },
    };
}
