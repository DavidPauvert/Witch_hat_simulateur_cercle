import { drawFireEffect } from './effects/fireEffect';
import { drawWaterEffect } from './effects/waterEffect';
import { drawWindEffect } from './effects/windEffect';
import { drawEarthEffect } from './effects/earthEffect';
import { drawLightEffect } from './effects/lightEffect';
import { resetParticleState, EffectState } from './effects/effectUtils';
import { clamp } from '../utils/geometry';
import { SpellIR, RingCandidate, AppConfig } from '../types';

const SPELL_END_FADE_MS = 420;
const TARGET_FRAME_MS = 16.67;
const DELTA_FRAME_MIN = 0.4;
const DELTA_FRAME_MAX = 2.5;
const FULL_CIRCLE_RAD = Math.PI * 2;
const RING_GLOW_IDLE_ALPHA = 0.06;
const RING_GLOW_PREPARED_ALPHA = 0.12;
const RING_GLOW_LINE_WIDTH = 6;
const PREPARED_PULSE_PERIOD_MS = 520;
const PREPARED_GLOW_BASE_ALPHA = 0.08;
const PREPARED_GLOW_PULSE_ALPHA = 0.05;
const PREPARED_GLOW_RADIUS_SCALE = 0.7;
const FAILED_FLICKER_PERIOD_MS = 70;
const FAILED_FLICKER_BASE_ALPHA = 0.14;
const FAILED_FLICKER_PULSE_ALPHA = 0.16;
const FAILED_FLICKER_LINE_WIDTH = 7;
const FAILED_FLICKER_DASH = [10, 14];
const FAILED_FLICKER_RADIUS_SCALE = 0.92;
const FAILED_FLICKER_RADIUS_PULSE_SCALE = 0.02;

import { WebGLRenderer } from './webgl/webglRenderer';

const EFFECTS: Record<
    string,
    (
        ctx: CanvasRenderingContext2D,
        state: EffectState,
        spellIR: SpellIR,
        ring: RingCandidate,
        dt: number,
        config: AppConfig,
    ) => void
> = {
    fire: drawFireEffect,
    water: drawWaterEffect,
    wind: drawWindEffect,
    earth: drawEarthEffect,
    light: drawLightEffect,
};

function spellDurationMs(spellIR: SpellIR): number {
    const durationSeconds = Number(spellIR?.duration);
    return (Number.isFinite(durationSeconds) || durationSeconds === Infinity) &&
        durationSeconds > 0
        ? durationSeconds * 1000
        : 0;
}

function spellEmission(spellIR: SpellIR, timestamp: number): number {
    const durationMs = spellDurationMs(spellIR);
    if (
        !spellIR?.active ||
        durationMs <= 0 ||
        typeof spellIR.activatedAt !== 'number'
    ) {
        return 0;
    }

    const elapsed = Math.max(0, timestamp - spellIR.activatedAt!);
    if (elapsed <= durationMs) {
        return 1;
    }

    return clamp(1 - (elapsed - durationMs) / SPELL_END_FADE_MS);
}

export class SpellEffectRenderer {
    canvas2d: HTMLCanvasElement;
    ctx2d: CanvasRenderingContext2D;
    webglCanvas: HTMLCanvasElement;
    webglRenderer: WebGLRenderer;
    config: AppConfig;
    state: EffectState;
    lastSignature: string | null;
    lastTime: number | null;

    constructor(
        canvas2d: HTMLCanvasElement,
        webglCanvas: HTMLCanvasElement,
        config: AppConfig,
    ) {
        this.canvas2d = canvas2d;
        this.ctx2d = canvas2d.getContext('2d')!;
        this.webglCanvas = webglCanvas;
        this.webglRenderer = new WebGLRenderer(webglCanvas);
        this.config = config;
        this.state = { particles: [], webglParticles: [] };
        this.lastSignature = null;
        this.lastTime = null;
    }

    render(
        spellIR: SpellIR | null,
        ring: RingCandidate | undefined,
        timestamp: number,
        options: { showGuides?: boolean } = {},
    ) {
        const width = this.canvas2d.width;
        const height = this.canvas2d.height;
        const ctx = this.ctx2d;
        ctx.clearRect(0, 0, width, height);

        if (!ring?.found || !spellIR) {
            // Clear WebGL too
            this.webglRenderer.render([], width, height);
            return;
        }

        const dt = Math.min(
            DELTA_FRAME_MAX,
            Math.max(
                DELTA_FRAME_MIN,
                this.lastTime === null
                    ? 1
                    : (timestamp - this.lastTime) / TARGET_FRAME_MS,
            ),
        );
        this.lastTime = timestamp;

        if (this.lastSignature !== spellIR.signature) {
            this.lastSignature = spellIR.signature;
            resetParticleState(this.state);
        }

        if (!spellIR.active && options.showGuides) {
            this.drawRingGlow(ring, spellIR.prepared);
        }

        if (!spellIR.valid) {
            if (options.showGuides) {
                this.drawFailedFlicker(ring, timestamp);
            }
            this.webglRenderer.render([], width, height);
            return;
        }

        if (spellIR.prepared) {
            if (options.showGuides) {
                this.drawPreparedGlow(ring, timestamp);
            }
            this.webglRenderer.render([], width, height);
            return;
        }

        const drawEffect = spellIR.element ? EFFECTS[spellIR.element] : null;
        if (!drawEffect) {
            this.webglRenderer.render([], width, height);
            return;
        }

        const emission = spellEmission(spellIR, timestamp);
        if (emission <= 0 && !this.state.particles.length) {
            this.webglRenderer.render([], width, height);
            return;
        }

        // @ts-ignore - emission is transient for rendering
        const renderSpellIR: SpellIR = { ...spellIR, emission };

        // Clear WebGL particles for this frame (they will be populated by drawEffect)
        this.state.webglParticles = [];

        // Legacy 2D effects might still use the context directly for some things
        // but we'll move most to WebGL
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        drawEffect(ctx, this.state, renderSpellIR, ring, dt, this.config);
        ctx.restore();

        // Render WebGL particles
        this.webglRenderer.render(this.state.webglParticles, width, height);
    }

    drawRingGlow(ring: RingCandidate, isPrepared: boolean) {
        const alpha = isPrepared
            ? RING_GLOW_PREPARED_ALPHA
            : RING_GLOW_IDLE_ALPHA;
        this.ctx2d.save();
        this.ctx2d.strokeStyle = `rgba(255, 217, 114, ${alpha})`;
        this.ctx2d.lineWidth = RING_GLOW_LINE_WIDTH;
        this.ctx2d.beginPath();
        this.ctx2d.arc(
            ring.center.x,
            ring.center.y,
            ring.radius,
            0,
            FULL_CIRCLE_RAD,
        );
        this.ctx2d.stroke();
        this.ctx2d.restore();
    }

    drawPreparedGlow(ring: RingCandidate, timestamp: number) {
        const pulse =
            0.5 + Math.sin(timestamp / PREPARED_PULSE_PERIOD_MS) * 0.5;
        this.ctx2d.save();
        this.ctx2d.fillStyle = `rgba(88, 171, 174, ${PREPARED_GLOW_BASE_ALPHA + pulse * PREPARED_GLOW_PULSE_ALPHA})`;
        this.ctx2d.beginPath();
        this.ctx2d.arc(
            ring.center.x,
            ring.center.y,
            ring.radius * PREPARED_GLOW_RADIUS_SCALE,
            0,
            FULL_CIRCLE_RAD,
        );
        this.ctx2d.fill();
        this.ctx2d.restore();
    }

    drawFailedFlicker(ring: RingCandidate, timestamp: number) {
        const pulse = Math.max(
            0,
            Math.sin(timestamp / FAILED_FLICKER_PERIOD_MS),
        );
        this.ctx2d.save();
        this.ctx2d.strokeStyle = `rgba(184, 69, 49, ${FAILED_FLICKER_BASE_ALPHA + pulse * FAILED_FLICKER_PULSE_ALPHA})`;
        this.ctx2d.lineWidth = FAILED_FLICKER_LINE_WIDTH;
        this.ctx2d.setLineDash(FAILED_FLICKER_DASH);
        this.ctx2d.beginPath();
        this.ctx2d.arc(
            ring.center.x,
            ring.center.y,
            ring.radius *
                (FAILED_FLICKER_RADIUS_SCALE +
                    pulse * FAILED_FLICKER_RADIUS_PULSE_SCALE),
            0,
            FULL_CIRCLE_RAD,
        );
        this.ctx2d.stroke();
        this.ctx2d.restore();
    }
}
