import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { CanvasRenderer } from '../renderer/canvasRenderer';
import { DrawingCapture } from '../input/drawingCapture';
import { CONFIG } from '../config';

const CanvasPanel: React.FC = () => {
    const glyphCanvasRef = useRef<HTMLCanvasElement>(null);
    const effectCanvasRef = useRef<HTMLCanvasElement>(null);
    const webglCanvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [renderer, setRenderer] = useState<CanvasRenderer | null>(null);

    const {
        strokes,
        currentStroke,
        pipeline,
        spellIR,
        uiState,
        addStroke,
        setCurrentStroke,
        scaleStrokes,
    } = useStore();

    useEffect(() => {
        if (glyphCanvasRef.current && effectCanvasRef.current && webglCanvasRef.current) {
            setRenderer(
                new CanvasRenderer({
                    glyphCanvas: glyphCanvasRef.current,
                    effectCanvas: effectCanvasRef.current,
                    webglCanvas: webglCanvasRef.current,
                    config: CONFIG,
                }),
            );
        }
    }, []);

    useEffect(() => {
        if (!glyphCanvasRef.current || !renderer) return;

        const capture = new DrawingCapture(glyphCanvasRef.current, CONFIG, {
            onPreview: (stroke) => setCurrentStroke(stroke),
            onCommit: (points) => addStroke(points),
        });

        capture.enable();

        // Lock input if ring is complete or invalid structure
        const ringClosed = Boolean(pipeline?.ring?.complete);
        const hasUnsupportedMultipleRings = Boolean(
            pipeline?.ring?.unsupportedMultipleRings?.length,
        );
        const hasUnsupportedMultipleSigils = Boolean(
            pipeline?.glyphAST?.unsupportedMultipleSigils?.length,
        );
        capture.setLocked(
            ringClosed ||
                hasUnsupportedMultipleRings ||
                hasUnsupportedMultipleSigils,
        );

        return () => capture.disable();
    }, [renderer, addStroke, setCurrentStroke, pipeline]);

    useEffect(() => {
        let animationFrameId: number;

        const loop = (timestamp: number) => {
            if (renderer) {
                renderer.renderGlyph({
                    strokes,
                    currentStroke,
                    pipeline,
                    showGuides: uiState.showGuides,
                    showDebug: uiState.showDiagnostics,
                });

                if (spellIR?.active) {
                    renderer.renderActivatedGlyph({
                        activatedAt: spellIR.activatedAt!,
                        duration: spellIR.duration,
                        strokes,
                        pipeline,
                        timestamp,
                    });
                }

                renderer.renderEffect({
                    spellIR,
                    ring: pipeline?.ring,
                    timestamp,
                    showGuides: uiState.showGuides,
                });
            }
            animationFrameId = requestAnimationFrame(loop);
        };

        animationFrameId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(animationFrameId);
    }, [renderer, strokes, currentStroke, pipeline, spellIR, uiState]);

    // Handle resizing
    useEffect(() => {
        if (
            !containerRef.current ||
            !glyphCanvasRef.current ||
            !effectCanvasRef.current
        )
            return;

        const handleResize = () => {
            const container = containerRef.current;
            if (!container) return;

            const width = container.clientWidth;
            const height = container.clientHeight;

            const oldWidth = glyphCanvasRef.current!.width;
            const oldHeight = glyphCanvasRef.current!.height;

            if (width === oldWidth && height === oldHeight) return;

            glyphCanvasRef.current!.width = width;
            glyphCanvasRef.current!.height = height;
            effectCanvasRef.current!.width = width;
            effectCanvasRef.current!.height = height;
            webglCanvasRef.current!.width = width;
            webglCanvasRef.current!.height = height;

            if (oldWidth > 0 && oldHeight > 0) {
                scaleStrokes(width / oldWidth, height / oldHeight);
            }
        };

        const observer = new ResizeObserver(handleResize);
        observer.observe(containerRef.current);
        handleResize();

        return () => observer.disconnect();
    }, [scaleStrokes]);

    const ringClosed = Boolean(pipeline?.ring?.complete);
    const hasUnsupportedStructure = Boolean(
        pipeline?.ring?.unsupportedMultipleRings?.length ||
        pipeline?.glyphAST?.unsupportedMultipleSigils?.length,
    );
    const isLocked = ringClosed || hasUnsupportedStructure;

    return (
        <div
            ref={containerRef}
            className={`canvas-shell relative w-full h-full max-h-none flex-1 bg-paper touch-none overflow-hidden perspective-portal transition-colors duration-980 ease-in-out ${spellIR?.active ? 'bg-[#3a332b]' : ''}`}
        >
            <canvas
                id="effectCanvas"
                ref={effectCanvasRef}
                width="1200"
                height="800"
                className="absolute inset-0 w-full h-full z-[10] pointer-events-none"
            />
            <canvas
                id="webglCanvas"
                ref={webglCanvasRef}
                width="1200"
                height="800"
                className="absolute inset-0 w-full h-full z-[11] pointer-events-none"
            />

            <div
                className={`w-full h-full relative transition-all duration-980 transform-origin-portal ${spellIR?.active ? 'rotate-x-portal shadow-[inset_0_1px_0_rgba(255,251,233,0.52),0_28px_38px_rgba(36,27,22,0.3)] filter drop-shadow-[0_30px_24px_rgba(36,27,22,0.34)]' : ''}`}
                style={{
                    transitionTimingFunction:
                        'cubic-bezier(0.16, 0.78, 0.18, 1)',
                }}
            >
                <canvas
                    id="glyphCanvas"
                    ref={glyphCanvasRef}
                    width="1200"
                    height="800"
                    className={`absolute inset-0 w-full h-full z-[1] transform-origin-portal transition-all duration-980 ${isLocked ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
                />
            </div>

            <p
                className={`canvas-hint absolute top-[22px] left-[24px] z-[2] w-[min(390px,calc(100%-48px))] m-0 text-[rgba(36,27,22,0.62)] text-[15px] leading-[1.35] text-left pointer-events-none transition-opacity duration-140 ease-in-out ${strokes.length > 0 ? 'opacity-0' : 'opacity-100'}`}
            >
                Draw an open spell ring. Place sigils in the center and signs
                around them. When everything is ready, seal the circle to awaken
                the spell.
            </p>
        </div>
    );
};

export default CanvasPanel;
