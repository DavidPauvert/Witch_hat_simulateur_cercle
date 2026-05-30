import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config';
import { compileSpell } from '../src/compiler/spellBuilder';
import { GLYPH_WARNINGS } from '../src/parser/glyphWarnings';
import { GlyphAST } from '../src/types';

function buildGlyphAST({
    ringComplete = false,
    primarySigil = true,
    element = 'fire',
    omitElement = false,
    signs = [],
    unsupportedMultipleRings = [],
    ringNeatness = 0.78,
    primaryNeatness = 0.82,
    globalNeatness = 0.8,
}: any = {}): GlyphAST {
    const elementFields = omitElement
        ? {}
        : {
              element,
          };

    const ring = {
        found: true,
        complete: ringComplete,
        completeness: ringComplete ? 1 : 0.82,
        neatness: ringNeatness,
        center: { x: 400, y: 300 },
        radius: 180,
        roundness: 0.9,
        lineSmoothness: 0.9,
        overdrawAmount: 0.1,
        strokeIds: ['s1'],
    } as any;

    return {
        type: 'GlyphAST',
        version: CONFIG.appVersion,
        ring,
        rings: [ring, ...unsupportedMultipleRings],
        primarySigil: primarySigil
            ? ({
                  id: 'fire',
                  ...elementFields,
                  confidence: 0.91,
                  sizeNorm: 0.2,
                  neatness: primaryNeatness,
                  semantic: {
                      force: 0.12,
                      spread: 0,
                      focus: 0.1,
                      range: 0,
                      lifetimeBias: 0,
                  },
              } as any)
            : null,
        unsupportedMultipleSigils: [],
        signs,
        unknowns: [],
        candidates: [],
        globalMetrics: {
            neatness: globalNeatness,
            radialSymmetry: 0.9,
            instability: 0.12,
        },
        warnings: primarySigil ? [] : [GLYPH_WARNINGS.missingPrimarySigil],
    } as GlyphAST;
}

describe('Spell Builder', () => {
    it('compiles prepared and active spell states', () => {
        const prepared = compileSpell({
            glyphAST: buildGlyphAST(),
            config: CONFIG,
        });
        const active = compileSpell({
            glyphAST: buildGlyphAST({ ringComplete: true }),
            config: CONFIG,
        });

        expect(prepared.valid).toBe(true);
        expect(prepared.active).toBe(false);
        expect(prepared.prepared).toBe(true);
        expect(prepared.activatedAt).toBeNull();
        expect(prepared.primaryManifestation).toBe('aura');
        expect(prepared.manifestations).toEqual({ aura: { strength: 1 } });

        expect(active.valid).toBe(true);
        expect(active.active).toBe(true);
        expect(active.prepared).toBe(false);
        expect(typeof active.activatedAt).toBe('number');
    });

    it('derives spell duration as a longer lifetime for cleaner drawings', () => {
        const cleanSpell = compileSpell({
            glyphAST: buildGlyphAST({
                ringComplete: true,
                ringNeatness: 0.95,
                primaryNeatness: 0.94,
                globalNeatness: 0.95,
            }),
            config: CONFIG,
        });
        const roughSpell = compileSpell({
            glyphAST: buildGlyphAST({
                ringComplete: true,
                ringNeatness: 0.34,
                primaryNeatness: 0.36,
                globalNeatness: 0.33,
            }),
            config: CONFIG,
        });

        expect(cleanSpell.duration).toBeGreaterThan(roughSpell.duration);
        expect(cleanSpell.duration).toBeGreaterThan(4);
        expect(roughSpell.duration).toBeLessThan(3);
    });

    it('compiles effect direction as paper-local 3D tilt', () => {
        const spellIR = compileSpell({
            glyphAST: buildGlyphAST({
                ringComplete: true,
                signs: [
                    {
                        id: 'direction-test',
                        confidence: 0.95,
                        neatness: 0.92,
                        sizeNorm: 0.12,
                        lengthNorm: 0.08,
                        layer: 'outer',
                        radiusNorm: 0.82,
                        angleDeg: 90,
                        orientationDeg: 90,
                        directedOrientationDeg: 90,
                        radialFacing: 'outward',
                        shape: {
                            axisDominance: 0.4,
                            strokeLengthImbalance: 0.12,
                            elongationNorm: 0.16,
                        },
                        semantic: {
                            directionMode: 'orientation',
                        },
                    },
                ],
            }),
            config: CONFIG,
        });

        expect(spellIR.valid).toBe(true);
        expect(typeof spellIR.direction.x).toBe('number');
        expect(typeof spellIR.direction.y).toBe('number');
        expect(typeof spellIR.direction.z).toBe('number');
        expect(spellIR.direction.y).toBeLessThan(0);
        expect(spellIR.direction.z).toBeGreaterThan(0);
        expect(spellIR.direction.tiltFromZDeg).toBeGreaterThan(0);
    });

    it('compiles a left-side column sign as rightward flow', () => {
        const spellIR = compileSpell({
            glyphAST: buildGlyphAST({
                ringComplete: true,
                signs: [
                    {
                        id: 'column',
                        confidence: 0.95,
                        neatness: 0.92,
                        sizeNorm: 0.12,
                        lengthNorm: 0.22,
                        layer: 'outer',
                        radiusNorm: 0.82,
                        angleDeg: 180,
                        orientationDeg: 270,
                        directedOrientationDeg: 270,
                        radialFacing: 'outward',
                        shape: {
                            axisDominance: 0.4,
                            strokeLengthImbalance: 0.16,
                            elongationNorm: 0.22,
                        },
                        semantic: {
                            manifestation: 'column',
                            directionMode: 'inward',
                            force: 0.3,
                            focus: 0.35,
                            spread: -0.24,
                            range: 0.18,
                        },
                    },
                ],
            }),
            config: CONFIG,
        });

        expect(spellIR.valid).toBe(true);
        expect(spellIR.primaryManifestation).toBe('column');
        expect(spellIR.manifestations.column.strength).toBeGreaterThan(0);
        expect(spellIR.direction.x).toBeGreaterThan(0);
        expect(Math.abs(spellIR.direction.y)).toBeLessThan(0.001);
        expect(spellIR.direction.z).toBeGreaterThan(0);
    });

    it('compiles balanced levitation signs as zero-gravity suspension', () => {
        const levitationSigns = [0, 90, 180, 270].map((angleDeg) => ({
            id: 'levitation',
            confidence: 0.95,
            neatness: 0.92,
            sizeNorm: 0.12,
            lengthNorm: 0.18,
            layer: 'outer',
            radiusNorm: 0.82,
            angleDeg,
            orientationDeg: angleDeg,
            directedOrientationDeg: angleDeg,
            radialFacing: 'outward',
            shape: {
                axisDominance: 0.4,
                strokeLengthImbalance: 0.1,
                elongationNorm: 0.18,
            },
            semantic: {
                manifestation: 'levitation',
                directionMode: 'orientation',
                force: 0.12,
                focus: 0.02,
                spread: 0.08,
                range: 0.18,
                lifetimeBias: 0.28,
            },
        }));

        const spellIR = compileSpell({
            glyphAST: buildGlyphAST({
                ringComplete: true,
                element: 'water',
                signs: levitationSigns,
            }),
            config: CONFIG,
        });

        expect(spellIR.valid).toBe(true);
        expect(spellIR.primaryManifestation).toBe('levitation');
        expect(spellIR.manifestations.levitation.strength).toBeGreaterThan(0);
        expect(spellIR.directionCoherence).toBe(0);
        expect(spellIR.gravity).toBe(0);
        expect(spellIR.direction.x).toBe(0);
        expect(spellIR.direction.y).toBe(0);
        expect(spellIR.direction.z).toBe(1);
    });

    it('keeps independent manifestations active in the same spell', () => {
        const signs = [
            {
                id: 'levitation',
                confidence: 0.95,
                neatness: 0.92,
                sizeNorm: 0.12,
                lengthNorm: 0.18,
                layer: 'outer',
                radiusNorm: 0.82,
                angleDeg: 0,
                orientationDeg: 0,
                directedOrientationDeg: 0,
                radialFacing: 'outward',
                shape: {
                    axisDominance: 0.4,
                    strokeLengthImbalance: 0.1,
                    elongationNorm: 0.18,
                },
                semantic: {
                    manifestation: 'levitation',
                    directionMode: 'orientation',
                    force: 0.12,
                    focus: 0.02,
                    spread: 0.08,
                    range: 0.18,
                    lifetimeBias: 0.28,
                },
            },
            {
                id: 'convergence',
                confidence: 0.93,
                neatness: 0.91,
                sizeNorm: 0.1,
                lengthNorm: 0.16,
                layer: 'outer',
                radiusNorm: 0.78,
                angleDeg: 180,
                orientationDeg: 0,
                directedOrientationDeg: 0,
                radialFacing: 'inward',
                shape: {
                    axisDominance: 0.36,
                    strokeLengthImbalance: 0.08,
                    elongationNorm: 0.2,
                },
                semantic: {
                    manifestation: 'convergence',
                    directionMode: 'inward',
                    force: -0.04,
                    focus: 0.26,
                    spread: -0.22,
                    range: -0.08,
                },
            },
        ];

        const spellIR = compileSpell({
            glyphAST: buildGlyphAST({
                ringComplete: true,
                element: 'water',
                signs,
            }),
            config: CONFIG,
        });

        expect(spellIR.valid).toBe(true);
        expect(spellIR.manifestations.levitation.strength).toBeGreaterThan(0);
        expect(spellIR.manifestations.convergence.strength).toBeGreaterThan(0);
        expect(spellIR.gravity).toBeLessThan(1);
        expect(typeof spellIR.manifestations.convergence.point?.x).toBe(
            'number',
        );
        expect(typeof spellIR.manifestations.convergence.point?.y).toBe(
            'number',
        );
        expect(spellIR.manifestations.convergence.radius).toBeGreaterThan(0);
    });

    it('represents a closed invalid ring without a duplicate IR state', () => {
        const spellIR = compileSpell({
            glyphAST: buildGlyphAST({
                ringComplete: true,
                primarySigil: false,
            }),
            config: CONFIG,
        });

        expect(spellIR.valid).toBe(false);
        expect(spellIR.active).toBe(false);
        expect(spellIR.prepared).toBe(false);
        expect(spellIR.warnings).toContain(GLYPH_WARNINGS.missingPrimarySigil);
    });

    it('rejects missing or unsupported primary elements', () => {
        const missingElement = compileSpell({
            glyphAST: buildGlyphAST({ ringComplete: true, omitElement: true }),
            config: CONFIG,
        });
        const unsupportedElement = compileSpell({
            glyphAST: buildGlyphAST({ ringComplete: true, element: 'moon' }),
            config: CONFIG,
        });

        expect(missingElement.valid).toBe(false);
        expect(missingElement.status).toBe('Unsupported element');
        expect(missingElement.warnings).toContain(
            GLYPH_WARNINGS.primaryElementMissing,
        );

        expect(unsupportedElement.valid).toBe(false);
        expect(unsupportedElement.status).toBe('Unsupported element');
        expect(unsupportedElement.warnings).toContain(
            GLYPH_WARNINGS.primaryElementUnsupported,
        );
    });

    it('supports multiple rings', () => {
        const spellIR = compileSpell({
            glyphAST: buildGlyphAST({
                unsupportedMultipleRings: [
                    {
                        center: { x: 620, y: 300 },
                        radius: 120,
                        complete: false,
                        completeness: 0.86,
                        strokeIds: ['s2'],
                    },
                ],
            }),
            config: CONFIG,
        });

        expect(spellIR.valid).toBe(true);
        expect(spellIR.status).toBe('Prepared spell');
    });

    it('rejects unsupported multiple sigils', () => {
        const spellIR = compileSpell({
            glyphAST: {
                ...buildGlyphAST({ ringComplete: true }),
                unsupportedMultipleSigils: [
                    {
                        id: 'water',
                        kind: 'sigil',
                        confidence: 0.87,
                        element: 'water',
                        strokeIds: ['s3'],
                    } as any,
                ],
            },
            config: CONFIG,
        });

        expect(spellIR.valid).toBe(false);
        expect(spellIR.status).toBe('Multiple sigils detected');
        expect(spellIR.warnings).toContain(
            GLYPH_WARNINGS.unsupportedMultipleSigils,
        );
    });
});
