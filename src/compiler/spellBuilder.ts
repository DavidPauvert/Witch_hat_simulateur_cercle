import { GLYPH_WARNINGS } from '../parser/glyphWarnings';
import { clamp } from '../utils/geometry';
import {
    aggregateManifestations,
    aggregateSemanticDeltas,
    combineSignDirection,
    signInfluence,
} from './semanticRules';
import { directionFromSurfaceVector } from './spellDirection';
import { calculateSpellQuality, calculateSpellStability } from './spellQuality';
import { GlyphAST, AppConfig, SpellIR, RecognitionResult } from '../types';

const PRIMARY_SIGIL_AMBIGUITY_GAP = 0.05;

const SUPPORTED_ELEMENTS = new Set(['fire', 'water', 'wind', 'earth', 'light']);

const SPELL_PARAMETER_TUNING = {
    focusBase: 0.46,
    focusQuality: 0.2,
    spreadBase: 0.32,
    spreadInverseFocus: 0.28,
    forceBase: 0.34,
    forceSignPower: 0.34,
    forceQuality: 0.18,
    rangeBase: 0.42,
    rangeSignPower: 0.18,
    durationMinSeconds: 0.65,
    durationMaxSeconds: 8.5,
    durationSecondsScale: 6.4,
    durationQualityWeight: 0.35,
    durationNeatnessWeight: 0.65,
    durationCurve: 1.45,
};

const PHYSICS_TUNING = {
    levitationGravityScale: 0.42,
};

/**
 * Finds the confidence score of the next best match for the same symbol category.
 * This is used to ensure the primary sigil is clearly distinguished and not ambiguous.
 */
function sameKindAlternateConfidence(recognition: RecognitionResult): number {
    return (
        recognition.diagnostics?.topMatches?.find(
            (score: any) =>
                score.kind === recognition.kind && score.id !== recognition.id,
        )?.confidence ?? 0
    );
}

/**
 * Generates a standard SpellIR object for a spell that is incomplete or invalid.
 * This ensures the rest of the application can handle error states gracefully.
 *
 * @param status - A human-readable error status message.
 * @param glyphAST - The current state of the drawing.
 * @param warnings - Additional warnings to include in the IR.
 * @returns A SpellIR object marked as invalid.
 */
function invalidSpell(
    status: string,
    glyphAST: GlyphAST,
    warnings: string[] = [],
): SpellIR {
    const ringComplete = Boolean(glyphAST.ring?.complete);
    const combinedWarnings = [
        ...new Set([...(glyphAST.warnings ?? []), ...warnings]),
    ];
    return {
        type: 'SpellIR',
        active: false,
        prepared: false,
        valid: false,
        status,
        activatedAt: null,
        element: null,
        elementConfidence: 0,
        primarySizeNorm: 0,
        effectScale: 1,
        primaryManifestation: 'none',
        manifestations: {},
        direction: {
            x: 0,
            y: 0,
            z: 1,
            xTiltDeg: 0,
            yTiltDeg: 0,
            tiltFromZDeg: 0,
        },
        directionCoherence: 0,
        gravity: 1,
        force: 0,
        spread: 0,
        focus: 0,
        range: 0,
        duration: 0,
        stability: 0,
        quality: 0,
        neatness: glyphAST.globalMetrics?.neatness ?? 0,
        warnings: combinedWarnings,
        signature: `invalid:${status}:${ringComplete}:${glyphAST.ring?.completeness ?? 0}`,
    };
}

/**
 * Calculates the vertical acceleration (gravity) for the spell effect.
 * Certain signs can reduce gravity, causing effects to float or drift upwards.
 */
function calculateSpellGravity(
    manifestationInfluence: Record<string, number>,
): number {
    return clamp(
        1 -
            (manifestationInfluence.levitation ?? 0) *
                PHYSICS_TUNING.levitationGravityScale,
    );
}

/**
 * Creates a unique string representation of all active manifestations (signs) in the spell.
 * This is used for checking if a spell's structure has changed enough to require a full re-render.
 */
function manifestationSignature(manifestations: Record<string, any>): string {
    return Object.entries(manifestations)
        .map(([id, manifestation]) => {
            const point = manifestation.point
                ? `.p${Math.round(manifestation.point.x * 100)}.${Math.round(manifestation.point.y * 100)}`
                : '';
            const radius =
                manifestation.radius === undefined
                    ? ''
                    : `.r${Math.round(manifestation.radius * 100)}`;
            return `${id}.${Math.round((manifestation.strength ?? 0) * 100)}${point}${radius}`;
        })
        .sort((a, b) => a.localeCompare(b))
        .join(',');
}

/**
 * Determines the lifespan of the spell effect in seconds.
 *
 * Complex: Duration calculation logic.
 * The base duration comes from the primary sigil's semantic properties.
 * This is then modified by "delta" signs (like lifetime bias) and heavily
 * influenced by the drawing's geometric quality and neatness.
 * High-quality drawings result in much longer-lasting spells.
 */
function calculateSpellDuration({
    primarySemantic,
    deltas,
    quality,
    neatness,
}: {
    primarySemantic: any;
    deltas: any;
    quality: number;
    neatness: number;
}): number {
    const min = SPELL_PARAMETER_TUNING.durationMinSeconds;
    const max = SPELL_PARAMETER_TUNING.durationMaxSeconds;
    const scale = SPELL_PARAMETER_TUNING.durationSecondsScale;

    // Base duration influenced by sigil semantic.
    const base = min + (primarySemantic.duration ?? 0.6) * scale;

    // Quality factor (0..1) combining geometric perfection and ink neatness.
    const qualityFactor = clamp(quality * 0.4 + neatness * 0.6);

    // Apply semantic deltas and an exponential quality curve to favor perfect drawings.
    const biasedBase = base * (1 + (deltas.lifetimeBias ?? 0));
    const finalDuration = biasedBase * Math.pow(qualityFactor, 1.2);

    return clamp(finalDuration, min, max);
}

/**
 * Main entrance for the spell compilation stage.
 * It transforms a structured Glyph AST (geometric data) into a functional Spell IR (physical parameters).
 *
 * Compilation steps:
 * 1. Validate AST: check for missing sigils, multiple rings, or ambiguity.
 * 2. Calculate spell quality: determine how "well-drawn" the spell is.
 * 3. Aggregate sign influences: sum up the effects of all drawn signs.
 * 4. Compute physical parameters: force, spread, focus, direction, gravity, etc.
 * 5. Generate a unique signature for the spell's configuration.
 *
 * @returns A SpellIR object ready for use by the renderer.
 */
export function compileSpell({
    glyphAST,
    config,
}: {
    glyphAST: GlyphAST;
    config: AppConfig;
}): SpellIR {
    if (!glyphAST?.ring?.found) {
        return invalidSpell(
            'No ring detected',
            glyphAST ?? { globalMetrics: {} },
        );
    }

    // Standard validations: check for errors that prevent spell construction.
    if (glyphAST.ring.unsupportedMultipleRings?.length) {
        return invalidSpell('Multiple rings detected', glyphAST, [
            GLYPH_WARNINGS.unsupportedMultipleRings,
        ]);
    }

    if (glyphAST.unsupportedMultipleSigils?.length) {
        return invalidSpell('Multiple sigils detected', glyphAST, [
            GLYPH_WARNINGS.unsupportedMultipleSigils,
        ]);
    }

    const primary = glyphAST.primarySigil;
    if (!primary) {
        return invalidSpell('Invalid spell', glyphAST, [
            GLYPH_WARNINGS.missingPrimarySigil,
        ]);
    }

    // Check if the recognizer is confident enough in the primary sigil.
    if (primary.confidence < config.compiler.minimumPrimarySigilConfidence) {
        return invalidSpell('Invalid spell', glyphAST, [
            GLYPH_WARNINGS.primarySigilConfidenceLow,
        ]);
    }

    // Check for ambiguity: the primary sigil must be clearly better than alternatives.
    const confidenceGap =
        primary.confidence - sameKindAlternateConfidence(primary);
    if (confidenceGap < PRIMARY_SIGIL_AMBIGUITY_GAP) {
        return invalidSpell('Ambiguous sigil', glyphAST, [
            GLYPH_WARNINGS.primarySigilAmbiguous,
        ]);
    }

    if (!primary.element) {
        return invalidSpell('Unsupported element', glyphAST, [
            GLYPH_WARNINGS.primaryElementMissing,
        ]);
    }

    if (!SUPPORTED_ELEMENTS.has(primary.element)) {
        return invalidSpell('Unsupported element', glyphAST, [
            GLYPH_WARNINGS.primaryElementUnsupported,
        ]);
    }

    // 1. Calculate overall spell quality metrics.
    const signs = glyphAST.signs ?? [];
    const quality = calculateSpellQuality(glyphAST);
    const stability = calculateSpellStability(glyphAST, config);
    const neatness = glyphAST.globalMetrics?.neatness ?? quality;

    // 2. Process all drawn signs to get their semantic influences.
    const { primaryManifestation, manifestations, manifestationInfluence } =
        aggregateManifestations(signs);
    const deltas = aggregateSemanticDeltas(signs);

    // 3. Determine the spell's direction based on where the signs were placed.
    const surfaceDirection = signs.length
        ? combineSignDirection(signs)
        : { x: 0, y: 0, strength: 0 };
    const directionCoherence = surfaceDirection.strength ?? 0;

    // 4. Calculate sign power: a measure of total semantic intensity from signs.
    const signPower = signs.reduce((sum, sign) => sum + signInfluence(sign), 0);

    const active = Boolean(glyphAST.ring.complete);
    const prepared = !active;
    const primarySemantic = primary.semantic ?? {};

    // 5. Compute the final visual scale and physical parameters.
    const effectScale = clamp(
        config.renderer.effectSize.baseScale +
            primary.sizeNorm * config.renderer.effectSize.sigilSizeInfluence,
        config.renderer.effectSize.minScale,
        config.renderer.effectSize.maxScale,
    );

    // Focus: how concentrated the spell effect is.
    const focus = clamp(
        SPELL_PARAMETER_TUNING.focusBase +
            (primarySemantic.focus ?? 0) +
            deltas.focus +
            quality * SPELL_PARAMETER_TUNING.focusQuality,
    );

    // Spread: how wide the effect's impact area is.
    const spread = clamp(
        SPELL_PARAMETER_TUNING.spreadBase +
            (primarySemantic.spread ?? 0) +
            deltas.spread +
            (1 - focus) * SPELL_PARAMETER_TUNING.spreadInverseFocus,
    );

    // Force: the "power" or intensity of the spell (e.g. projectile speed).
    const force = clamp(
        SPELL_PARAMETER_TUNING.forceBase +
            (primarySemantic.force ?? 0) +
            signPower * SPELL_PARAMETER_TUNING.forceSignPower +
            deltas.force +
            quality * SPELL_PARAMETER_TUNING.forceQuality,
    );

    // Range: how far the spell effect travels.
    const range = clamp(
        SPELL_PARAMETER_TUNING.rangeBase +
            (primarySemantic.range ?? 0) +
            deltas.range +
            signPower * SPELL_PARAMETER_TUNING.rangeSignPower,
    );

    const duration = calculateSpellDuration({
        primarySemantic,
        deltas,
        quality,
        neatness,
    });

    const direction = directionFromSurfaceVector(surfaceDirection, force);
    const gravity = calculateSpellGravity(manifestationInfluence);

    return {
        type: 'SpellIR',
        active,
        prepared,
        valid: true,
        status: active ? 'Active spell' : 'Prepared spell',
        activatedAt: active ? performance.now() : null,
        element: primary.element,
        elementConfidence: primary.confidence,
        primarySizeNorm: primary.sizeNorm,
        effectScale,
        primaryManifestation,
        manifestations,
        direction,
        directionCoherence,
        gravity,
        force,
        spread,
        focus,
        range,
        duration,
        stability,
        quality,
        neatness,
        warnings: glyphAST.warnings ?? [],
        // The signature is a hash-like string used to detect if the spell has changed significantly.
        signature: `${primary.id}:${manifestationSignature(manifestations)}:${active}:${Math.round(effectScale * 100)}:${Math.round(
            force * 100,
        )}:${Math.round(spread * 100)}:${Math.round(duration * 100)}:${Math.round(direction.xTiltDeg)}:${Math.round(
            direction.yTiltDeg,
        )}:${Math.round(directionCoherence * 100)}:${Math.round(gravity * 100)}:${Math.round(
            quality * 100,
        )}:${Math.round(stability * 100)}`,
    };
}
