import {
    allPoints,
    angularDifference,
    boundsForStrokes,
    boundsOverlap,
    centerOfBounds,
    clamp,
    directedStrokeAngle,
    distance,
    dominantAxisOrientationDeg,
    endpointClosedness,
    expandBounds,
    strokeLength,
} from '../utils/geometry';
import { summarizePolar } from './coordinateNormalizer';
import {
    RingCandidate,
    Point,
    AppConfig,
    StrokeClassification,
    SymbolCandidate,
} from '../types';
import { CleanedStroke } from './strokeCleaner';

const BBOX_PADDING_NORM = 0.075;
const CENTER_DISTANCE_NORM = 0.2;
const ENDPOINT_DISTANCE_NORM = 0.085;
const MAX_SYMBOL_SIZE_NORM = 0.52;

/**
 * Calculates the shortest distance between any pair of endpoints from two different strokes.
 * This is used to determine if two strokes were meant to be connected.
 *
 * @param a - The first stroke.
 * @param b - The second stroke.
 * @returns The minimum Euclidean distance between the start/end points of the two strokes.
 */
function endpointDistance(a: CleanedStroke, b: CleanedStroke): number {
    const endpointsA = ([a.points[0], a.points.at(-1)] as Point[]).filter(
        Boolean,
    );
    const endpointsB = ([b.points[0], b.points.at(-1)] as Point[]).filter(
        Boolean,
    );
    let best = Infinity;
    for (const pointA of endpointsA) {
        for (const pointB of endpointsB) {
            best = Math.min(best, distance(pointA, pointB));
        }
    }
    return best;
}

/**
 * Heuristic to decide if two strokes should be grouped together into a single symbol candidate.
 * It checks for bounding box overlaps, center proximity, and endpoint proximity.
 *
 * @param a - The first stroke.
 * @param b - The second stroke.
 * @param ring - The detected ring context, providing a radius for normalization.
 * @param config - Application configuration.
 * @returns True if the strokes are likely part of the same symbol.
 */
function shouldGroup(
    a: CleanedStroke,
    b: CleanedStroke,
    ring: RingCandidate,
    config: AppConfig,
): boolean {
    const padding = ring.radius * BBOX_PADDING_NORM;
    // We expand the bounding boxes slightly to allow for small gaps between strokes.
    const aBounds = expandBounds(a.metrics.bounds, padding);
    const bBounds = expandBounds(b.metrics.bounds, padding);

    // Check if the geometric centers of the strokes are very close.
    const centersClose =
        distance(
            centerOfBounds(a.metrics.bounds),
            centerOfBounds(b.metrics.bounds),
        ) <=
        ring.radius * CENTER_DISTANCE_NORM;

    // Check if the ends of the strokes are nearly touching.
    const endpointsClose =
        endpointDistance(a, b) <= ring.radius * ENDPOINT_DISTANCE_NORM;

    return boundsOverlap(aBounds, bBounds) || centersClose || endpointsClose;
}

/**
 * Determines the orientation of a symbol relative to the center of the spell ring.
 *
 * @param directedAngle - The absolute angle of the stroke's path (start to end).
 * @param radialAngle - The angle from the ring center to the symbol's center.
 * @returns A string label: 'outward', 'inward', 'clockwise', 'counterclockwise', or 'unclear'.
 */
function classifyRadialFacing(
    directedAngle: number,
    radialAngle: number,
): string {
    const outward = angularDifference(directedAngle, radialAngle);
    const inward = angularDifference(directedAngle, radialAngle + 180);
    const counterclockwise = angularDifference(directedAngle, radialAngle + 90);
    const clockwise = angularDifference(directedAngle, radialAngle - 90);
    const best = Math.min(outward, inward, counterclockwise, clockwise);

    // If the angle difference is too large for all directions, the facing is ambiguous.
    if (best > 48) {
        return 'unclear';
    }
    if (best === outward) {
        return 'outward';
    }
    if (best === inward) {
        return 'inward';
    }
    if (best === counterclockwise) {
        return 'counterclockwise';
    }
    return 'clockwise';
}

/**
 * Creates a SymbolCandidate from a group of strokes and calculates its normalized features.
 * These features are used later for template matching and semantic analysis.
 *
 * @param strokes - The group of strokes forming the symbol.
 * @param index - Index for unique identification.
 * @param ring - The ring context.
 * @param config - Application configuration.
 * @returns A fully populated SymbolCandidate object.
 */
function buildCandidate(
    strokes: CleanedStroke[],
    index: number,
    ring: RingCandidate,
    config: AppConfig,
): SymbolCandidate {
    const points = allPoints(strokes);
    const bounds = boundsForStrokes(strokes);
    const center = centerOfBounds(bounds);
    const polar = summarizePolar(center, ring, config);
    const length = strokes.reduce(
        (sum, stroke) => sum + strokeLength(stroke),
        0,
    );
    const size = Math.max(bounds.width, bounds.height);

    // Normalization: Divide absolute sizes by the ring radius to get relative proportions.
    // This makes the symbol recognition scale-invariant.
    const sizeNorm = size / Math.max(1, ring.radius * 2);
    const lengthNorm = length / Math.max(1, Math.PI * 2 * ring.radius);

    const orientationDeg = dominantAxisOrientationDeg(points);
    const directedOrientationDeg = directedStrokeAngle(strokes);
    const radialFacing = classifyRadialFacing(
        directedOrientationDeg,
        polar.angleDeg,
    );

    // Complex: Compactness and Overdraw calculation.
    // We compare the total path length to the perimeter of the bounding box.
    // Multiple overlapping strokes or "scribbling" will increase the overdraw amount.
    const compactPerimeter = Math.max(1, (bounds.width + bounds.height) * 2);
    const overdrawAmount = clamp(length / compactPerimeter - 0.72, 0, 1);
    const closedness = endpointClosedness(strokes, Math.max(1, size));

    return {
        candidateId: `c${index + 1}`,
        strokeIds: strokes.map((stroke) => stroke.id),
        rawStrokeCount: strokes.length,
        cleanedStrokeCount: strokes.length,
        bounds,
        center,
        radiusNorm: polar.radiusNorm,
        angleDeg: polar.angleDeg,
        layer: polar.layer,
        nearBoundary: polar.nearBoundary,
        sizeNorm,
        lengthNorm,
        orientationDeg,
        directedOrientationDeg,
        radialFacing,
        closedness,
        overdrawAmount,
        // Neatness heuristic: penalty for excessive strokes or high overdraw.
        neatness: clamp(
            0.92 -
                overdrawAmount * 0.28 -
                Math.max(0, strokes.length - 4) * 0.035,
            0,
            1,
        ),
        strokes,
    };
}

/**
 * A simple 2D spatial optimization structure.
 * It divides the canvas into a grid of cells to quickly find nearby strokes
 * without checking every single pair (O(N^2) reduction).
 */
class SpatialGrid {
    private readonly cells = new Map<string, CleanedStroke[]>();
    private readonly cellSize: number;

    constructor(cellSize: number) {
        this.cellSize = cellSize;
    }

    /** Generates a unique string key for a grid cell based on coordinates. */
    private key(x: number, y: number): string {
        return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
    }

    /** Inserts a stroke into all grid cells that its bounding box intersects. */
    insert(stroke: CleanedStroke): void {
        const bounds = stroke.metrics.bounds;
        const xStart = Math.floor(bounds.minX / this.cellSize);
        const xEnd = Math.floor(bounds.maxX / this.cellSize);
        const yStart = Math.floor(bounds.minY / this.cellSize);
        const yEnd = Math.floor(bounds.maxY / this.cellSize);

        for (let x = xStart; x <= xEnd; x++) {
            for (let y = yStart; y <= yEnd; y++) {
                const k = `${x},${y}`;
                const cell = this.cells.get(k) ?? [];
                cell.push(stroke);
                this.cells.set(k, cell);
            }
        }
    }

    /** Queries the grid for strokes that are in or adjacent to the cells occupied by the given stroke. */
    query(stroke: CleanedStroke): Set<CleanedStroke> {
        const neighbors = new Set<CleanedStroke>();
        const bounds = stroke.metrics.bounds;
        // Padding covers the maximum possible grouping distance.
        const padding = this.cellSize;
        const xStart = Math.floor((bounds.minX - padding) / this.cellSize);
        const xEnd = Math.floor((bounds.maxX + padding) / this.cellSize);
        const yStart = Math.floor((bounds.minY - padding) / this.cellSize);
        const yEnd = Math.floor((bounds.maxY + padding) / this.cellSize);

        for (let x = xStart; x <= xEnd; x++) {
            for (let y = yStart; y <= yEnd; y++) {
                const cell = this.cells.get(`${x},${y}`);
                if (cell) {
                    for (const s of cell) {
                        if (s.id !== stroke.id) {
                            neighbors.add(s);
                        }
                    }
                }
            }
        }
        return neighbors;
    }
}

/**
 * Main entry point for grouping strokes into symbols.
 * It uses a flood-fill/BFS approach on a spatial grid to cluster strokes that are close to each other.
 *
 * @param strokes - The cleaned strokes from the user.
 * @param classifications - Preliminary classification of strokes (e.g., used by parser, can join symbol).
 * @param ring - The detected ring context.
 * @param config - Application configuration.
 * @returns An array of symbol candidates, each containing one or more grouped strokes.
 */
export function buildSymbolCandidates(
    strokes: CleanedStroke[],
    classifications: StrokeClassification[],
    ring: RingCandidate,
    config: AppConfig,
): SymbolCandidate[] {
    if (!ring.found) {
        return [];
    }

    const classificationById = new Map(
        classifications.map((classification) => [
            classification.strokeId,
            classification,
        ]),
    );

    // Strokes that are identified as likely parts of a symbol by the drawing classifier.
    const seedStrokes = strokes.filter(
        (stroke) => classificationById.get(stroke.id)?.usedByParser,
    );

    // Strokes that are allowed to be added to a group (e.g., small details, not the main ring).
    const joinableStrokes = strokes.filter(
        (stroke) => classificationById.get(stroke.id)?.canJoinSymbol,
    );

    // Initialize spatial grid with cell size based on ring radius to optimize neighbor searches.
    const grid = new SpatialGrid(ring.radius * 0.25);
    for (const stroke of joinableStrokes) {
        grid.insert(stroke);
    }

    const visited = new Set<string>();
    const groups: CleanedStroke[][] = [];

    // Complex: Breadth-First Search grouping.
    // For each "seed" stroke, we find all reachable neighbors that satisfy the `shouldGroup` criteria.
    for (const stroke of seedStrokes) {
        if (visited.has(stroke.id)) {
            continue;
        }

        const group: CleanedStroke[] = [];
        const queue = [stroke];
        visited.add(stroke.id);

        while (queue.length) {
            const current = queue.shift()!;
            group.push(current);

            const neighbors = grid.query(current);
            for (const other of neighbors) {
                if (visited.has(other.id)) {
                    continue;
                }
                if (shouldGroup(current, other, ring, config)) {
                    visited.add(other.id);
                    queue.push(other);
                }
            }
        }

        groups.push(group);
    }

    return (
        groups
            .map((group, index) => buildCandidate(group, index, ring, config))
            // Filter out candidates that are implausibly large (e.g., the whole circle).
            .filter((candidate) => candidate.sizeNorm <= MAX_SYMBOL_SIZE_NORM)
    );
}
