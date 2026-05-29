import {
    drawCandidateDebug,
    drawRingDebug,
    drawStrokeIdDebug,
    drawStrokes,
    drawGlowingStrokes,
} from './glyphOverlayRenderer';
import { drawGuides, drawPaper } from './paperRenderer';
import { SpellEffectRenderer } from './spellEffectRenderer';
import { Stroke, AppConfig, RingCandidate, SpellIR } from '../types';
import { ClassificationResult } from '../parser/drawingClassifier';

function getActivatedStrokeIds(
    pipeline: ClassificationResult | null,
): Set<string> {
    if (!pipeline) {
        return new Set();
    }

    const { ring, primarySigil, signs } = pipeline.glyphAST;
    return new Set([
        ...(ring?.strokeIds ?? []),
        ...(primarySigil?.strokeIds ?? []),
        ...(signs ?? []).flatMap((sign) => sign.strokeIds ?? []),
    ]);
}

export class CanvasRenderer {
    glyphCanvas: HTMLCanvasElement;
    glyphCtx: CanvasRenderingContext2D;
    effectRenderer: SpellEffectRenderer;
    config: AppConfig;

    constructor({
        glyphCanvas,
        effectCanvas,
        webglCanvas,
        config,
    }: {
        glyphCanvas: HTMLCanvasElement;
        effectCanvas: HTMLCanvasElement;
        webglCanvas: HTMLCanvasElement;
        config: AppConfig;
    }) {
        this.glyphCanvas = glyphCanvas;
        this.glyphCtx = glyphCanvas.getContext('2d')!;
        this.effectRenderer = new SpellEffectRenderer(
            effectCanvas,
            webglCanvas,
            config,
        );
        this.config = config;
    }

    renderGlyph({
        strokes,
        currentStroke,
        pipeline,
        showGuides,
        showDebug,
    }: {
        strokes: Stroke[];
        currentStroke: Stroke | null;
        pipeline: ClassificationResult | null;
        showGuides: boolean;
        showDebug: boolean;
    }) {
        const width = this.glyphCanvas.width;
        const height = this.glyphCanvas.height;
        drawPaper(this.glyphCtx, width, height);

        if (showGuides) {
            drawGuides(
                this.glyphCtx,
                pipeline?.ring,
                width,
                height,
                this.config,
            );
        }

        drawStrokes(this.glyphCtx, strokes, currentStroke, this.config);

        if (showGuides && pipeline?.ring?.found) {
            drawRingDebug(this.glyphCtx, pipeline.ring);
        }

        if (showDebug) {
            drawCandidateDebug(
                this.glyphCtx,
                pipeline?.candidates || [],
                pipeline?.recognitions || [],
            );
            drawStrokeIdDebug(this.glyphCtx, strokes);
        }
    }

    renderActivatedGlyph({
        activatedAt,
        duration,
        strokes,
        pipeline,
        timestamp,
    }: {
        activatedAt: number;
        duration: number;
        strokes: Stroke[];
        pipeline: ClassificationResult | null;
        timestamp: number;
    }) {
        const activatedStrokeIds = getActivatedStrokeIds(pipeline);
        const glowDuration = Math.max(250, duration * 1000);
        drawGlowingStrokes(
            this.glyphCtx,
            activatedAt,
            activatedStrokeIds,
            strokes,
            glowDuration,
            timestamp,
        );
    }

    renderEffect({
        spellIR,
        ring,
        timestamp,
        showGuides,
    }: {
        spellIR: SpellIR | null;
        ring: RingCandidate | undefined;
        timestamp: number;
        showGuides: boolean;
    }) {
        this.effectRenderer.render(spellIR, ring, timestamp, { showGuides });
    }
}
