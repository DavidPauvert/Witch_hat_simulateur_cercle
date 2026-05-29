import { degreesToRadians } from '../utils/geometry';
import { RingCandidate, AppConfig } from '../types';

/**
 * Renders a parchment-like background on the canvas.
 * It uses a subtle linear gradient to simulate aged paper or vellum.
 *
 * @param ctx - The 2D canvas context.
 * @param width - The canvas width.
 * @param height - The canvas height.
 */
export function drawPaper(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
): void {
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#f7dfac');
    gradient.addColorStop(0.45, '#f4df9f');
    gradient.addColorStop(1, '#fae8a5');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
}

/**
 * Draws radial and circular guidelines to help the user place symbols correctly.
 * If a ring has already been detected, the guides align with it; otherwise,
 * they center on the canvas.
 *
 * @param ctx - The 2D canvas context.
 * @param ring - The detected ring candidate, if any.
 * @param width - Canvas width.
 * @param height - Canvas height.
 * @param config - App configuration for layer boundaries.
 */
export function drawGuides(
    ctx: CanvasRenderingContext2D,
    ring: RingCandidate | undefined,
    width: number,
    height: number,
    config: AppConfig,
): void {
    const center = ring?.found ? ring.center : { x: width / 2, y: height / 2 };
    const radius = ring?.found ? ring.radius : Math.min(width, height) * 0.36;

    // Circular guides for each layer (Center, Middle, Outer).
    const guideRadii = [
        radius * config.layers.centerMax,
        radius * config.layers.middleMax,
        radius * config.layers.outerMax,
        radius,
    ];

    ctx.save();
    ctx.strokeStyle = config.renderer.guideColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 10]);
    for (const guideRadius of guideRadii) {
        ctx.beginPath();
        ctx.arc(center.x, center.y, guideRadius, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Angular guides every 45 degrees.
    ctx.setLineDash([5, 16]);
    for (let angle = 0; angle < 360; angle += 45) {
        const radians = degreesToRadians(angle);
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(
            center.x + Math.cos(radians) * radius,
            center.y - Math.sin(radians) * radius,
        );
        ctx.stroke();
    }
    ctx.restore();
}
