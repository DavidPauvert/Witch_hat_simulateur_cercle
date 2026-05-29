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

/**
 * Identifies the set of stroke IDs that are part of the completed spell.
 * These strokes are often highlighted or made to glow when the spell activates.
 */
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

/**
 * Main 2D renderer for the drawing interface.
 * It manages the canvas layers for paper background, ink strokes, guides, and debug info.
 */
export class CanvasRenderer {
    glyphCanvas: HTMLCanvasElement;
    glyphCtx: CanvasRenderingContext2D;
    effectRenderer: SpellEffectRenderer;
    config: AppConfig;

    /**
     * Initializes the renderer with the necessary DOM canvas elements.
     */
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

        // SpellEffectRenderer handles the heavy lifting of WebGL particle effects.
        this.effectRenderer = new SpellEffectRenderer(
            effectCanvas,
            webglCanvas,
            config,
        );
        this.config = config;
    }

    /**
     * Renders the current state of the drawing.
     * This includes the "parchment" background, any active user strokes,
     * and optional guides or debug overlays.
     */
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

        // 1. Clear and draw the base paper texture.
        drawPaper(this.glyphCtx, width, height);

        // 2. (Optional) Draw radial guides and layer boundaries.
        if (showGuides) {
            drawGuides(
                this.glyphCtx,
                pipeline?.ring,
                width,
                height,
                this.config,
            );
        }

        // 3. Draw the actual ink strokes (both finished and in-progress).
        drawStrokes(this.glyphCtx, strokes, currentStroke, this.config);

        // 4. (Optional) Draw detection circles around identified rings.
        if (showGuides && pipeline?.ring?.found) {
            drawRingDebug(this.glyphCtx, pipeline.ring);
        }

        // 5. (Optional) Draw developer-facing debug info (bounding boxes, IDs, recognition scores).
        if (showDebug) {
            drawCandidateDebug(
                this.glyphCtx,
                pipeline?.candidates || [],
                pipeline?.recognitions || [],
            );
            drawStrokeIdDebug(this.glyphCtx, strokes);
        }
    }

    /**
     * Renders a specialized "activation" animation for the drawing.
     * This is triggered when a spell is completed, causing the relevant strokes to glow.
     */
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
        // The glow lasts for at least 250ms or the full duration of the spell prep.
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

    /**
     * Renders the elemental spell effects (fire, water, etc.).
     * This delegates to the specialized effect renderer.
     */
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
