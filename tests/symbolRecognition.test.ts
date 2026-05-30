import { describe, it, expect, beforeAll } from 'vitest';
import { CONFIG } from '../src/config';
import {
    boundsForStrokes,
    centerOfBounds,
    degreesToRadians,
    endpointClosedness,
    pathLength,
} from '../src/utils/geometry';
import { recognizeCandidates } from '../src/parser/symbolRecognizer';
import { Dictionary, Stroke, SymbolCandidate, SymbolEntry } from '../src/types';
import { initWasm } from '../src/parser/wasmBridge';

import sigilsJson from '../src/dictionary/sigils.json';
import signsJson from '../src/dictionary/signs.json';

const lineTemplate = {
    sourceAspectRatio: 0.05,
    strokes: [
        [
            { x: 0.5, y: 0 },
            { x: 0.5, y: 1 },
        ],
    ],
};

const dictionary: Dictionary = {
    sigils: {
        'line-sign': {
            id: 'line-sign',
            symbol: 'line-sign',
            displayName: 'Line Sign',
            kind: 'sigil',
            allowedLayers: ['middle'],
            recognitionRotationInvariant: true,
            strokeTemplate: lineTemplate,
        } as any,
    },
    signs: {},
    sampleSpells: [],
};

const realDictionary: Dictionary = {
    sigils: sigilsJson as any,
    signs: signsJson as any,
    sampleSpells: [],
};

function stroke(id: string, points: any[]): Stroke {
    return { id, points };
}

function buildCandidate(strokes: Stroke[]): SymbolCandidate {
    const bounds = boundsForStrokes(strokes);
    const center = centerOfBounds(bounds);
    const length = strokes.reduce(
        (sum, item) => sum + pathLength(item.points),
        0,
    );
    const size = Math.max(bounds.width, bounds.height, 1);
    const compactPerimeter = Math.max(1, (bounds.width + bounds.height) * 2);
    const overdrawAmount = Math.max(
        0,
        Math.min(1, length / compactPerimeter - 0.72),
    );

    return {
        candidateId: 'c1',
        strokeIds: strokes.map((item) => item.id),
        rawStrokeCount: strokes.length,
        cleanedStrokeCount: strokes.length,
        bounds,
        center,
        radiusNorm: 0.5,
        angleDeg: 0,
        layer: 'middle',
        nearBoundary: false,
        sizeNorm: size / 300,
        lengthNorm: length / 900,
        orientationDeg: 90,
        directedOrientationDeg: 90,
        radialFacing: 'unclear',
        closedness: endpointClosedness(strokes, size),
        overdrawAmount,
        neatness: Math.max(
            0,
            Math.min(
                1,
                0.92 -
                    overdrawAmount * 0.28 -
                    Math.max(0, strokes.length - 4) * 0.035,
            ),
        ),
        strokes,
    };
}

function candidateFromTemplate(
    entry: SymbolEntry,
    duplicateOffset: number,
    duplicateStrokeIndex: number | null = null,
) {
    const strokes: Stroke[] = [];
    let nextId = 1;

    for (
        let index = 0;
        index < entry.strokeTemplate!.strokes.length;
        index += 1
    ) {
        const templateStroke = entry.strokeTemplate!.strokes[index];
        const points = templateStroke.map((point: any) => ({
            x: 100 + point.x * 220,
            y: 100 + point.y * 220,
        }));
        strokes.push(stroke(`s${nextId++}`, points));
        if (duplicateStrokeIndex !== null && duplicateStrokeIndex !== index) {
            continue;
        }
        strokes.push(
            stroke(
                `s${nextId++}`,
                points.map((point: any) => ({
                    x: point.x + duplicateOffset,
                    y: point.y + duplicateOffset,
                })),
            ),
        );
    }

    const result = buildCandidate(strokes);
    return {
        ...result,
        layer: 'center',
        radiusNorm: 0.35,
        overdrawAmount: 0.5,
        neatness: 0.65,
    };
}

function cleanCandidateFromTemplate(entry: SymbolEntry, options: any = {}) {
    const scale = options.scale ?? 180;
    const scaleX = options.scaleX ?? scale;
    const scaleY = options.scaleY ?? scale;
    const origin = options.origin ?? 120;
    const rotationDeg = options.rotationDeg ?? 0;
    const rotate = rotationTransform(rotationDeg);
    const center = {
        x: origin + scaleX * 0.5,
        y: origin + scaleY * 0.5,
    };
    const strokes = entry.strokeTemplate!.strokes.map(
        (templateStroke: any, index: number) =>
            stroke(
                `s${index + 1}`,
                templateStroke.map((point: any) =>
                    rotatePoint(
                        {
                            x: origin + point.x * scaleX,
                            y: origin + point.y * scaleY,
                        },
                        center,
                        rotate,
                    ),
                ),
            ),
    );

    const result = buildCandidate(strokes);
    return {
        ...result,
        layer: options.layer ?? 'any',
        radiusNorm: options.radiusNorm ?? 0.5,
        angleDeg: options.angleDeg ?? 270,
        overdrawAmount: 0,
        neatness: 0.92,
    };
}

function rotationTransform(degrees: number) {
    if (!degrees) {
        return null;
    }
    const radians = degreesToRadians(degrees);
    return {
        cos: Math.cos(radians),
        sin: Math.sin(radians),
    };
}

function rotatePoint(point: any, center: any, transform: any) {
    if (!transform) {
        return point;
    }

    const x = point.x - center.x;
    const y = point.y - center.y;
    return {
        x: center.x + x * transform.cos - y * transform.sin,
        y: center.y + x * transform.sin + y * transform.cos,
    };
}

describe('Symbol Recognition', () => {
    beforeAll(async () => {
        await initWasm();
    });
    it('recognizes overdraw as valid messy instead of rejecting the symbol', () => {
        const messyLine = buildCandidate([
            stroke('s1', [
                { x: 99, y: 0 },
                { x: 99, y: 100 },
            ]),
            stroke('s2', [
                { x: 101, y: 0 },
                { x: 101, y: 100 },
            ]),
            stroke('s3', [
                { x: 100, y: 0 },
                { x: 100, y: 100 },
            ]),
        ]);

        const [recognition] = recognizeCandidates(
            [messyLine],
            dictionary,
            CONFIG,
        );

        expect(recognition.recognized).toBe(true);
        expect(recognition.id).toBe('line-sign');
        expect(recognition.recognitionStatus).toBe('valid_messy');
        expect(recognition.diagnostics.template.unexplainedInkRatio).toBe(0);
    });

    it('keeps fire classified when one ray is bolded', () => {
        const fire = Object.values(realDictionary.sigils).find(
            (entry) => entry.id === 'fire',
        )!;
        const fireWithBoldedRay = candidateFromTemplate(fire, 12, 1);

        const [recognition] = recognizeCandidates(
            [fireWithBoldedRay],
            realDictionary,
            CONFIG,
        );

        expect(recognition.recognized).toBe(true);
        expect(recognition.id).toBe('fire');
        expect(recognition.recognitionStatus).toBe('valid_messy');
        expect(recognition.diagnostics.topMatches[0].id).toBe('fire');
        expect(recognition.diagnostics.topMatches.length).toBe(3);
    });

    it('keeps column classified as column instead of a larger sigil', () => {
        const column = Object.values(realDictionary.signs).find(
            (entry) => entry.id === 'column',
        )!;
        expect(column).toBeDefined();

        const drawnColumn = cleanCandidateFromTemplate(column, {
            layer: 'any',
        });

        const [recognition] = recognizeCandidates(
            [drawnColumn],
            realDictionary,
            CONFIG,
        );

        expect(recognition.recognized).toBe(true);
        expect(recognition.kind).toBe('sign');
        expect(recognition.id).toBe('column');
        expect(recognition.diagnostics.topMatches[0].id).toBe('column');
    });

    it('recognizes signs in the ring-relative orientation for their position', () => {
        const column = Object.values(realDictionary.signs).find(
            (entry) => entry.id === 'column',
        )!;
        expect(column).toBeDefined();

        const bottomColumn = cleanCandidateFromTemplate(column, {
            layer: 'outer',
            angleDeg: 270,
        });
        const topColumn = cleanCandidateFromTemplate(column, {
            layer: 'outer',
            angleDeg: 90,
            rotationDeg: 180,
        });
        const rightColumn = cleanCandidateFromTemplate(column, {
            layer: 'outer',
            angleDeg: 0,
            rotationDeg: 270,
        });
        const upperRightColumn = cleanCandidateFromTemplate(column, {
            layer: 'outer',
            angleDeg: 45,
            rotationDeg: 225,
        });
        const leftColumn = cleanCandidateFromTemplate(column, {
            layer: 'outer',
            angleDeg: 180,
            rotationDeg: 90,
        });

        const recognitions = recognizeCandidates(
            [
                bottomColumn,
                topColumn,
                rightColumn,
                upperRightColumn,
                leftColumn,
            ],
            realDictionary,
            CONFIG,
        );

        expect(recognitions.map((recognition) => recognition.id)).toEqual([
            'column',
            'column',
            'column',
            'column',
            'column',
        ]);
        expect(
            recognitions.map(
                (recognition) => recognition.diagnostics.recognitionRotationDeg,
            ),
        ).toEqual([0, 180, 90, 135, 270]);
    });

    it('rejects a sign drawn in the wrong orientation for its ring position', () => {
        const column = Object.values(realDictionary.signs).find(
            (entry) => entry.id === 'column',
        )!;
        expect(column).toBeDefined();

        const topButUnrotatedColumn = cleanCandidateFromTemplate(column, {
            layer: 'outer',
            angleDeg: 90,
        });

        const [recognition] = recognizeCandidates(
            [topButUnrotatedColumn],
            realDictionary,
            CONFIG,
        );

        expect(recognition.id).not.toBe('column');
    });

    it('does not recognize a lone line as the column sign', () => {
        const lineOnly = buildCandidate([
            stroke('s1', [
                { x: 100, y: 100 },
                { x: 100, y: 260 },
            ]),
        ]);
        const outerLine = {
            ...lineOnly,
            layer: 'outer',
            radiusNorm: 0.72,
        };

        const [recognition] = recognizeCandidates(
            [outerLine as any],
            realDictionary,
            CONFIG,
        );

        expect(recognition.recognized).toBe(false);
        expect(recognition.id).not.toBe('column');
        expect(
            recognition.diagnostics.topMatches.every(
                (match: any) =>
                    match.confidence < CONFIG.recognition.minConfidence,
            ),
        ).toBe(true);
        expect(recognition.diagnostics.bestGuess!.confidence).toBeLessThan(
            CONFIG.recognition.minConfidence,
        );
    });

    it('keeps larger and naturally stretched column signs as column', () => {
        const column = Object.values(realDictionary.signs).find(
            (entry) => entry.id === 'column',
        )!;
        expect(column).toBeDefined();

        const largerColumn = cleanCandidateFromTemplate(column, {
            layer: 'outer',
            scale: 280,
        });
        const stretchedColumn = cleanCandidateFromTemplate(column, {
            layer: 'outer',
            scaleX: 180,
            scaleY: 320,
        });

        const [largerRecognition, stretchedRecognition] = recognizeCandidates(
            [largerColumn, stretchedColumn],
            realDictionary,
            CONFIG,
        );

        expect(largerRecognition.recognized).toBe(true);
        expect(largerRecognition.id).toBe('column');
        expect(largerRecognition.sizeNorm).toBeGreaterThan(
            cleanCandidateFromTemplate(column, { layer: 'outer', scale: 180 })
                .sizeNorm,
        );
        expect(stretchedRecognition.recognized).toBe(true);
        expect(stretchedRecognition.id).toBe('column');
        expect(stretchedRecognition.shape.elongation).toBeGreaterThan(
            largerRecognition.shape.elongation,
        );
    });

    it('does not mistake a sideways-stretched column for levitation', () => {
        const column = Object.values(realDictionary.signs).find(
            (entry) => entry.id === 'column',
        )!;
        expect(column).toBeDefined();

        const sidewaysColumn = cleanCandidateFromTemplate(column, {
            layer: 'outer',
            scaleX: 320,
            scaleY: 180,
        });
        const [recognition] = recognizeCandidates(
            [sidewaysColumn],
            realDictionary,
            CONFIG,
        );

        expect(recognition.id).not.toBe('levitation');
        expect(recognition.diagnostics.topMatches[0].id).not.toBe('levitation');
    });

    it('marks unrelated extra ink as contaminated', () => {
        const contaminatedLine = buildCandidate([
            stroke('s1', [
                { x: 99, y: 0 },
                { x: 99, y: 100 },
            ]),
            stroke('s2', [
                { x: 101, y: 0 },
                { x: 101, y: 100 },
            ]),
            stroke('s3', [
                { x: 100, y: 0 },
                { x: 100, y: 100 },
            ]),
            stroke('s4', [
                { x: 140, y: 0 },
                { x: 140, y: 100 },
            ]),
        ]);

        const [recognition] = recognizeCandidates(
            [contaminatedLine],
            dictionary,
            CONFIG,
        );

        expect(recognition.recognized).toBe(false);
        expect(recognition.recognitionStatus).toBe('contaminated');
        expect(recognition.diagnostics.bestGuess!.id).toBe('line-sign');
        expect(
            recognition.diagnostics.template.unexplainedInkRatio,
        ).toBeGreaterThan(0.6);
    });

    it('keeps drawn orientation while using rotation-invariant recognition', () => {
        const horizontalLine = buildCandidate([
            stroke('s1', [
                { x: 0, y: 100 },
                { x: 100, y: 100 },
            ]),
        ]);

        const [recognition] = recognizeCandidates(
            [horizontalLine],
            dictionary,
            CONFIG,
        );

        expect(recognition.recognized).toBe(true);
        expect(recognition.id).toBe('line-sign');
        expect(recognition.diagnostics.recognitionRotationDeg).not.toBe(0);
        expect(recognition.orientationDeg).toBe(90);
    });

    it('keeps a bolded fire sigil classified as fire', () => {
        const fire = Object.values(realDictionary.sigils).find(
            (entry) => entry.id === 'fire',
        )!;
        const boldedFire = candidateFromTemplate(fire, 12);

        const [recognition] = recognizeCandidates(
            [boldedFire],
            realDictionary,
            CONFIG,
        );

        expect(recognition.recognized).toBe(true);
        expect(recognition.id).toBe('fire');
        expect(recognition.recognitionStatus).toBe('valid_messy');
        expect(recognition.diagnostics.topMatches[0].id).toBe('fire');
    });

    it('recognizes fire sigil even when rotated by 90 degrees', () => {
        const fire = Object.values(realDictionary.sigils).find(
            (entry) => entry.id === 'fire',
        )!;
        const rotatedFire = cleanCandidateFromTemplate(fire, {
            rotationDeg: 90,
        });

        const [recognition] = recognizeCandidates(
            [rotatedFire],
            realDictionary,
            CONFIG,
        );

        expect(recognition.recognized).toBe(true);
        expect(recognition.id).toBe('fire');
        // Expecting some form of 90-degree alignment (90, 270, etc. depending on template symmetry)
        expect(Math.round(recognition.diagnostics.recognitionRotationDeg) % 180).toBe(90);
    });

    it('does not mistake a column sign for the earth sigil', () => {
        const column = Object.values(realDictionary.signs).find(
            (entry) => entry.id === 'column',
        )!;
        
        const drawnColumn = cleanCandidateFromTemplate(column, {
            layer: 'middle',
        });

        const [recognition] = recognizeCandidates(
            [drawnColumn],
            realDictionary,
            CONFIG,
        );

        expect(recognition.id).toBe('column');
        const earthMatch = recognition.diagnostics.topMatches.find(m => m.id === 'earth');
        if (earthMatch) {
            // Earth should be heavily penalized because column only covers a small part of it.
            // (Earth has many more strokes than Column)
            expect(earthMatch.confidence).toBeLessThan(0.45);
        }
    });
});
