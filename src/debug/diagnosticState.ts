import { formatNumber } from '../utils/geometry';
import { Stroke, SpellIR } from '../types';
import { ClassificationResult } from '../parser/drawingClassifier';

function roundForDisplay(value: any): any {
    if (Array.isArray(value)) {
        return value.map(roundForDisplay);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                roundForDisplay(item),
            ]),
        );
    }
    return formatNumber(value);
}

export interface DiagnosticState {
    rawStrokes: {
        strokeCount: number;
        pointCount: number;
        drawOrder: string[];
    };
    ring: any;
    classifications: any[];
    candidates: any[];
    recognitions: any[];
    glyphAST: any;
    spellIR: SpellIR | null;
}

export function buildDiagnosticState({
    rawStrokes,
    pipeline,
    spellIR,
}: {
    rawStrokes: Stroke[];
    pipeline: ClassificationResult | null;
    spellIR: SpellIR | null;
}): DiagnosticState {
    return roundForDisplay({
        rawStrokes: {
            strokeCount: rawStrokes.length,
            pointCount: rawStrokes.reduce(
                (sum, stroke) => sum + stroke.points.length,
                0,
            ),
            drawOrder: rawStrokes.map((stroke) => stroke.id),
        },
        ring: pipeline?.glyphAST?.ring ?? null,
        classifications: pipeline?.classifications ?? [],
        candidates: (pipeline?.candidates ?? []).map((candidate) => {
            const { strokes, ...publicCandidate } = candidate;
            return publicCandidate;
        }),
        recognitions: pipeline?.recognitions ?? [],
        glyphAST: pipeline?.glyphAST ?? null,
        spellIR,
    });
}
