import { describe, it, expect, beforeAll } from 'vitest';
import { CONFIG } from '../src/config';
import { classifyDrawing } from '../src/parser/drawingClassifier';
import { detectRing } from '../src/parser/ringDetector';
import { degreesToRadians } from '../src/utils/geometry';
import { Stroke, Dictionary } from '../src/types';
import { initWasm } from '../src/parser/wasmBridge';

function arcStroke(
    id: string,
    centerX: number,
    centerY: number,
    radius: number,
    startDeg: number,
    endDeg: number,
    steps: number,
): Stroke {
    const points = [];

    for (let index = 0; index <= steps; index += 1) {
        const deg = startDeg + (endDeg - startDeg) * (index / steps);
        const radians = degreesToRadians(deg);
        points.push({
            x: centerX + Math.cos(radians) * radius,
            y: centerY + Math.sin(radians) * radius,
        });
    }

    return { id, points };
}

function openRingStroke(id: string = 's1') {
    return arcStroke(id, 400, 300, 180, 25, 335, 160);
}

function closingStroke(id: string = 's2') {
    return arcStroke(id, 400, 300, 180, 335, 385, 32);
}

function outsideStroke(id: string = 's2') {
    return {
        id,
        points: [
            { x: 900, y: 130 },
            { x: 940, y: 150 },
            { x: 930, y: 190 },
        ],
    };
}

function openRingAt(
    id: string,
    centerX: number,
    centerY: number,
    radius: number = 120,
) {
    return arcStroke(id, centerX, centerY, radius, 25, 335, 128);
}

function closingStrokeAt(
    id: string,
    centerX: number,
    centerY: number,
    radius: number = 120,
) {
    return arcStroke(id, centerX, centerY, radius, 335, 385, 28);
}

describe('Ring Detector', () => {
    beforeAll(async () => {
        await initWasm();
    });
    it('detects a sealed ring without outside strokes', () => {
        const openRing = openRingStroke();
        const closing = closingStroke();
        const prepared = detectRing([openRing] as any, null, CONFIG)[0];
        const sealed = detectRing([openRing, closing] as any, prepared, CONFIG)[0];

        expect(prepared.found).toBe(true);
        expect(prepared.complete).toBe(false);
        expect(sealed.complete).toBe(true);
        expect(sealed.activationEvent).toBe(true);
        expect(sealed.strokeIds).toEqual(['s1', 's2']);
        expect(sealed).not.toHaveProperty('topology');
        expect(sealed).not.toHaveProperty('coverageBinCount');
    });

    it('keeps a short closing stroke in sealed ring ids', () => {
        const openRing = arcStroke('s1', 400, 300, 180, 5, 355, 180);
        const closing = arcStroke('s2', 400, 300, 180, 355, 365, 8);
        const prepared = detectRing([openRing] as any, null, CONFIG)[0];
        const sealed = detectRing([openRing, closing] as any, prepared, CONFIG)[0];

        expect(prepared.found).toBe(true);
        expect(prepared.complete).toBe(false);
        expect(sealed.complete).toBe(true);
        expect(sealed.activationEvent).toBe(true);
        expect(sealed.strokeIds).toEqual(['s1', 's2']);
    });

    it('reports multiple open rings as unsupported', () => {
        const firstRing = openRingAt('s1', 260, 300);
        const secondRing = openRingAt('s2', 620, 300);
        const rings = detectRing(
            [firstRing, secondRing] as any,
            null,
            CONFIG,
        );
        const detected = rings[0];

        expect(detected.found).toBe(true);
        expect(detected.complete).toBe(false);
        expect(detected.activationEvent).toBe(false);
        // Previously we checked unsupportedMultipleRings, now we check the array length.
        expect(rings.length).toBe(2);
    });

    it('does not activate when closing one of multiple rings', () => {
        const firstRing = openRingAt('s1', 260, 300);
        const secondRing = openRingAt('s2', 620, 300);
        const firstClosingStroke = closingStrokeAt('s3', 260, 300);
        const prepared = detectRing(
            [firstRing, secondRing] as any,
            null,
            CONFIG,
        )[0];
        const rings = detectRing(
            [firstRing, secondRing, firstClosingStroke] as any,
            prepared,
            CONFIG,
        );
        const sealed = rings[0];

        expect(sealed.found).toBe(true);
        expect(sealed.activationEvent).toBe(false);
        expect(rings.length).toBe(2);
    });

    it('ignores outside strokes when sealing a prepared ring', () => {
        const openRing = openRingStroke('s1');
        const outside = outsideStroke('s2');
        const closing = closingStroke('s3');
        const prepared = detectRing([openRing] as any, null, CONFIG)[0];
        const preparedWithOutsideMark = detectRing(
            [openRing, outside] as any,
            prepared,
            CONFIG,
        )[0];
        const sealed = detectRing(
            [openRing, outside, closing] as any,
            preparedWithOutsideMark,
            CONFIG,
        )[0];

        expect(preparedWithOutsideMark.found).toBe(true);
        expect(preparedWithOutsideMark.complete).toBe(false);
        expect(sealed.complete).toBe(true);
        expect(sealed.activationEvent).toBe(true);
        expect(sealed.strokeIds).toEqual(['s1', 's3']);
    });

    it('ignores outside strokes when closed ring is evaluated without prior state', () => {
        const openRing = openRingStroke('s1');
        const outside = outsideStroke('s2');
        const closing = closingStroke('s3');
        const sealed = detectRing(
            [openRing, outside, closing] as any,
            null,
            CONFIG,
        )[0];

        expect(sealed.complete).toBe(true);
        expect(sealed.activationEvent).toBe(false);
        expect(sealed.strokeIds).toEqual(['s1', 's3']);
    });

    it('classifies symbols inside a detected ring without crashing', () => {
        const openRing = openRingStroke('s1');
        const closing = closingStroke('s2');
        const columnStem = {
            id: 's3',
            points: [
                { x: 400, y: 285 },
                { x: 400, y: 365 },
            ],
        };
        const columnBase = {
            id: 's4',
            points: [
                { x: 360, y: 365 },
                { x: 440, y: 365 },
            ],
        };
        const dictionary: Dictionary = {
            sigils: {},
            signs: {
                column: {
                    id: 'column',
                    symbol: 'column',
                    displayName: 'Column',
                    kind: 'sign',
                    allowedLayers: ['center', 'middle', 'outer'],
                    semantic: {
                        manifestation: 'column',
                        directionMode: 'inward',
                    },
                    strokeTemplate: {
                        strokes: [
                            [
                                { x: 0.5, y: 0.12 },
                                { x: 0.5, y: 0.8 },
                            ],
                            [
                                { x: 0.18, y: 0.8 },
                                { x: 0.82, y: 0.8 },
                            ],
                        ],
                    },
                },
            },
            sampleSpells: [],
        };

        const result = classifyDrawing({
            strokes: [openRing, closing, columnStem, columnBase] as any,
            previousRing: null,
            dictionary,
            config: CONFIG,
        });

        expect(result.ring.complete).toBe(true);
        expect(result.candidates.length).toBeGreaterThanOrEqual(1);
        expect(result.recognitions[0].id).toBe('column');
        expect(result.recognitions[0].diagnostics).toBeDefined();
        expect(result.glyphAST.signs[0].id).toBe('column');
        expect(result.glyphAST.signs[0]).not.toHaveProperty('diagnostics');
    });
});
