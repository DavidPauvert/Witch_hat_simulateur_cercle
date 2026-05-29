import { clamp, degreesToRadians, normalizeAngleDeg } from '../utils/geometry';
import { normalizeStrokesForTemplate } from './templateNormalizer';
import { Point, Stroke, SymbolCandidate } from '../types';
import {
    wasmCountInk,
    wasmMaskOverlap,
    wasmOccupiedCells,
    wasmRenderInkLayers,
} from './wasmBridge';

const INK_SIZE = 40;
const CORE_RADIUS = 1;
const SOFT_RADIUS = 2;
const LOOSE_RADIUS = 4;
const CANDIDATE_SAMPLES_PER_STROKE = 40;
const REGION_GRID_SIZE = 10;
const ROTATION_STABILITY_MARGIN = 0.018;

const templateInkCache = new WeakMap<any, Ink>();
const candidateInkCache = new WeakMap<any, CandidateInkCacheEntry>();

interface Layer {
    mask: Uint8Array;
    ink: number;
}

interface Ink {
    core: Layer;
    soft: Layer;
    loose: Layer;
}

interface CandidateInkCacheEntry {
    normalized: { strokes: Point[][] };
    rotations: Map<number, Ink>;
}

/**
 * Determines the set of rotation angles to check when matching a candidate against a template.
 *
 * @param options - Recognition options like allowed rotations or if it's rotation-invariant.
 * @returns An array of degrees to test.
 */
function rotationSet(options: {
    allowedRotationsDeg?: number[];
    rotationInvariant?: boolean;
}): number[] {
    if (
        Array.isArray(options.allowedRotationsDeg) &&
        options.allowedRotationsDeg.length
    ) {
        return options.allowedRotationsDeg;
    }
    // If rotation invariant, we check every 45 degrees.
    if (options.rotationInvariant) {
        return [0, 45, 90, 135, 180, 225, 270, 315];
    }
    // By default, we only check the original orientation.
    return [0];
}

interface RotationTransform {
    cos: number;
    sin: number;
}

/** Pre-calculates sine and cosine for a given angle to speed up rotation math. */
function rotationTransform(degrees: number): RotationTransform | null {
    if (!degrees) {
        return null;
    }

    const radians = degreesToRadians(degrees);
    return {
        cos: Math.cos(radians),
        sin: Math.sin(radians),
    };
}

/** Measures how much a rotation deviates from the standard 0-degree orientation (0 to 1 scale). */
function normalizedRotationMagnitude(degrees: number): number {
    const normalized = normalizeAngleDeg(degrees);
    return Math.min(normalized, 360 - normalized) / 180;
}

/** Rotates a normalized point (0..1 range) around the center (0.5, 0.5). */
function rotatePoint(point: Point, transform: RotationTransform | null): Point {
    if (!transform) {
        return point;
    }

    const x = point.x - 0.5;
    const y = point.y - 0.5;
    return {
        x: x * transform.cos - y * transform.sin + 0.5,
        y: x * transform.sin + y * transform.cos + 0.5,
    };
}

/** Creates a new, empty bitmap layer. */
function createLayer(size: number): Layer {
    return {
        mask: new Uint8Array(size * size),
        ink: 0,
    };
}

/** Counts the number of non-zero pixels in a bitmap. */
function countInk(mask: Uint8Array): number {
    return wasmCountInk(mask);
}

/**
 * Renders vector strokes into a multi-layered bitmap for fuzzy matching.
 *
 * @param strokes - The strokes as arrays of points.
 * @param rotationDeg - The angle to rotate the strokes by.
 * @param size - The resolution of the resulting bitmap.
 * @returns An Ink object containing three layers:
 *          - core: The exact path (thin).
 *          - soft: Slightly thickened path for minor errors.
 *          - loose: Very thick path for larger deviations.
 */
function renderInk(
    strokes: Point[][],
    rotationDeg: number = 0,
    size: number = INK_SIZE,
): Ink {
    const transform = rotationTransform(rotationDeg);
    const flatPoints: number[] = [];

    // Flatten points for WASM bridge: [x1, y1, x2, y2, NaN, NaN, x3, y3...]
    // NaN pairs indicate the end of one stroke and the start of the next.
    for (const stroke of strokes ?? []) {
        if (!stroke?.length) continue;
        for (const p of stroke) {
            const rotated = rotatePoint(p, transform);
            flatPoints.push(rotated.x, rotated.y);
        }
        flatPoints.push(Number.NaN, Number.NaN);
    }

    // Call WASM to perform the heavy lifting of rendering and thickening the strokes.
    const layers = wasmRenderInkLayers(
        flatPoints,
        size,
        CORE_RADIUS,
        SOFT_RADIUS,
        LOOSE_RADIUS,
    );

    if (layers) {
        return {
            core: { mask: layers.core, ink: countInk(layers.core) },
            soft: { mask: layers.soft, ink: countInk(layers.soft) },
            loose: { mask: layers.loose, ink: countInk(layers.loose) },
        };
    }

    return {
        core: createLayer(size),
        soft: createLayer(size),
        loose: createLayer(size),
    };
}

/** Retrieves or generates the rasterized representation of a stroke template. */
function templateInk(strokeTemplate: { strokes?: (Stroke | Point[])[] }): Ink {
    const cached = templateInkCache.get(strokeTemplate);
    if (cached) {
        return cached;
    }

    // First, normalize the template's strokes to a standard scale and position.
    const normalized = normalizeStrokesForTemplate(
        strokeTemplate.strokes ?? [],
        {
            samplesPerStroke: CANDIDATE_SAMPLES_PER_STROKE,
            fitToBounds: true,
            digits: 5,
        },
    );
    const ink = renderInk(normalized.strokes, 0);
    templateInkCache.set(strokeTemplate, ink);
    return ink;
}

/** Retrieves or generates the rasterized representation of a candidate symbol at a specific rotation. */
function candidateInk(candidate: SymbolCandidate, rotationDeg: number): Ink {
    let cached = candidateInkCache.get(candidate);
    if (!cached) {
        cached = {
            normalized: normalizeStrokesForTemplate(candidate.strokes, {
                samplesPerStroke: CANDIDATE_SAMPLES_PER_STROKE,
                fitToBounds: true,
                digits: 5,
            }),
            rotations: new Map(),
        };
        candidateInkCache.set(candidate, cached);
    }

    const cachedInk = cached.rotations.get(rotationDeg);
    if (cachedInk) {
        return cachedInk;
    }

    const ink = renderInk(cached.normalized.strokes, rotationDeg);
    cached.rotations.set(rotationDeg, ink);
    return ink;
}

/** Calculates the number of overlapping pixels between two bitmaps. */
function maskOverlap(a: Uint8Array, b: Uint8Array): number {
    return wasmMaskOverlap(a, b);
}

/**
 * Calculates the Sørensen–Dice coefficient, a similarity score from 0 to 1.
 * 2 * (intersection) / (sum of total ink)
 */
function diceScore(
    a: Uint8Array,
    b: Uint8Array,
    aInk: number,
    bInk: number,
): number {
    if (!aInk || !bInk) {
        return 0;
    }
    return clamp((maskOverlap(a, b) * 2) / (aInk + bInk));
}

/** Downsamples a bitmap into a smaller grid (e.g., 10x10) to check regional ink presence. */
function occupiedCells(
    mask: Uint8Array,
    size: number = INK_SIZE,
    gridSize: number = REGION_GRID_SIZE,
): Uint8Array {
    return wasmOccupiedCells(mask, size, gridSize);
}

/**
 * Compares two ink sets by looking at regional presence (downsampled grids).
 * This helps detect if the candidate is missing large chunks of the template
 * or has extra strokes in "forbidden" areas.
 */
function cellStats(candidateInk: Ink, referenceInk: Ink) {
    const candidateCoreCells = occupiedCells(candidateInk.core.mask);
    const candidateLooseCells = occupiedCells(candidateInk.loose.mask);
    const referenceCoreCells = occupiedCells(referenceInk.core.mask);
    const referenceLooseCells = occupiedCells(referenceInk.loose.mask);

    let requiredCount = 0;
    let requiredCovered = 0;
    let candidateCount = 0;
    let forbiddenCandidateCount = 0;

    for (let index = 0; index < referenceCoreCells.length; index += 1) {
        // Did the template expect ink here?
        if (referenceCoreCells[index]) {
            requiredCount += 1;
            // Did the candidate provide ink anywhere near this region?
            if (candidateLooseCells[index]) {
                requiredCovered += 1;
            }
        }
        // Did the candidate draw ink here?
        if (candidateCoreCells[index]) {
            candidateCount += 1;
            // Is this region "empty" in the template?
            if (!referenceLooseCells[index]) {
                forbiddenCandidateCount += 1;
            }
        }
    }

    const requiredCellCoverage = requiredCount
        ? requiredCovered / requiredCount
        : 0;
    const forbiddenCellInkRatio = candidateCount
        ? forbiddenCandidateCount / candidateCount
        : 1;
    // Combine coverage and avoidance into a single score.
    const regionScore = clamp(
        requiredCellCoverage * 0.68 + (1 - forbiddenCellInkRatio) * 0.32,
    );

    return {
        requiredCellCoverage,
        forbiddenCellInkRatio,
        regionScore,
    };
}

/**
 * Compares two Ink objects (candidate vs template) using multiple metrics.
 *
 * Complex: This uses "fuzzy" matching by comparing different thickening levels.
 * We check if the candidate's thin lines fall within the template's thick lines, and vice versa.
 */
function compareInk(candidateInk: Ink, referenceInk: Ink) {
    const candidateInkCount = candidateInk.core.ink;
    const referenceInkCount = referenceInk.core.ink;

    if (!candidateInkCount || !referenceInkCount) {
        return {
            inkScore: 0,
            candidateExplainedRatio: 0,
            templateCoveredRatio: 0,
            softDiceScore: 0,
            unexplainedInkRatio: 1,
            missingInkRatio: 1,
            contaminationRisk: 1,
            requiredCellCoverage: 0,
            forbiddenCellInkRatio: 1,
            regionScore: 0,
        };
    }

    // How much of the candidate's ink is "explained" by the template's path?
    const candidateExplainedRatio = clamp(
        maskOverlap(candidateInk.core.mask, referenceInk.loose.mask) /
            candidateInkCount,
    );
    // How much of the template's path is "covered" by the candidate's ink?
    const templateCoveredRatio = clamp(
        maskOverlap(referenceInk.core.mask, candidateInk.loose.mask) /
            referenceInkCount,
    );
    // Intersection over Union (Dice) on moderately thickened paths.
    const softDiceScore = diceScore(
        candidateInk.soft.mask,
        referenceInk.soft.mask,
        candidateInk.soft.ink,
        referenceInk.soft.ink,
    );
    const unexplainedInkRatio = clamp(1 - candidateExplainedRatio);
    const missingInkRatio = clamp(1 - templateCoveredRatio);
    const regions = cellStats(candidateInk, referenceInk);

    // Final weighted score balancing detail matching and regional topology.
    const inkScore = clamp(
        candidateExplainedRatio * 0.32 +
            templateCoveredRatio * 0.32 +
            softDiceScore * 0.14 +
            regions.requiredCellCoverage * 0.16 +
            (1 - regions.forbiddenCellInkRatio) * 0.06,
    );
    // High contamination means the candidate has too much ink where it shouldn't,
    // or is missing too much where it should be.
    const contaminationRisk = clamp(
        clamp((unexplainedInkRatio - 0.26) / 0.34) * 0.58 +
            clamp((missingInkRatio - 0.46) / 0.34) * 0.22 +
            clamp((regions.forbiddenCellInkRatio - 0.18) / 0.46) * 0.2,
    );

    return {
        inkScore,
        candidateExplainedRatio,
        templateCoveredRatio,
        softDiceScore,
        unexplainedInkRatio,
        missingInkRatio,
        contaminationRisk,
        ...regions,
    };
}

/**
 * Main entry point for matching a hand-drawn symbol against a reference template.
 * It uses a multi-layered bitmap matching approach that is robust to hand jitter
 * and slight geometric distortions.
 *
 * @param candidate - The user's hand-drawn symbol.
 * @param strokeTemplate - The dictionary template to compare against.
 * @param options - Matching parameters like allowed rotations.
 * @returns A confidence score and detailed matching metrics.
 */
export function scoreStrokeTemplate(
    candidate: SymbolCandidate,
    strokeTemplate: { strokes?: (Stroke | Point[])[] },
    options: {
        allowedRotationsDeg?: number[];
        rotationInvariant?: boolean;
    } = {},
) {
    if (!strokeTemplate?.strokes?.length) {
        return {
            available: false,
            confidence: 0,
            rotationDeg: 0,
            recognitionRotationDeg: 0,
            inkScore: 0,
            softDiceScore: 0,
            candidateExplainedRatio: 0,
            templateCoveredRatio: 0,
            unexplainedInkRatio: 1,
            missingInkRatio: 1,
            contaminationRisk: 1,
            requiredCellCoverage: 0,
            forbiddenCellInkRatio: 1,
            regionScore: 0,
        };
    }

    const referenceInk = templateInk(strokeTemplate);

    let best = {
        rotationDeg: 0,
        rankingScore: -1,
        inkScore: 0,
        candidateExplainedRatio: 0,
        templateCoveredRatio: 0,
        softDiceScore: 0,
        unexplainedInkRatio: 1,
        missingInkRatio: 1,
        contaminationRisk: 1,
        requiredCellCoverage: 0,
        forbiddenCellInkRatio: 1,
        regionScore: 0,
    };

    // Test each allowed rotation and pick the one with the highest similarity score.
    for (const rotationDeg of rotationSet(options)) {
        const inkMatch = compareInk(
            candidateInk(candidate, rotationDeg),
            referenceInk,
        );
        // Apply a small penalty for rotation to favor the natural orientation if multiple matches are close.
        const rotationPenalty =
            normalizedRotationMagnitude(rotationDeg) *
            ROTATION_STABILITY_MARGIN;
        const rankingScore = inkMatch.inkScore - rotationPenalty;
        if (rankingScore > best.rankingScore) {
            best = {
                rotationDeg,
                rankingScore,
                ...inkMatch,
            };
        }
    }

    // Complex: Contamination Capping.
    // If the candidate has too much "extra" ink that doesn't belong to the template,
    // we aggressively cap the confidence to prevent false positives (e.g. matching a scribble to a simple line).
    const contaminationCap =
        best.unexplainedInkRatio > 0.36 && best.templateCoveredRatio < 0.82
            ? clamp(0.62 - (best.unexplainedInkRatio - 0.36) * 0.8, 0.2, 1)
            : 1;

    return {
        available: true,
        confidence: Math.min(clamp(best.rankingScore), contaminationCap),
        rotationDeg: best.rotationDeg,
        recognitionRotationDeg: best.rotationDeg,
        inkScore: best.inkScore,
        softDiceScore: best.softDiceScore,
        candidateExplainedRatio: best.candidateExplainedRatio,
        templateCoveredRatio: best.templateCoveredRatio,
        unexplainedInkRatio: best.unexplainedInkRatio,
        missingInkRatio: best.missingInkRatio,
        contaminationRisk: best.contaminationRisk,
        requiredCellCoverage: best.requiredCellCoverage,
        forbiddenCellInkRatio: best.forbiddenCellInkRatio,
        regionScore: best.regionScore,
    };
}
