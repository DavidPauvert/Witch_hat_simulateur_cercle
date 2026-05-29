import { GLYPH_WARNINGS } from '../parser/glyphWarnings';
import { clamp, mean } from '../utils/geometry';
import { GlyphAST, AppConfig, RecognitionResult } from '../types';

const QUALITY_TUNING = {
    ringQuality: 0.25,
    primaryConfidence: 0.25,
    signConfidence: 0.2,
    signFallbackPrimaryConfidence: 0.7,
    globalNeatness: 0.15,
    radialSymmetry: 0.1,
    insideScore: 0.05,
    unknownSoftLimit: 7,
};

const STABILITY_TUNING = {
    ringNeatness: 0.36,
    symbolNeatness: 0.34,
    symbolNeatnessFallback: 0.35,
    radialSymmetry: 0.12,
    radialSymmetryFallback: 0.4,
    inverseInstability: 0.18,
    instabilityFallback: 0.5,
    unknownPenaltyMax: 0.34,
    unknownPenaltyScale: 0.24,
    ambiguityGrace: 0.14,
    boundaryPenalty: 0.08,
    centerPenalty: 0.16,
};

/**
 * Identifies the confidence score of the best alternative match that isn't the primary sigil.
 * This is used to penalize stability if the primary sigil is ambiguous.
 */
function topMatchCompetitorConfidence(
    recognition: RecognitionResult | null,
): number {
    if (!recognition) return 0;
    return (
        recognition.diagnostics?.topMatches?.find(
            (score: any) =>
                score.kind !== recognition.kind || score.id !== recognition.id,
        )?.confidence ?? 0
    );
}

/**
 * Calculates the overall "quality" of the drawn spell.
 * Quality is a measure of geometric perfection and recognition confidence.
 * Higher quality spells typically have more powerful or longer-lasting effects.
 *
 * @param glyphAST - The structured drawing data.
 * @returns A normalized score from 0 to 1.
 */
export function calculateSpellQuality(glyphAST: GlyphAST): number {
    const ringQuality = glyphAST.ring?.neatness ?? 0;
    const primaryConfidence = glyphAST.primarySigil?.confidence ?? 0;

    // Average confidence of all recognized signs.
    const signConfidence = mean(
        (glyphAST.signs ?? []).map((sign) => sign.confidence),
    );

    const globalNeatness = glyphAST.globalMetrics?.neatness ?? 0;
    const symmetry = glyphAST.globalMetrics?.radialSymmetry ?? 0;

    // Penalty for recognized shapes that the system couldn't identify.
    const insideScore =
        1 -
        Math.min(
            1,
            (glyphAST.unknowns?.length ?? 0) / QUALITY_TUNING.unknownSoftLimit,
        );

    // Weighted aggregation of all quality components.
    return clamp(
        ringQuality * QUALITY_TUNING.ringQuality +
            primaryConfidence * QUALITY_TUNING.primaryConfidence +
            (signConfidence ||
                primaryConfidence *
                    QUALITY_TUNING.signFallbackPrimaryConfidence) *
                QUALITY_TUNING.signConfidence +
            globalNeatness * QUALITY_TUNING.globalNeatness +
            symmetry * QUALITY_TUNING.radialSymmetry +
            insideScore * QUALITY_TUNING.insideScore,
    );
}

/**
 * Calculates the "stability" of the spell.
 * Stability measures how "safe" or "focused" the spell's energy is.
 * Instability is caused by messy drawing, ambiguous symbols, and unrecognized scribbles.
 *
 * @param glyphAST - The structured drawing data.
 * @param config - Application configuration.
 * @returns A normalized score from 0 to 1.
 */
export function calculateSpellStability(
    glyphAST: GlyphAST,
    config: AppConfig,
): number {
    const ringNeatness = glyphAST.ring?.neatness ?? 0;

    // Average neatness of all recognized symbols (sigil and signs).
    const symbolNeatness = mean(
        [
            glyphAST.primarySigil?.neatness ?? 0,
            ...(glyphAST.signs ?? []).map((sign) => sign.neatness),
        ].filter((v): v is number => Boolean(v)),
    );

    // Complex: Penalty Aggregation.
    // We start with a base stability and subtract penalties for various issues.

    // Penalty for unknown scribbles inside the ring.
    const unknownPenalty = Math.min(
        STABILITY_TUNING.unknownPenaltyMax,
        ((glyphAST.unknowns?.length ?? 0) /
            config.compiler.maxUnknownsBeforeInstability) *
            STABILITY_TUNING.unknownPenaltyScale,
    );

    // Penalty for ambiguity: if the primary sigil is "close" to another symbol.
    const ambiguityPenalty = Math.max(
        0,
        topMatchCompetitorConfidence(glyphAST.primarySigil) -
            (glyphAST.primarySigil?.confidence ?? 0) +
            STABILITY_TUNING.ambiguityGrace,
    );

    // Penalty for symbols sitting right on the edge of two ring layers.
    const boundaryPenalty = (glyphAST.warnings ?? []).includes(
        GLYPH_WARNINGS.symbolNearLayerBoundary,
    )
        ? STABILITY_TUNING.boundaryPenalty
        : 0;

    // Penalty for unrecognized ink in the center of the ring.
    const centerPenalty = (glyphAST.warnings ?? []).includes(
        GLYPH_WARNINGS.centerUnknownContamination,
    )
        ? STABILITY_TUNING.centerPenalty
        : 0;

    const inverseInstability =
        1 -
        (glyphAST.globalMetrics?.instability ??
            STABILITY_TUNING.instabilityFallback);

    // Sum component scores and subtract all penalties.
    return clamp(
        ringNeatness * STABILITY_TUNING.ringNeatness +
            (symbolNeatness || STABILITY_TUNING.symbolNeatnessFallback) *
                STABILITY_TUNING.symbolNeatness +
            (glyphAST.globalMetrics?.radialSymmetry ??
                STABILITY_TUNING.radialSymmetryFallback) *
                STABILITY_TUNING.radialSymmetry +
            inverseInstability * STABILITY_TUNING.inverseInstability -
            unknownPenalty -
            ambiguityPenalty -
            boundaryPenalty -
            centerPenalty,
    );
}
