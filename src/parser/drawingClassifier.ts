import { cleanStrokes, CleanedStroke } from './strokeCleaner';
import { detectRing } from './ringDetector';
import { classifyStrokesAgainstRing } from './coordinateNormalizer';
import { buildSymbolCandidates } from './strokeGrouper';
import { recognizeCandidates } from './symbolRecognizer';
import { GLYPH_WARNINGS } from './glyphWarnings';
import {
    clamp,
    formatNumber,
    mean,
    vectorFromAngleDeg,
} from '../utils/geometry';
import {
    Stroke,
    RingCandidate,
    Dictionary,
    AppConfig,
    RecognitionResult,
    GlyphAST,
    SymbolCandidate,
    StrokeClassification,
} from '../types';

/**
 * Recursively traverses an object and rounds all numeric values to a fixed precision.
 * This is used to make the diagnostic output (AST) cleaner and more readable.
 */
function roundedDeep(value: any): any {
    if (Array.isArray(value)) {
        return value.map(roundedDeep);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                roundedDeep(item),
            ]),
        );
    }
    return formatNumber(value);
}

/**
 * Calculates a priority score for a recognized sigil.
 * Sigils closer to the center are given a higher priority.
 */
function primarySigilScore(sigil: RecognitionResult): number {
    const layerBonus =
        sigil.layer === 'center' ? 0.12 : sigil.radiusNorm <= 0.45 ? 0.06 : 0;
    return sigil.confidence + layerBonus;
}

/** Filters the list of recognitions to only include valid sigils, sorted by confidence. */
function recognizedSigils(
    recognitions: RecognitionResult[],
): RecognitionResult[] {
    return recognitions
        .filter(
            (recognition) =>
                recognition.recognized && recognition.kind === 'sigil',
        )
        .sort((a, b) => b.confidence - a.confidence);
}

/** Selects the most likely primary sigil from a list of possibilities. */
function selectPrimarySigil(
    sigils: RecognitionResult[],
): RecognitionResult | null {
    return (
        [...sigils].sort(
            (a, b) => primarySigilScore(b) - primarySigilScore(a),
        )[0] ?? null
    );
}

/**
 * Provides diagnostic details for drawing groups that the recognizer failed to identify.
 */
function summarizeUnknowns(
    candidates: SymbolCandidate[],
    recognitions: RecognitionResult[],
) {
    const byCandidate = new Map(
        recognitions.map((recognition) => [
            recognition.candidateId,
            recognition,
        ]),
    );
    return candidates
        .filter(
            (candidate) => !byCandidate.get(candidate.candidateId)?.recognized,
        )
        .map((candidate) => {
            const recognition = byCandidate.get(candidate.candidateId);
            return {
                candidateId: candidate.candidateId,
                strokeIds: candidate.strokeIds,
                layer: candidate.layer,
                radiusNorm: candidate.radiusNorm,
                angleDeg: candidate.angleDeg,
                reason: recognition?.recognitionStatus ?? 'no_confident_match',
                bestGuess: recognition?.diagnostics?.bestGuess ?? null,
            };
        });
}

/**
 * Calculates a vector representing the average directional spread of the signs.
 * Used to measure how balanced or "lopsided" the spell circle is.
 */
function calculateDirectionalBias(signs: RecognitionResult[]) {
    if (!signs.length) {
        return { x: 0, y: 0 };
    }

    const vector = signs.reduce(
        (sum, sign) => {
            const direction = vectorFromAngleDeg(sign.angleDeg);
            // Weight signs by confidence, neatness, and size to determine their visual impact.
            const weight =
                sign.confidence *
                (sign.neatness ?? 0.6) *
                Math.max(0.3, sign.sizeNorm + sign.lengthNorm);
            return {
                x: sum.x + direction.x * weight,
                y: sum.y + direction.y * weight,
            };
        },
        { x: 0, y: 0 },
    );

    const magnitude = Math.hypot(vector.x, vector.y);
    if (magnitude < 0.001) {
        return { x: 0, y: 0 };
    }
    return {
        x: vector.x / magnitude,
        y: vector.y / magnitude,
    };
}

/**
 * Aggregates low-level drawing data into high-level quality metrics.
 * Neatness: How well the strokes follow the ideal paths.
 * Radial Symmetry: How evenly distributed the signs are around the circle.
 * Instability: A penalty score based on mistakes, contamination, and messiness.
 */
function calculateGlobalMetrics(
    ring: RingCandidate,
    recognitions: RecognitionResult[],
    unknowns: any[],
) {
    const recognized = recognitions.filter(
        (recognition) => recognition.recognized,
    );
    const neatnessAverage = mean(
        [
            ring.neatness ?? 0,
            ...recognized.map((recognition) => recognition.neatness ?? 0.6),
        ].filter((value) => value > 0),
    );
    const signs = recognized.filter(
        (recognition) => recognition.kind === 'sign',
    );
    const directionalBias = calculateDirectionalBias(signs);

    // Penalties for various issues found during parsing.
    const unknownPenalty = clamp(unknowns.length / 6);
    const contaminatedPenalty = clamp(
        recognitions.filter(
            (recognition) => recognition.recognitionStatus === 'contaminated',
        ).length / 4,
    );
    const ambiguousPenalty = clamp(
        recognitions.filter(
            (recognition) => recognition.recognitionStatus === 'ambiguous',
        ).length / 5,
    );
    const messyPenalty = clamp(
        recognitions.filter(
            (recognition) => recognition.recognitionStatus === 'valid_messy',
        ).length / 8,
    );

    return {
        neatness: clamp(neatnessAverage || 0),
        radialSymmetry: clamp(
            1 - Math.hypot(directionalBias.x, directionalBias.y) * 0.35,
        ),
        instability: clamp(
            0.22 +
                unknownPenalty * 0.34 +
                contaminatedPenalty * 0.22 +
                ambiguousPenalty * 0.12 +
                messyPenalty * 0.08 +
                (1 - (ring.neatness ?? 0.4)) * 0.36,
        ),
    };
}

/** Removes internal geometric data (raw strokes) to keep the AST lightweight. */
function stripCandidate(candidate: SymbolCandidate) {
    const { strokes, ...publicCandidate } = candidate;
    return publicCandidate;
}

/** Removes heavy internal diagnostics (like pixel bitmaps) from recognition results. */
function stripRecognitionDiagnostics(recognition: RecognitionResult | null) {
    if (!recognition) {
        return null;
    }
    const { diagnostics, ...publicRecognition } = recognition;
    return publicRecognition as any;
}

/**
 * Checks all aspects of the drawing to generate a list of human-readable warnings.
 */
function warningList(
    ring: RingCandidate,
    primarySigil: RecognitionResult | null,
    unsupportedMultipleSigils: any[],
    unknowns: any[],
    recognitions: RecognitionResult[],
) {
    const warnings: string[] = [];
    if (!ring.found) {
        warnings.push(GLYPH_WARNINGS.noRingDetected);
    } else if (!ring.complete) {
        warnings.push(GLYPH_WARNINGS.ringIncomplete);
    }
    if (ring.unsupportedNestedRings?.length) {
        warnings.push(GLYPH_WARNINGS.unsupportedNestedRing);
    }
    if (ring.unsupportedMultipleRings?.length) {
        warnings.push(GLYPH_WARNINGS.unsupportedMultipleRings);
    }
    if (unsupportedMultipleSigils.length) {
        warnings.push(GLYPH_WARNINGS.unsupportedMultipleSigils);
    }
    if (!primarySigil) {
        warnings.push(GLYPH_WARNINGS.missingPrimarySigil);
    }
    if (unknowns.some((unknown) => unknown.radiusNorm <= 0.36)) {
        warnings.push(GLYPH_WARNINGS.centerUnknownContamination);
    }
    if (
        recognitions.some(
            (recognition) => recognition.recognized && recognition.nearBoundary,
        )
    ) {
        warnings.push(GLYPH_WARNINGS.symbolNearLayerBoundary);
    }
    if (
        recognitions.some(
            (recognition) => recognition.recognitionStatus === 'contaminated',
        )
    ) {
        warnings.push(GLYPH_WARNINGS.symbolContaminated);
    }
    if (
        recognitions.some(
            (recognition) => recognition.recognitionStatus === 'ambiguous',
        )
    ) {
        warnings.push(GLYPH_WARNINGS.symbolAmbiguous);
    }
    if (
        recognitions.some(
            (recognition) => recognition.recognitionStatus === 'valid_messy',
        )
    ) {
        warnings.push(GLYPH_WARNINGS.symbolMessy);
    }
    return warnings;
}

export interface ClassificationResult {
    cleanedStrokes: CleanedStroke[];
    ring: RingCandidate;
    classifications: StrokeClassification[];
    candidates: SymbolCandidate[];
    recognitions: RecognitionResult[];
    glyphAST: GlyphAST;
}

/**
 * Main entrance for the drawing interpretation pipeline.
 * It transforms raw hand-drawn strokes into a high-level Spell AST (Abstract Syntax Tree).
 *
 * Pipeline stages:
 * 1. Clean and smooth strokes.
 * 2. Detect the primary spell circle (ring).
 * 3. Classify strokes based on their position relative to the ring.
 * 4. Group strokes into symbol candidates.
 * 5. Recognize symbols using the dictionary.
 * 6. Aggregate results into the final AST and generate warnings.
 *
 * @returns An object containing both the intermediate data and the final GlyphAST.
 */
export function classifyDrawing({
    strokes,
    previousRing = null,
    dictionary,
    config,
}: {
    strokes: Stroke[];
    previousRing?: RingCandidate | null;
    dictionary: Dictionary;
    config: AppConfig;
}): ClassificationResult {
    const cleanedStrokes = cleanStrokes(strokes, config);
    const rings = detectRing(cleanedStrokes, previousRing, config);
    const ring = rings[0];

    if (!ring.found) {
        // If no circle is found, the spell cannot be processed.
        const glyphAST: GlyphAST = {
            type: 'GlyphAST',
            version: config.appVersion,
            rings,
            ring,
            candidates: [],
            primarySigil: null,
            unsupportedMultipleSigils: [],
            signs: [],
            unknowns: [],
            globalMetrics: {
                neatness: 0,
                radialSymmetry: 0,
                instability: 1,
            },
            warnings: [GLYPH_WARNINGS.noRingDetected],
        };
        return {
            cleanedStrokes,
            ring,
            classifications: [],
            candidates: [],
            recognitions: [],
            glyphAST,
        };
    }

    // Classify which strokes are the ring, which are symbols, and which layer they belong to.
    const classifications = classifyStrokesAgainstRing(
        cleanedStrokes,
        ring,
        config,
    );
    // Cluster strokes that are physically close together into potential symbols.
    const candidates = buildSymbolCandidates(
        cleanedStrokes,
        classifications,
        ring,
        config,
    );
    // Identify what those symbols are by comparing them to the dictionary.
    const recognitions = recognizeCandidates(candidates, dictionary, config);

    const sigils = recognizedSigils(recognitions);
    const primarySigil = selectPrimarySigil(sigils);

    const unsupportedMultipleSigils = sigils
        .filter(
            (recognition) =>
                recognition.candidateId !== primarySigil?.candidateId,
        )
        .map(stripRecognitionDiagnostics);

    const signs = recognitions
        .filter(
            (recognition) =>
                recognition.recognized && recognition.kind === 'sign',
        )
        .map(stripRecognitionDiagnostics);

    const unknowns = summarizeUnknowns(candidates, recognitions);
    const globalMetrics = calculateGlobalMetrics(ring, recognitions, unknowns);
    const warnings = warningList(
        ring,
        primarySigil,
        unsupportedMultipleSigils,
        unknowns,
        recognitions,
    );

    // Build the final, serialized Abstract Syntax Tree.
    const glyphAST = roundedDeep({
        type: 'GlyphAST',
        version: config.appVersion,
        rings,
        ring,
        candidates: candidates.map(stripCandidate),
        primarySigil: stripRecognitionDiagnostics(primarySigil),
        unsupportedMultipleSigils,
        signs,
        unknowns,
        globalMetrics,
        warnings,
    });

    return {
        cleanedStrokes,
        ring,
        classifications: roundedDeep(classifications),
        candidates,
        recognitions: roundedDeep(recognitions),
        glyphAST,
    };
}
