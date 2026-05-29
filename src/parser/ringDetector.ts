import {
    allPoints,
    angleDegFromCenter,
    boundsForStrokes,
    centerOfBounds,
    clamp,
    degreesToRadians,
    distance,
    mean,
    stddev,
    strokeLength,
} from '../utils/geometry';
import { Point, Stroke, AppConfig, RingCandidate, Circle } from '../types';
import {
    analyzeTopologicalClosure,
    TopologicalClosureResult,
} from './topologicalFloodFill';
import { CleanedStroke } from './strokeCleaner';
import { wasmFitCircle } from './wasmBridge';

const MIN_CLOSURE_RELEVANT_POINT_RATIO = 0.15;
const RING_BIN_COUNT = 96;
const MIN_SEED_LENGTH_PX = 130;
const FOUND_COMPLETENESS = 0.52;
const ACTIVATION_COMPLETENESS_FLOOR = 0.64;
const MIN_ROUNDNESS = 0.36;
const OPEN_COVERAGE_HALF_WIDTH_PX = 12;
const OPEN_COVERAGE_HALF_WIDTH_RATIO = 0.055;
const OPEN_COLLECTION_MIN_RATIO = 0.45;
const STROKE_SAMPLE_STEP_PX = 0.75;
const TOPOLOGY_RING_STROKE_MIN_NEAR_CIRCLE_RATIO = 0.56;
const TOPOLOGY_RING_STROKE_MIN_NEAR_CIRCLE_LENGTH_PX = 24;
const TOPOLOGY_RING_PRUNE_COVERAGE_FLOOR = 0.88;
const TOPOLOGY_RING_PRUNE_MAX_ANGULAR_SPAN_DEG = 24;

const SAME_RING_CENTER_DISTANCE_RATIO = 0.22;
const SAME_RING_RADIUS_RATIO = 0.18;

function solve3(matrix: number[][], vector: number[]): number[] | null {
    const a = matrix.map((row, index) => [...row, vector[index]]);

    for (let column = 0; column < 3; column += 1) {
        let pivot = column;
        for (let row = column + 1; row < 3; row += 1) {
            if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) {
                pivot = row;
            }
        }

        if (Math.abs(a[pivot][column]) < 1e-8) {
            return null;
        }

        [a[column], a[pivot]] = [a[pivot], a[column]];
        const divisor = a[column][column];
        for (let item = column; item < 4; item += 1) {
            a[column][item] /= divisor;
        }

        for (let row = 0; row < 3; row += 1) {
            if (row === column) {
                continue;
            }
            const factor = a[row][column];
            for (let item = column; item < 4; item += 1) {
                a[row][item] -= factor * a[column][item];
            }
        }
    }

    return [a[0][3], a[1][3], a[2][3]];
}

function fitCircle(points: Point[]): Circle | null {
    if (points.length < 8) {
        return null;
    }

    const wasmResult = wasmFitCircle(points.flatMap(p => [p.x, p.y]));
    if (wasmResult) {
        return wasmResult;
    }

    let sumX = 0;
    let sumY = 0;
    let sumX2 = 0;
    let sumY2 = 0;
    let sumXY = 0;
    let sumX3 = 0;
    let sumY3 = 0;
    let sumX2Y = 0;
    let sumXY2 = 0;

    for (const point of points) {
        const x = point.x;
        const y = point.y;
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

    const result = solve3(
        [
            [sumX2, sumXY, sumX],
            [sumXY, sumY2, sumY],
            [sumX, sumY, points.length],
        ],
        [sumX3 + sumXY2, sumX2Y + sumY3, sumX2 + sumY2],
    );

    if (!result) {
        return null;
    }

    const [a, b, c] = result;
    const center = { x: a / 2, y: b / 2 };
    const radiusSquared = c + center.x * center.x + center.y * center.y;
    if (!Number.isFinite(radiusSquared) || radiusSquared <= 0) {
        return null;
    }

    return {
        center,
        radius: Math.sqrt(radiusSquared),
    };
}

function fallbackCircle(strokes: Stroke[]): Circle {
    const bounds = boundsForStrokes(strokes);
    return {
        center: centerOfBounds(bounds),
        radius: (bounds.width + bounds.height) / 4,
    };
}

function markAngle(bins: boolean[], angleDeg: number): void {
    const bin = Math.floor((angleDeg / 360) * bins.length) % bins.length;
    bins[bin] = true;
}

function largestGap(bins: boolean[]): {
    startAngle: number;
    endAngle: number;
    sizeDegrees: number;
} {
    const size = bins.length;
    let bestStart = 0;
    let bestLength = 0;
    let currentStart = 0;
    let currentLength = 0;

    for (let index = 0; index < size * 2; index += 1) {
        const bin = bins[index % size];
        if (!bin) {
            if (currentLength === 0) {
                currentStart = index;
            }
            currentLength += 1;
            if (currentLength > bestLength && currentLength <= size) {
                bestStart = currentStart;
                bestLength = currentLength;
            }
        } else {
            currentLength = 0;
        }
    }

    const binDegrees = 360 / size;
    return {
        startAngle: (bestStart % size) * binDegrees,
        endAngle: ((bestStart + bestLength) % size) * binDegrees,
        sizeDegrees: bestLength * binDegrees,
    };
}

function openCoverageHalfWidth(radius: number, config: AppConfig): number {
    return Math.max(
        OPEN_COVERAGE_HALF_WIDTH_PX,
        radius * OPEN_COVERAGE_HALF_WIDTH_RATIO,
    );
}

function strokeCircleMetrics(
    stroke: Stroke,
    circle: Circle,
    config: AppConfig,
    bins: boolean[] | null = null,
) {
    const halfWidth = openCoverageHalfWidth(circle.radius, config);
    const sampleStep = STROKE_SAMPLE_STEP_PX;
    let totalLength = 0;
    let nearLength = 0;

    for (let index = 1; index < stroke.points.length; index += 1) {
        const previous = stroke.points[index - 1];
        const current = stroke.points[index];
        const segmentLength = distance(previous, current);
        if (segmentLength <= 0) {
            continue;
        }

        const steps = Math.max(1, Math.ceil(segmentLength / sampleStep));
        const sampleLength = segmentLength / steps;
        totalLength += segmentLength;

        for (let step = 1; step <= steps; step += 1) {
            const t = step / steps;
            const point = {
                x: previous.x + (current.x - previous.x) * t,
                y: previous.y + (current.y - previous.y) * t,
            };
            const nearCircle =
                Math.abs(distance(point, circle.center) - circle.radius) <=
                halfWidth;
            if (nearCircle) {
                nearLength += sampleLength;
                if (bins) {
                    markAngle(bins, angleDegFromCenter(point, circle.center));
                }
            }
        }
    }

    return {
        totalLength,
        nearLength,
        nearRatio: totalLength > 0 ? nearLength / totalLength : 0,
    };
}

function measureOpenCoverage(
    strokes: Stroke[],
    circle: Circle,
    config: AppConfig,
) {
    const bins = new Array(RING_BIN_COUNT).fill(false);
    let nearLength = 0;
    let totalLength = 0;

    for (const stroke of strokes) {
        const metrics = strokeCircleMetrics(stroke, circle, config, bins);
        nearLength += metrics.nearLength;
        totalLength += metrics.totalLength;
    }

    const coverageRatio =
        bins.filter(Boolean).length / Math.max(1, bins.length);
    const gap = largestGap(bins);

    return {
        coverageRatio,
        gap,
        gapArcLength: degreesToRadians(gap.sizeDegrees) * circle.radius,
        nearCircleInkRatio: totalLength > 0 ? nearLength / totalLength : 0,
    };
}

function measureRing(
    strokes: Stroke[],
    config: AppConfig,
    referenceRing: RingCandidate | null = null,
    topology: TopologicalClosureResult | null = null,
): RingCandidate | null {
    const points = allPoints(strokes);
    if (points.length < 8 && !topology?.closed) {
        return null;
    }

    const fitted =
        points.length >= 8
            ? (fitCircle(points) ?? fallbackCircle(strokes))
            : null;
    const center = referenceRing?.center ?? fitted?.center ?? topology?.center;
    const radius =
        referenceRing?.radius ??
        fitted?.radius ??
        topology?.radius ??
        (center ? mean(points.map((p) => distance(p, center))) : 0);

    if (!center || !Number.isFinite(radius) || radius <= 0) {
        return null;
    }

    const radialDistances = points.map((point) => distance(point, center));
    const residual = topology?.closed
        ? (topology.normalizedRmse ?? 0)
        : stddev(radialDistances) / Math.max(1, radius);
    const bounds = points.length
        ? boundsForStrokes(strokes)
        : { width: radius * 2, height: radius * 2 };
    const aspect =
        Math.min(bounds.width, bounds.height) /
        Math.max(1, Math.max(bounds.width, bounds.height));
    const fittedRoundness = clamp((1 - residual * 3.1) * 0.78 + aspect * 0.22);
    const roundness = topology?.closed
        ? (topology?.perfection ?? 0)
        : (referenceRing?.roundness ?? fittedRoundness);
    const coverage = measureOpenCoverage(strokes, { center, radius }, config);
    const complete = Boolean(topology?.closed);
    const completeness = complete ? 1 : coverage.coverageRatio;
    const circumference = Math.PI * 2 * radius;
    const inkLength = strokes.reduce(
        (sum, stroke) => sum + strokeLength(stroke),
        0,
    );
    const overdraw = Math.max(0, inkLength / Math.max(1, circumference) - 1.08);
    const closureQuality = complete
        ? (topology?.perfection ?? 0)
        : clamp(coverage.coverageRatio);
    const lineSmoothness = clamp(
        (complete ? (topology?.perfection ?? 0) : coverage.nearCircleInkRatio) *
            0.72 +
            (1 - residual) * 0.28 -
            overdraw * 0.12,
    );
    const neatness = clamp(
        roundness * 0.42 + lineSmoothness * 0.36 + closureQuality * 0.22,
    );

    return {
        found: true,
        center,
        radius,
        complete,
        completeness,
        coverageRatio: coverage.coverageRatio,
        gap: coverage.gap,
        gapArcLength: coverage.gapArcLength,
        roundness,
        lineSmoothness,
        neatness,
        overdrawAmount: clamp(overdraw, 0, 1),
        strokeIds: strokes.map((stroke) => stroke.id),
    };
}

function collectOpenRingStrokes(
    seedRing: RingCandidate,
    strokes: Stroke[],
    config: AppConfig,
): Stroke[] {
    const circle = { center: seedRing.center, radius: seedRing.radius };
    return strokes.filter((stroke) => {
        if (seedRing.strokeIds.includes(stroke.id)) {
            return true;
        }

        const metrics = strokeCircleMetrics(stroke, circle, config);
        return metrics.nearRatio >= OPEN_COLLECTION_MIN_RATIO;
    });
}

function strokeAngularCoverage(
    stroke: Stroke,
    circle: Circle,
    config: AppConfig,
) {
    const bins = new Array(RING_BIN_COUNT).fill(false);
    const metrics = strokeCircleMetrics(stroke, circle, config, bins);
    const coveredBinCount = bins.filter(Boolean).length;
    return {
        ...metrics,
        coveredBinCount,
        angularSpanDeg: coveredBinCount * (360 / Math.max(1, bins.length)),
    };
}

function pruneRedundantShortRingStrokes(
    ringStrokes: Stroke[],
    circle: Circle,
    config: AppConfig,
): Stroke[] {
    let kept = [...ringStrokes];

    for (const stroke of [...ringStrokes].sort(
        (a, b) => strokeLength(a) - strokeLength(b),
    )) {
        if (kept.length <= 1 || !kept.some((item) => item.id === stroke.id)) {
            continue;
        }

        const coverage = strokeAngularCoverage(stroke, circle, config);
        if (
            coverage.angularSpanDeg > TOPOLOGY_RING_PRUNE_MAX_ANGULAR_SPAN_DEG
        ) {
            continue;
        }

        const withoutStroke = kept.filter((item) => item.id !== stroke.id);
        const withoutCoverage = measureOpenCoverage(
            withoutStroke,
            circle,
            config,
        );
        const withoutTopology = analyzeTopologicalClosure(
            withoutStroke,
            config,
        );
        if (
            withoutCoverage.coverageRatio >=
                TOPOLOGY_RING_PRUNE_COVERAGE_FLOOR &&
            withoutTopology.closed
        ) {
            kept = withoutStroke;
        }
    }

    return kept;
}

function collectTopologicalRingStrokes(
    strokes: Stroke[],
    topology: TopologicalClosureResult,
    config: AppConfig,
): Stroke[] {
    const edgeStrokeIds = new Set(topology.strokeIds);
    const edgeStrokes = strokes.filter((stroke) =>
        edgeStrokeIds.has(stroke.id),
    );
    const refinedCircle = fitCircle(allPoints(edgeStrokes)) ?? {
        center: topology.center!,
        radius: topology.radius!,
    };
    const ringStrokes = edgeStrokes.filter((stroke) => {
        const metrics = strokeCircleMetrics(stroke, refinedCircle, config);
        return (
            metrics.nearLength >=
                TOPOLOGY_RING_STROKE_MIN_NEAR_CIRCLE_LENGTH_PX &&
            metrics.nearRatio >= TOPOLOGY_RING_STROKE_MIN_NEAR_CIRCLE_RATIO
        );
    });

    return ringStrokes.length
        ? pruneRedundantShortRingStrokes(ringStrokes, refinedCircle, config)
        : edgeStrokes;
}

function closureRelevantStrokes(
    strokes: Stroke[],
    referenceRing: RingCandidate | null,
    config: AppConfig,
): Stroke[] {
    if (!referenceRing?.found) {
        return strokes;
    }

    const previousRingStrokeIds = new Set(referenceRing.strokeIds ?? []);
    const boundaryRadius = referenceRing.radius * config.layers.boundaryMax;

    return strokes.filter((stroke) => {
        if (previousRingStrokeIds.has(stroke.id)) {
            return true;
        }

        const pointCount = Math.max(1, stroke.points.length);
        const insideOrBoundaryRatio =
            stroke.points.filter(
                (point) =>
                    distance(point, referenceRing.center) <= boundaryRadius,
            ).length / pointCount;

        return insideOrBoundaryRatio >= MIN_CLOSURE_RELEVANT_POINT_RATIO;
    });
}

function scoreCandidate(ring: RingCandidate | null, config: AppConfig): number {
    if (!ring || ring.radius < config.ring.minRadius) {
        return 0;
    }
    const radiusScore = clamp((ring.radius - config.ring.minRadius) / 180);
    const closureBonus = ring.complete ? 0.3 : 0;
    return clamp(
        ring.completeness * 0.38 +
            ring.roundness * 0.25 +
            ring.neatness * 0.19 +
            radiusScore * 0.08 +
            closureBonus,
        0,
        1.3,
    );
}

function addTopologicalCandidate(
    candidates: RingCandidate[],
    strokes: Stroke[],
    config: AppConfig,
): TopologicalClosureResult {
    const topology = analyzeTopologicalClosure(strokes, config);
    if (topology.closed) {
        const ringStrokes = collectTopologicalRingStrokes(
            strokes,
            topology,
            config,
        );
        const measured = measureRing(
            ringStrokes.length ? ringStrokes : strokes,
            config,
            null,
            topology,
        );
        if (measured) {
            const score = scoreCandidate(measured, config);
            if (score > 0) {
                candidates.push({
                    ...measured,
                    score,
                });
            }
        }
    }

    return topology;
}

function buildOpenRingCandidates(
    strokes: CleanedStroke[],
    config: AppConfig,
): RingCandidate[] {
    const candidates: RingCandidate[] = [];
    const seeds = strokes.filter((stroke) => {
        const length = stroke.metrics?.length ?? strokeLength(stroke);
        const bounds = stroke.metrics?.bounds ?? boundsForStrokes([stroke]);
        const diagonal = Math.hypot(bounds.width, bounds.height);
        return (
            length >= MIN_SEED_LENGTH_PX &&
            diagonal >= config.ring.minRadius * 1.35
        );
    });

    for (const seed of seeds) {
        const firstPass = measureRing([seed], config);
        if (!firstPass) {
            continue;
        }
        const ringStrokes = collectOpenRingStrokes(firstPass, strokes, config);
        const measured = measureRing(ringStrokes, config, firstPass);
        if (measured) {
            const score = scoreCandidate(measured, config);
            if (
                score > 0 &&
                measured.completeness >= FOUND_COMPLETENESS &&
                measured.roundness >= MIN_ROUNDNESS
            ) {
                candidates.push({
                    ...measured,
                    score,
                });
            }
        }
    }

    return candidates;
}

function addReferenceFilteredClosureCandidate(
    candidates: RingCandidate[],
    strokes: Stroke[],
    reference: RingCandidate | null,
    config: AppConfig,
): boolean {
    if (!reference) {
        return false;
    }

    const relevantStrokes = closureRelevantStrokes(strokes, reference, config);
    if (
        relevantStrokes.length === strokes.length ||
        relevantStrokes.length < 2
    ) {
        return false;
    }

    const previousCandidateCount = candidates.length;
    addTopologicalCandidate(candidates, relevantStrokes, config);
    return candidates.length > previousCandidateCount;
}

function bestOpenRingCandidate(
    openCandidates: RingCandidate[],
): RingCandidate | null {
    return (
        [...openCandidates]
            .filter((candidate) => !candidate.complete)
            .sort(
                (a, b) =>
                    (b.score ?? 0) +
                    b.radius * 0.001 -
                    ((a.score ?? 0) + a.radius * 0.001),
            )[0] ?? null
    );
}

function closureReferenceRing(
    previousRing: RingCandidate | null,
    openCandidates: RingCandidate[],
): RingCandidate | null {
    if (previousRing?.found && !previousRing.complete) {
        return previousRing;
    }
    return bestOpenRingCandidate(openCandidates);
}

function isSamePhysicalRing(a: RingCandidate, b: RingCandidate): boolean {
    const averageRadius = Math.max(1, (a.radius + b.radius) / 2);
    const centerDistance = distance(a.center, b.center);
    const radiusRatio = Math.abs(a.radius - b.radius) / averageRadius;
    return (
        centerDistance <= averageRadius * SAME_RING_CENTER_DISTANCE_RATIO &&
        radiusRatio <= SAME_RING_RADIUS_RATIO
    );
}

function distinctRingCandidates(candidates: RingCandidate[]): RingCandidate[] {
    const distinct: RingCandidate[] = [];
    for (const candidate of candidates) {
        if (
            !distinct.some((existing) =>
                isSamePhysicalRing(existing, candidate),
            )
        ) {
            distinct.push(candidate);
        }
    }
    return distinct;
}

function summarizeUnsupportedRing(candidate: RingCandidate) {
    return {
        center: candidate.center,
        radius: candidate.radius,
        complete: candidate.complete,
        completeness: candidate.completeness,
        strokeIds: candidate.strokeIds,
    };
}

export function detectRing(
    strokes: CleanedStroke[],
    previousRing: RingCandidate | null,
    config: AppConfig,
): RingCandidate {
    const candidates: RingCandidate[] = [];

    const openCandidates = buildOpenRingCandidates(strokes, config);

    const reference = closureReferenceRing(previousRing, openCandidates);
    const filteredClosureFound = addReferenceFilteredClosureCandidate(
        candidates,
        strokes,
        reference,
        config,
    );
    if (!filteredClosureFound) {
        addTopologicalCandidate(candidates, strokes, config);
    }
    candidates.push(...openCandidates);

    if (!candidates.length) {
        return {
            found: false,
            complete: false,
            completeness: 0,
            activationEvent: false,
            strokeIds: [],
            unsupportedNestedRings: [],
            center: { x: 0, y: 0 },
            radius: 0,
            roundness: 0,
            lineSmoothness: 0,
            neatness: 0,
            overdrawAmount: 0,
        };
    }

    candidates.sort(
        (a, b) =>
            Number(b.complete) - Number(a.complete) ||
            (b.score ?? 0) +
                b.radius * 0.001 -
                ((a.score ?? 0) + a.radius * 0.001),
    );
    const distinctRings = distinctRingCandidates(candidates);
    const ring = distinctRings[0];
    const unsupportedMultipleRings = distinctRings
        .slice(1)
        .map(summarizeUnsupportedRing);
    const unsupportedNestedRings = distinctRings
        .slice(1)
        .filter(
            (candidate) =>
                candidate.radius < ring.radius * 0.78 &&
                candidate.roundness >= 0.68 &&
                candidate.complete,
        )
        .map(summarizeUnsupportedRing);

    const activationEvent = Boolean(
        previousRing?.found &&
        !previousRing.complete &&
        ring.complete &&
        previousRing.completeness >= ACTIVATION_COMPLETENESS_FLOOR &&
        unsupportedMultipleRings.length === 0,
    );

    return {
        ...ring,
        activationEvent,
        unsupportedNestedRings,
        unsupportedMultipleRings,
    };
}
