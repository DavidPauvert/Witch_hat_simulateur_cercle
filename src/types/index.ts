export interface Circle {
    center: Point;
    radius: number;
}

export interface RingCandidate extends Circle {
    found: boolean;
    complete: boolean;
    completeness: number;
    roundness: number;
    lineSmoothness: number;
    neatness: number;
    overdrawAmount: number;
    strokeIds: string[];
    score?: number;
    coverageRatio?: number;
    gap?: {
        startAngle: number;
        endAngle: number;
        sizeDegrees: number;
    };
    gapArcLength?: number;
    activationEvent?: boolean;
    unsupportedNestedRings?: any[];
    unsupportedMultipleRings?: any[];
}

export interface StrokeClassification {
    strokeId: string;
    classification:
        | 'ring'
        | 'inside'
        | 'outside'
        | 'boundary-crossing'
        | 'boundary-near'
        | 'unbounded';
    insideRatio: number;
    outsideRatio: number;
    boundaryRatio: number;
    usedByParser: boolean;
    canJoinSymbol: boolean;
}

export interface AppConfig {
    appVersion: string;
    input: {
        minPointDistance: number;
        minStrokeLength: number;
        smoothingPasses: number;
    };
    limits: {
        maxStrokes: number;
        maxPointsPerStroke: number;
        maxTotalPoints: number;
        maxRasterArea: number;
    };
    ring: {
        minRadius: number;
    };
    layers: {
        centerMax: number;
        middleMax: number;
        outerMax: number;
        boundaryMax: number;
        boundaryTolerance: number;
    };
    recognition: {
        minConfidence: number;
    };
    compiler: {
        minimumPrimarySigilConfidence: number;
        maxUnknownsBeforeInstability: number;
    };
    renderer: {
        inkColor: string;
        guideColor: string;
        particleBaseCount: number;
        particleCap: number;
        effectSize: {
            baseScale: number;
            sigilSizeInfluence: number;
            minScale: number;
            maxScale: number;
        };
    };
}

export interface Point {
    x: number;
    y: number;
    t?: number;
}

export interface Stroke {
    id: string;
    points: Point[];
    startedAt?: number;
    endedAt?: number;
}

export interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
}

export interface Vector {
    x: number;
    y: number;
}

export interface Ring {
    id: string;
    strokes: Stroke[];
    center: Point;
    radius: number;
    innerRadius: number;
    outerRadius: number;
    confidence: number;
}

export interface GlobalMetrics {
    neatness: number;
    radialSymmetry: number;
    instability: number;
}

export interface GlyphAST {
    type: 'GlyphAST';
    version: string;
    rings: RingCandidate[];
    ring: RingCandidate;
    candidates: any[];
    primarySigil: RecognitionResult | null;
    unsupportedMultipleSigils: RecognitionResult[];
    signs: RecognitionResult[];
    unknowns: any[];
    globalMetrics: GlobalMetrics;
    warnings: string[];
}

export interface SigilCandidate {
    id: string;
    symbol: string;
    strokes: Stroke[];
    confidence: number;
}

export interface SignCandidate {
    id: string;
    symbol: string;
    strokes: Stroke[];
    confidence: number;
    angle: number;
    distance: number;
}

export interface SpellDirection {
    x: number;
    y: number;
    z: number;
    xTiltDeg: number;
    yTiltDeg: number;
    tiltFromZDeg: number;
}

export interface Manifestation {
    strength: number;
    point?: Point;
    radius?: number;
    rigidity?: number;
}

export interface SpellIR {
    type: 'SpellIR';
    active: boolean;
    prepared: boolean;
    valid: boolean;
    status: string;
    activatedAt: number | null;
    element: string | null;
    elementConfidence: number;
    primarySizeNorm: number;
    effectScale: number;
    primaryManifestation: string;
    manifestations: Record<string, Manifestation>;
    direction: SpellDirection;
    directionCoherence: number;
    gravity: number;
    force: number;
    spread: number;
    focus: number;
    range: number;
    duration: number;
    stability: number;
    quality: number;
    neatness: number;
    warnings: string[];
    signature: string;
}

export interface SymbolCandidate {
    candidateId: string;
    strokeIds: string[];
    rawStrokeCount: number;
    cleanedStrokeCount: number;
    bounds: Bounds;
    center: Point;
    radiusNorm: number;
    angleDeg: number;
    layer: string;
    nearBoundary: boolean;
    sizeNorm: number;
    lengthNorm: number;
    orientationDeg: number;
    directedOrientationDeg: number;
    radialFacing: string;
    closedness: number;
    overdrawAmount: number;
    neatness: number;
    strokes: Stroke[];
    [key: string]: any;
}

export interface RecognitionResult extends SymbolCandidate {
    recognized: boolean;
    recognitionStatus:
        | 'valid'
        | 'valid_messy'
        | 'ambiguous'
        | 'contaminated'
        | 'unknown';
    kind: SymbolKind;
    id: string | null;
    displayName: string | null;
    element: string | null;
    semantic: any | null;
    confidence: number;
    shape: {
        strokeCount: number;
        aspectRatio: number;
        elongation: number;
        elongationNorm: number;
        strokeLengthImbalance: number;
        axisDominance: number;
    };
    diagnostics: {
        bestGuess: { kind: SymbolKind; id: string; confidence: number } | null;
        recognitionRotationDeg: number;
        template: {
            inkScore: number;
            softDiceScore: number;
            candidateExplainedRatio: number;
            templateCoveredRatio: number;
            unexplainedInkRatio: number;
            missingInkRatio: number;
            contaminationRisk: number;
            forbiddenCellInkRatio: number;
        };
        structure: {
            score: number;
            aspectScore: number;
            strokeCountScore: number;
            strokeProfileScore: number;
            axisScore: number;
            candidateAspectRatio: number;
            templateAspectRatio: number;
            candidateStrokeCount: number;
            templateStrokeCount: number;
        };
        topMatches: any[];
    };
}

export interface SymbolEntry {
    id: string;
    symbol: string;
    displayName: string;
    kind: SymbolKind;
    element?: string;
    semantic?: any;
    recognitionRotationInvariant?: boolean;
    allowedRotationsDeg?: number[];
    allowedLayers?: string[];
    strokeTemplate?: {
        strokes: any[];
    };
    [key: string]: any;
}

export type SymbolKind = 'sigil' | 'sign' | 'unknown';

export interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: string;
    alpha: number;
    [key: string]: any;
}

export interface Dictionary {
    sigils: Record<string, SymbolEntry>;
    signs: Record<string, SymbolEntry>;
    sampleSpells?: any[];
}

export interface RecognitionPlan {
    candidate: SymbolCandidate;
    baseRotationDeg: number;
    options: {
        rotationInvariant: boolean;
        allowedRotationsDeg?: number[];
    };
}
