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
    Stroke,
    RingCandidate,
    AppConfig,
    StrokeClassification,
    SymbolCandidate,
} from '../types';
import { CleanedStroke } from './strokeCleaner';

const BBOX_PADDING_NORM = 0.075;
const CENTER_DISTANCE_NORM = 0.2;
const ENDPOINT_DISTANCE_NORM = 0.085;
const MAX_SYMBOL_SIZE_NORM = 0.52;

function endpointDistance(a: CleanedStroke, b: CleanedStroke): number {
    const endpointsA = [a.points[0], a.points[a.points.length - 1]].filter(
        Boolean,
    );
    const endpointsB = [b.points[0], b.points[b.points.length - 1]].filter(
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

function shouldGroup(
    a: CleanedStroke,
    b: CleanedStroke,
    ring: RingCandidate,
    config: AppConfig,
): boolean {
    const padding = ring.radius * BBOX_PADDING_NORM;
    const aBounds = expandBounds(a.metrics.bounds, padding);
    const bBounds = expandBounds(b.metrics.bounds, padding);
    const centersClose =
        distance(
            centerOfBounds(a.metrics.bounds),
            centerOfBounds(b.metrics.bounds),
        ) <=
        ring.radius * CENTER_DISTANCE_NORM;
    const endpointsClose =
        endpointDistance(a, b) <= ring.radius * ENDPOINT_DISTANCE_NORM;
    return boundsOverlap(aBounds, bBounds) || centersClose || endpointsClose;
}

function classifyRadialFacing(
    directedAngle: number,
    radialAngle: number,
): string {
    const outward = angularDifference(directedAngle, radialAngle);
    const inward = angularDifference(directedAngle, radialAngle + 180);
    const counterclockwise = angularDifference(directedAngle, radialAngle + 90);
    const clockwise = angularDifference(directedAngle, radialAngle - 90);
    const best = Math.min(outward, inward, counterclockwise, clockwise);

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
    const sizeNorm = size / Math.max(1, ring.radius * 2);
    const lengthNorm = length / Math.max(1, Math.PI * 2 * ring.radius);
    const orientationDeg = dominantAxisOrientationDeg(points);
    const directedOrientationDeg = directedStrokeAngle(strokes);
    const radialFacing = classifyRadialFacing(
        directedOrientationDeg,
        polar.angleDeg,
    );
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
        neatness: clamp(
            0.92 -
                overdrawAmount * 0.28 -
                Math.max(0, strokes.length - 4) * 0.035,
        ),
        strokes,
    };
}

class SpatialGrid {
    private cells = new Map<string, CleanedStroke[]>();
    private cellSize: number;

    constructor(cellSize: number) {
        this.cellSize = cellSize;
    }

    private key(x: number, y: number): string {
        return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
    }

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

    query(stroke: CleanedStroke): Set<CleanedStroke> {
        const neighbors = new Set<CleanedStroke>();
        const bounds = stroke.metrics.bounds;
        // Padding should cover the maximum possible grouping distance
        // ring.radius * 0.2 is the max center distance
        // Our cellSize is ring.radius * 0.25, so querying neighbors (1 cell radius) is enough.
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
    const seedStrokes = strokes.filter(
        (stroke) => classificationById.get(stroke.id)?.usedByParser,
    );
    const joinableStrokes = strokes.filter(
        (stroke) => classificationById.get(stroke.id)?.canJoinSymbol,
    );

    // Initialize spatial grid with cell size based on ring radius
    const grid = new SpatialGrid(ring.radius * 0.25);
    for (const stroke of joinableStrokes) {
        grid.insert(stroke);
    }

    const visited = new Set<string>();
    const groups: CleanedStroke[][] = [];

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

    return groups
        .map((group, index) => buildCandidate(group, index, ring, config))
        .filter((candidate) => candidate.sizeNorm <= MAX_SYMBOL_SIZE_NORM);
}
