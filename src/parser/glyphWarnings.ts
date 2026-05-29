/**
 * A collection of standardized warning keys that the parser can return.
 * These are used by the UI to show specific feedback to the user about why
 * their drawing might not be working as expected (e.g. ring not closed, sigil missing).
 */
export const GLYPH_WARNINGS = Object.freeze({
    noRingDetected: 'no_ring_detected',
    ringIncomplete: 'ring_incomplete',
    unsupportedNestedRing: 'unsupported_nested_ring',
    unsupportedMultipleRings: 'unsupported_multiple_rings',
    unsupportedMultipleSigils: 'unsupported_multiple_sigils',
    missingPrimarySigil: 'missing_primary_sigil',
    primarySigilConfidenceLow: 'primary_sigil_confidence_low',
    primarySigilAmbiguous: 'primary_sigil_ambiguous',
    primaryElementMissing: 'primary_element_missing',
    primaryElementUnsupported: 'primary_element_unsupported',
    centerUnknownContamination: 'center_unknown_contamination',
    symbolNearLayerBoundary: 'symbol_near_layer_boundary',
    symbolContaminated: 'symbol_contaminated',
    symbolAmbiguous: 'symbol_ambiguous',
    symbolMessy: 'symbol_messy',
} as const);

export type GlyphWarning = (typeof GLYPH_WARNINGS)[keyof typeof GLYPH_WARNINGS];
