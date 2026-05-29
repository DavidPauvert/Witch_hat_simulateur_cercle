import {
    angularDifference,
    boundsForPoints,
    clamp,
    dominantAxisOrientationDeg,
    normalizeAngleDeg,
    pathLength,
    strokeLength,
} from '../utils/geometry';
import { recognitionPlanForSymbol } from './signRotation';
import { scoreStrokeTemplate } from './templateMatcher';
import {
    SymbolKind,
    SymbolEntry,
    Dictionary,
    AppConfig,
    RecognitionResult,
    Point,
    SymbolCandidate,
} from '../types';

const RECOGNITION_AMBIGUITY_GAP = 0.065;
const SIMPLE_SIGN_STROKE_LIMIT = 6;
const SIMPLE_SIGN_MIN_TEMPLATE_COVERAGE = 0.78;
const templateFeatureCache = new WeakMap<any, TemplateFeatures>();

interface TemplateFeatures {
    aspectRatio: number;
    elongation: number;
    strokeCount: number;
    orientationDeg: number;
    strokeProfile: number[];
}

interface CandidateFeatures {
    aspectRatio: number;
    elongation: number;
    elongationNorm: number;
    strokeCount: number;
    strokeLengthImbalance: number;
    axisDominance: number;
    strokeProfile: number[];
}

/**
 * Calculates a score based on whether a symbol is allowed to appear in its current layer.
 * Some symbols (like sigils) might be restricted to specific parts of the spell ring.
 *
 * @param entry - The dictionary entry for the symbol.
 * @param candidate - The hand-drawn candidate being evaluated.
 * @returns A score from 0 to 1 indicating layer compatibility.
 */
function allowedLayerScore(
    entry: SymbolEntry,
    candidate: SymbolCandidate,
): number {
    if (candidate.layer === 'any') {
        return 1;
    }
    if (!entry.allowedLayers?.length) {
        // If no restrictions are defined, we give a slight penalty for unknown intent,
        // but generally allow it.
        return 0.75;
    }
    if (entry.allowedLayers.includes(candidate.layer)) {
        return 1;
    }
    // "Near boundary" means the symbol is sitting between two layers; we're more lenient here.
    if (candidate.nearBoundary) {
        return 0.72;
    }
    return 0.34;
}

/** Normalizes a value to a 0-1 score based on how well it fits within a preferred min/max range. */
function rangeScore(value: number, min: number, max: number): number {
    if (value < min) {
        return clamp(value / Math.max(0.001, min));
    }
    if (value > max) {
        return clamp(1 - (value - max) / Math.max(0.001, max));
    }
    return 1;
}

/** Retrieves configuration thresholds for symbol recognition. */
function recognitionThresholds(config: AppConfig) {
    const recognition = config.recognition ?? {};
    return {
        minConfidence: recognition.minConfidence ?? 0.48,
        ambiguityGap: RECOGNITION_AMBIGUITY_GAP,
    };
}

/** Calculates the width-to-height aspect ratio. */
function aspectRatio(width: number, height: number): number {
    return Math.max(0.001, width) / Math.max(0.001, height);
}

/**
 * Calculates the effective aspect ratio of a shape if it were rotated.
 * This is used to compare hand-drawn symbols to templates regardless of orientation.
 */
function rotatedAspectRatio(ratio: number, rotationDeg: number): number {
    const normalized = Math.abs((normalizeAngleDeg(rotationDeg) % 180) - 90);
    // As we rotate, the width and height effectively "blend" into each other.
    const blend = 1 - normalized / 90;
    const logRatio = Math.log(Math.max(0.001, ratio));
    return Math.exp(logRatio * (1 - blend * 2));
}

/**
 * Compares the aspect ratio of a candidate to a template, accounting for rotation.
 *
 * @param candidateRatio - Aspect ratio of the drawn symbol.
 * @param templateRatio - Aspect ratio of the dictionary template.
 * @param rotationDeg - The rotation applied during matching.
 * @returns A compatibility score from 0 to 1.
 */
function aspectCompatibility(
    candidateRatio: number,
    templateRatio: number,
    rotationDeg: number,
): number {
    const adjustedCandidateRatio = rotatedAspectRatio(
        candidateRatio,
        rotationDeg,
    );
    // Use logarithmic distance for a more natural comparison of ratios.
    const distance = Math.abs(
        Math.log(adjustedCandidateRatio / Math.max(0.001, templateRatio)),
    );
    return clamp(1 - distance / 1.1);
}

/** Calculates the smallest angle between two orientations, ignoring direction (modulo 180). */
function undirectedAngularDifference(a: number, b: number): number {
    const difference = angularDifference(a, b);
    return Math.min(difference, Math.abs(180 - difference));
}

/**
 * Generates a "profile" of stroke lengths for a symbol.
 * The profile is an array of relative lengths (e.g. [0.6, 0.4] for two strokes).
 * This helps distinguish symbols by their internal complexity.
 */
function strokeLengthProfile(
    strokes: any[],
    pointGetter: (s: any) => Point[],
): number[] {
    const lengths = strokes
        .map((stroke) => pathLength(pointGetter(stroke)))
        .filter((length) => length > 0.0001)
        .sort((a, b) => b - a);
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (!total) {
        return [];
    }
    return lengths.map((length) => length / total);
}

/** Compares two stroke length profiles by calculating the Manhattan distance between them. */
function profileCompatibility(
    candidateProfile: number[],
    templateProfile: number[],
): number {
    const count = Math.max(candidateProfile.length, templateProfile.length);
    if (!count) {
        return 1;
    }

    let distance = 0;
    for (let index = 0; index < count; index += 1) {
        distance += Math.abs(
            (candidateProfile[index] ?? 0) - (templateProfile[index] ?? 0),
        );
    }
    return clamp(1 - distance / 1.4);
}

/** Compares the number of strokes between a candidate and a template. */
function strokeCountCompatibility(
    candidateCount: number,
    templateCount: number,
): number {
    if (!candidateCount || !templateCount) {
        return 0;
    }
    return clamp(
        1 -
            Math.abs(candidateCount - templateCount) /
                Math.max(candidateCount, templateCount),
    );
}

/**
 * Extracts and caches geometric features of a dictionary template.
 */
function templateFeatures(strokeTemplate: any): TemplateFeatures {
    const cached = templateFeatureCache.get(strokeTemplate);
    if (cached) {
        return cached;
    }

    const strokes = strokeTemplate?.strokes ?? [];
    const points = strokes.flat();
    const bounds = boundsForPoints(points);
    const width = Math.max(0.001, bounds.width);
    const height = Math.max(0.001, bounds.height);
    const features = {
        aspectRatio: aspectRatio(width, height),
        elongation:
            Math.max(width, height) / Math.max(0.001, Math.min(width, height)),
        strokeCount: strokes.length,
        orientationDeg: dominantAxisOrientationDeg(points),
        strokeProfile: strokeLengthProfile(strokes, (stroke) => stroke),
    };
    templateFeatureCache.set(strokeTemplate, features);
    return features;
}

/**
 * Extracts geometric features of a hand-drawn symbol candidate.
 */
function candidateFeatures(candidate: SymbolCandidate): CandidateFeatures {
    const bounds = candidate.bounds;
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const elongation =
        Math.max(width, height) / Math.max(1, Math.min(width, height));

    const strokeProfiles = candidate.strokes
        .map((stroke) => {
            const length = strokeLength(stroke);
            return { length };
        })
        .sort((a, b) => b.length - a.length);

    const totalStrokeLength = strokeProfiles.reduce(
        (sum, stroke) => sum + stroke.length,
        0,
    );

    const dominantStroke = strokeProfiles[0] ?? { length: 0 };
    const secondaryStroke = strokeProfiles[1] ?? { length: 0 };

    // Imbalance measures if one stroke is much longer than others.
    const strokeLengthImbalance =
        strokeProfiles.length > 1
            ? (dominantStroke.length - secondaryStroke.length) / Math.max(0.001, totalStrokeLength)
            : 0;

    const elongationNorm = clamp((elongation - 1) / 3);
    // Axis dominance is a high-level feature combining shape stretch and stroke dominance.
    const axisDominance = clamp(
        strokeLengthImbalance * 1.35 + elongationNorm * 0.35,
    );

    return {
        aspectRatio: aspectRatio(width, height),
        elongation,
        elongationNorm,
        strokeCount: candidate.strokes.length,
        strokeLengthImbalance,
        axisDominance,
        strokeProfile: strokeLengthProfile(
            candidate.strokes,
            (stroke) => stroke.points ?? [],
        ),
    };
}

/**
 * Calculates a "structural" compatibility score that doesn't rely on pixel-by-pixel matching.
 * It looks at high-level properties like aspect ratio, stroke count, and relative stroke lengths.
 */
function structuralCompatibility(
    kind: SymbolKind,
    entry: SymbolEntry,
    candidate: SymbolCandidate,
    features: CandidateFeatures,
    templateMatch: any,
) {
    const template = templateFeatures(entry.strokeTemplate);
    const aspectScore = aspectCompatibility(
        features.aspectRatio,
        template.aspectRatio,
        templateMatch.rotationDeg ?? 0,
    );

    // Check if the bitmap matcher already found a very strong match.
    const overdrawCompatible =
        templateMatch.candidateExplainedRatio >= 0.9 &&
        templateMatch.templateCoveredRatio >= 0.82 &&
        templateMatch.unexplainedInkRatio <= 0.16;

    const rawCountScore = strokeCountCompatibility(
        features.strokeCount,
        template.strokeCount,
    );
    const rawProfileScore = profileCompatibility(
        features.strokeProfile,
        template.strokeProfile,
    );

    // Be more lenient on stroke counts/profiles if the overdraw looks correct (user might have "doubled back").
    const countScore =
        overdrawCompatible && features.strokeCount > template.strokeCount
            ? Math.max(rawCountScore, 0.86)
            : rawCountScore;
    const profileScore =
        overdrawCompatible && features.strokeCount > template.strokeCount
            ? Math.max(rawProfileScore, 0.82)
            : rawProfileScore;

    const rotatedCandidateAxis = normalizeAngleDeg(
        candidate.orientationDeg + (templateMatch.rotationDeg ?? 0),
    );
    const axisScore = clamp(
        1 -
            undirectedAngularDifference(
                rotatedCandidateAxis,
                template.orientationDeg,
            ) /
                90,
    );

    const smallSign =
        kind === 'sign' && template.strokeCount <= SIMPLE_SIGN_STROKE_LIMIT;

    // Weighted sum of structural features: signs care more about stroke count, sigils more about aspect.
    const strokeStructureScore = smallSign
        ? countScore * 0.58 + profileScore * 0.42
        : countScore * 0.24 + profileScore * 0.76;

    const score =
        kind === 'sign'
            ? strokeStructureScore * 0.68 + aspectScore * 0.2 + axisScore * 0.12
            : aspectScore * 0.54 + profileScore * 0.28 + countScore * 0.18;

    return {
        score: clamp(score),
        aspectScore,
        strokeCountScore: countScore,
        strokeProfileScore: profileScore,
        axisScore,
        candidateAspectRatio: features.aspectRatio,
        templateAspectRatio: template.aspectRatio,
        candidateStrokeCount: features.strokeCount,
        templateStrokeCount: template.strokeCount,
    };
}

/**
 * Heuristic to detect if a match is "contaminated" by extra ink or drawn in the wrong place.
 */
function isContaminatedMatch(candidate: SymbolCandidate, best: any) {
    const templateMatch = best?.templateMatch;
    if (!templateMatch) {
        return false;
    }

    // High Risk: Lots of ink that isn't part of the template.
    const highRiskExtraInk =
        templateMatch.contaminationRisk >= 0.62 &&
        templateMatch.unexplainedInkRatio >= 0.34;

    // Risk: Symbol is much bigger than expected but the match is weak.
    const oversizedWeakMatch =
        candidate.sizeNorm >= 0.42 &&
        templateMatch.unexplainedInkRatio >= 0.26 &&
        best.confidence < 0.7;

    // Risk: Ink is in regions the template says should be empty.
    const wrongRegionInk =
        templateMatch.forbiddenCellInkRatio >= 0.42 &&
        templateMatch.requiredCellCoverage <= 0.82 &&
        best.confidence < 0.72;

    return highRiskExtraInk || oversizedWeakMatch || wrongRegionInk;
}

/** Heuristic to detect if a drawing is too "messy" (high overdraw or low geometric neatness). */
function isMessyMatch(candidate: SymbolCandidate, best: any) {
    const templateMatch = best?.templateMatch;
    if (!templateMatch) {
        return false;
    }

    return (
        candidate.overdrawAmount >= 0.24 ||
        candidate.neatness <= 0.74 ||
        (templateMatch.candidateExplainedRatio >= 0.9 &&
            templateMatch.softDiceScore < 0.74)
    );
}

/**
 * Final determination of recognition quality based on confidence and competitors.
 */
function recognitionStatus(
    candidate: SymbolCandidate,
    best: any,
    second: any,
    secondSameKind: any,
    accepted: boolean,
    thresholds: any,
): RecognitionResult['recognitionStatus'] {
    if (!best) {
        return 'unknown';
    }
    if (isContaminatedMatch(candidate, best)) {
        return 'contaminated';
    }
    // Ambiguous: structural and confidence scores both disagree or are weak.
    if (best.structuralMatch?.score < 0.42 && best.confidence < 0.7) {
        return 'ambiguous';
    }
    if (!accepted) {
        return 'unknown';
    }

    // Check if the runner-up is too close to the winner.
    const competitor = Math.max(
        second.confidence ?? 0,
        secondSameKind.confidence ?? 0,
    );
    const bestInk = best.templateMatch ?? {};

    // If it's a "perfect" bitmap match, we ignore the gap threshold.
    const clearInkIdentity =
        bestInk.inkScore >= 0.92 &&
        bestInk.candidateExplainedRatio >= 0.98 &&
        bestInk.templateCoveredRatio >= 0.98;

    if (
        !clearInkIdentity &&
        best.confidence - competitor < thresholds.ambiguityGap
    ) {
        return 'ambiguous';
    }
    if (isMessyMatch(candidate, best)) {
        return 'valid_messy';
    }
    return 'valid';
}

/**
 * Calculates a complete similarity score between a candidate and a dictionary template.
 * This is the core logic that balances visual similarity (bitmaps) and structural similarity (skeletons).
 */
function scoreByStrokeTemplate(
    kind: SymbolKind,
    entry: SymbolEntry,
    candidate: SymbolCandidate,
    features: CandidateFeatures,
) {
    const layerScore = allowedLayerScore(entry, candidate);
    const strokeTemplate = entry.strokeTemplate;

    if (!strokeTemplate?.strokes?.length) {
        return {
            confidence: 0,
            templateMatch: null,
            structuralMatch: null,
        };
    }

    // The recognition plan determines things like "should we test all rotations?".
    const recognitionPlan = recognitionPlanForSymbol(kind, entry, candidate);
    const matchFeatures =
        kind === 'sign'
            ? candidateFeatures(recognitionPlan.candidate)
            : features;

    // 1. Perform bitmap-based template matching (fuzzy pixels).
    const rawTemplateMatch = scoreStrokeTemplate(
        recognitionPlan.candidate,
        strokeTemplate,
        recognitionPlan.options,
    );

    const templateMatch = {
        ...rawTemplateMatch,
        rotationDeg: normalizeAngleDeg(
            recognitionPlan.baseRotationDeg +
                (rawTemplateMatch.rotationDeg ?? 0),
        ),
        recognitionRotationDeg: normalizeAngleDeg(
            recognitionPlan.baseRotationDeg +
                (rawTemplateMatch.recognitionRotationDeg ??
                    rawTemplateMatch.rotationDeg ??
                    0),
        ),
    };

    // 2. Perform structural matching (ratios and counts).
    const structuralMatch = structuralCompatibility(
        kind,
        entry,
        recognitionPlan.candidate,
        matchFeatures,
        rawTemplateMatch,
    );

    // 3. Score overall quality: favor medium-sized symbols.
    const sizeScore = rangeScore(candidate.sizeNorm, 0.045, 0.46);

    // Complex: Heuristic adjustments.
    // Small signs (like dots or simple lines) need extra structural validation to prevent "accidental" matches.
    const simpleSignStructureMultiplier =
        kind === 'sign' &&
        structuralMatch.templateStrokeCount <= SIMPLE_SIGN_STROKE_LIMIT
            ? 0.42 + structuralMatch.strokeCountScore * 0.58
            : 1;

    const simpleSignIncompleteCap =
        kind === 'sign' &&
        structuralMatch.templateStrokeCount <= SIMPLE_SIGN_STROKE_LIMIT &&
        templateMatch.templateCoveredRatio < SIMPLE_SIGN_MIN_TEMPLATE_COVERAGE
            ? 0.44
            : 1;

    // Gross structure mismatch: if the candidate "looks" nothing like the template, cap the score.
    const grossStructureMismatchCap =
        structuralMatch.score < 0.18 && templateMatch.templateCoveredRatio < 0.5
            ? 0.44
            : 1;

    // Final weighted score aggregation.
    const contextualScore =
        templateMatch.confidence * 0.68 +
        structuralMatch.score * 0.13 +
        layerScore * 0.1 +
        sizeScore * 0.04 +
        candidate.neatness * 0.05;

    // Cap how much "context" (like layer/neatness) can boost a weak visual match.
    const contextLiftCap = templateMatch.confidence + 0.035;

    return {
        confidence: Math.min(
            clamp(
                Math.min(contextualScore, contextLiftCap) *
                    simpleSignStructureMultiplier,
            ),
            simpleSignIncompleteCap,
            grossStructureMismatchCap,
        ),
        templateMatch,
        structuralMatch,
    };
}

/** Simplifies a SymbolCandidate for public API consumption. */
function publicCandidate(candidate: SymbolCandidate) {
    return {
        candidateId: candidate.candidateId,
        strokeIds: candidate.strokeIds,
        rawStrokeCount: candidate.rawStrokeCount,
        cleanedStrokeCount: candidate.cleanedStrokeCount,
        layer: candidate.layer,
        nearBoundary: candidate.nearBoundary,
        radiusNorm: candidate.radiusNorm,
        angleDeg: candidate.angleDeg,
        sizeNorm: candidate.sizeNorm,
        lengthNorm: candidate.lengthNorm,
        orientationDeg: candidate.orientationDeg,
        directedOrientationDeg: candidate.directedOrientationDeg,
        radialFacing: candidate.radialFacing,
        overdrawAmount: candidate.overdrawAmount,
        neatness: candidate.neatness,
        strokes: candidate.strokes,
        bounds: candidate.bounds,
        center: candidate.center,
        closedness: candidate.closedness,
    };
}

/**
 * Main entry point for the recognition engine.
 * It takes grouped stroke "candidates" and matches them against every entry in the dictionary.
 *
 * @param candidates - The hand-drawn groups to recognize.
 * @param dictionary - The loaded sigil and sign dictionary.
 * @param config - Application configuration.
 * @returns A list of RecognitionResults identifying the best match for each candidate.
 */
export function recognizeCandidates(
    candidates: SymbolCandidate[],
    dictionary: Dictionary,
    config: AppConfig,
): RecognitionResult[] {
    const entries: { kind: SymbolKind; entry: SymbolEntry }[] = [
        ...Object.values(dictionary.sigils).map((entry) => ({
            kind: 'sigil' as SymbolKind,
            entry,
        })),
        ...Object.values(dictionary.signs).map((entry) => ({
            kind: 'sign' as SymbolKind,
            entry,
        })),
    ];

    return candidates.map((candidate) => {
        const thresholds = recognitionThresholds(config);
        const features = candidateFeatures(candidate);

        // Score this candidate against EVERY entry in the dictionary.
        const scored = entries
            .map(({ kind, entry }) => ({
                kind,
                entry,
                ...scoreByStrokeTemplate(kind, entry, candidate, features),
            }))
            .sort((a, b) => b.confidence - a.confidence);

        const best = scored[0];
        const second = scored[1] ?? { confidence: 0, entry: null, kind: null };
        const secondSameKind = scored.find(
            (score) =>
                score.kind === best?.kind &&
                score.entry?.id !== best?.entry?.id,
        ) ?? {
            confidence: 0,
            entry: null,
            kind: null,
        };

        const acceptedByConfidence = Boolean(
            best && best.confidence >= thresholds.minConfidence,
        );

        // Final quality check: handle ambiguity and contamination.
        const status = recognitionStatus(
            candidate,
            best,
            second,
            secondSameKind,
            acceptedByConfidence,
            thresholds,
        );

        const accepted =
            acceptedByConfidence &&
            (status === 'valid' || status === 'valid_messy');

        const bestTemplateMatch = best?.templateMatch ?? null;
        const bestStructuralMatch = best?.structuralMatch ?? null;

        // Collect top 3 matches for debugging/diagnostics.
        const topMatches = scored.slice(0, 3).map((score) => ({
            kind: score.kind,
            id: score.entry.id,
            confidence: score.confidence,
            templateConfidence: score.templateMatch?.confidence ?? 0,
            inkScore: score.templateMatch?.inkScore ?? 0,
            candidateExplainedRatio:
                score.templateMatch?.candidateExplainedRatio ?? 0,
            templateCoveredRatio:
                score.templateMatch?.templateCoveredRatio ?? 0,
            structuralScore: score.structuralMatch?.score ?? 0,
            aspectScore: score.structuralMatch?.aspectScore ?? 0,
            strokeCountScore: score.structuralMatch?.strokeCountScore ?? 0,
            strokeProfileScore: score.structuralMatch?.strokeProfileScore ?? 0,
            rotationDeg: score.templateMatch?.rotationDeg ?? 0,
            recognitionRotationDeg:
                score.templateMatch?.recognitionRotationDeg ??
                score.templateMatch?.rotationDeg ??
                0,
        }));

        const bestGuess = best
            ? {
                  kind: best.kind,
                  id: best.entry.id,
                  confidence: best.confidence,
              }
            : null;

        return {
            ...publicCandidate(candidate),
            recognized: accepted,
            recognitionStatus: status,
            kind: accepted ? best!.kind : 'unknown',
            id: accepted ? best!.entry.id : null,
            displayName: accepted ? best!.entry.displayName : null,
            element: accepted ? (best!.entry.element ?? null) : null,
            semantic: accepted ? (best!.entry.semantic ?? null) : null,
            confidence: accepted ? best!.confidence : 0,
            shape: {
                strokeCount: features.strokeCount,
                aspectRatio: features.aspectRatio,
                elongation: features.elongation,
                elongationNorm: features.elongationNorm,
                strokeLengthImbalance: features.strokeLengthImbalance,
                axisDominance: features.axisDominance,
            },
            diagnostics: {
                bestGuess: accepted ? null : bestGuess,
                recognitionRotationDeg:
                    bestTemplateMatch?.recognitionRotationDeg ??
                    bestTemplateMatch?.rotationDeg ??
                    0,
                template: {
                    inkScore: bestTemplateMatch?.inkScore ?? 0,
                    softDiceScore: bestTemplateMatch?.softDiceScore ?? 0,
                    candidateExplainedRatio:
                        bestTemplateMatch?.candidateExplainedRatio ?? 0,
                    templateCoveredRatio:
                        bestTemplateMatch?.templateCoveredRatio ?? 0,
                    unexplainedInkRatio:
                        bestTemplateMatch?.unexplainedInkRatio ?? 1,
                    missingInkRatio: bestTemplateMatch?.missingInkRatio ?? 1,
                    contaminationRisk:
                        bestTemplateMatch?.contaminationRisk ?? 0,
                    forbiddenCellInkRatio:
                        bestTemplateMatch?.forbiddenCellInkRatio ?? 1,
                },
                structure: {
                    score: bestStructuralMatch?.score ?? 0,
                    aspectScore: bestStructuralMatch?.aspectScore ?? 0,
                    strokeCountScore:
                        bestStructuralMatch?.strokeCountScore ?? 0,
                    strokeProfileScore:
                        bestStructuralMatch?.strokeProfileScore ?? 0,
                    axisScore: bestStructuralMatch?.axisScore ?? 0,
                    candidateAspectRatio:
                        bestStructuralMatch?.candidateAspectRatio ??
                        features.aspectRatio,
                    templateAspectRatio:
                        bestStructuralMatch?.templateAspectRatio ?? 1,
                    candidateStrokeCount:
                        bestStructuralMatch?.candidateStrokeCount ??
                        features.strokeCount,
                    templateStrokeCount:
                        bestStructuralMatch?.templateStrokeCount ?? 0,
                },
                topMatches,
            },
        };
    });
}
