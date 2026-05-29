import {
    clamp,
    normalizeVector,
    perpendicularVector,
} from '../../utils/geometry';
import {
    Point,
    Vector,
    SpellIR,
    RingCandidate,
    AppConfig,
    Particle,
} from '../../types';

import { WebGLParticle } from '../webgl/webglRenderer';

export interface EffectState {
    particles: any[];
    webglParticles: WebGLParticle[];
    [key: string]: any;
}

export function resetParticleState(state: EffectState): void {
    for (const key of Object.keys(state)) {
        delete state[key];
    }
    state.particles = [];
    state.webglParticles = [];
}

export function particleAlpha(particle: { age: number; life: number }): number {
    return clamp(1 - particle.age / particle.life);
}

export function steadyParticleAlpha(
    particle: { age: number },
    spellIR: any,
    fadeInFrames: number = 10,
): number {
    return Math.min(1, particle.age / fadeInFrames) * effectOpacity(spellIR);
}

export function spellLifetimeFrames(
    spellIR: any,
    extraFrames: number = 36,
): number {
    const durationSeconds = Number(spellIR?.duration);
    if (durationSeconds === Infinity) return 600;
    return Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds * 60 + extraFrames
        : 600;
}

export function effectScale(spellIR: any): number {
    return Math.max(1, spellIR?.effectScale ?? 1);
}

export function effectOpacity(spellIR: any): number {
    return clamp(spellIR?.emission ?? 1);
}

export function effectGravity(spellIR: any): number {
    return clamp(spellIR?.gravity ?? 1);
}

export function effectFocus(spellIR: any): number {
    return clamp(spellIR?.focus ?? 0.5);
}

export function effectSuspension(spellIR: any): number {
    return 1 - effectGravity(spellIR);
}

export interface Portal {
    center: Point;
    radiusX: number;
    radiusY: number;
    scaleY: number;
}

export interface ConvergenceFlow {
    active: boolean;
    strength: number;
    progress: number;
    rigidity: number;
    origin: Point;
    direction: Vector;
    side: Vector;
    radiusX: number;
    radiusY: number;
    life: number;
}

export interface ElementFlow {
    direction: Vector;
    side: Vector;
    scale: number;
    focus: number;
    convergence: ConvergenceFlow;
}

// Shared element flow: SpellIR direction, focus, scale, and convergence are the base for every element effect.
export function elementFlow(
    spellIR: any,
    portal: Portal,
    frame: number,
): ElementFlow {
    const direction = portalOutDirection(spellIR);
    return {
        direction,
        side: perpendicularVector(direction),
        scale: effectScale(spellIR),
        focus: effectFocus(spellIR),
        convergence: convergenceFlow(spellIR, portal, frame),
    };
}

// Focus narrows the source area. Convergence narrows it further so compressed effects do not keep spawning wide.
export function narrowedByFocusAndConvergence(
    value: number,
    focus: number,
    convergenceStrength: number,
    focusWeight: number,
    convergenceWeight: number,
): number {
    return (
        value *
        (1 - convergenceStrength * convergenceWeight) *
        (1 - focus * focusWeight)
    );
}

function manifestationStrength(spellIR: any, id: string): number {
    return clamp(spellIR?.manifestations?.[id]?.strength ?? 0);
}

function smoothstep(value: number): number {
    const clamped = clamp(value);
    return clamped * clamped * (3 - 2 * clamped);
}

function effectConvergence(spellIR: any) {
    const convergence = spellIR?.manifestations?.convergence ?? {};
    const strength = manifestationStrength(spellIR, 'convergence');
    return {
        strength,
        point: {
            x: clamp(convergence.point?.x ?? 0, -1, 1),
            y: clamp(convergence.point?.y ?? 0, -1, 1),
        },
        radius: clamp(convergence.radius ?? 0.14, 0.03, 0.6),
        rigidity: clamp(convergence.rigidity ?? strength),
    };
}

export function convergenceFlow(
    spellIR: any,
    portal: Portal,
    frame: number,
): ConvergenceFlow {
    const convergence = effectConvergence(spellIR);
    const active = convergence.strength > 0.001;
    const lifetime = spellLifetimeFrames(spellIR, 0);
    const shrinkFrames = Math.max(18, lifetime * 0.26);
    const progress = active
        ? convergence.strength * smoothstep(frame / shrinkFrames)
        : 0;
    const direction = portalOutDirection(spellIR);
    const side = perpendicularVector(direction);
    const origin = {
        x:
            portal.center.x +
            side.x * convergence.point.x * portal.radiusX +
            direction.x * convergence.point.y * portal.radiusY,
        y:
            portal.center.y +
            side.y * convergence.point.x * portal.radiusX +
            direction.y * convergence.point.y * portal.radiusY,
    };

    return {
        active,
        strength: convergence.strength,
        progress,
        rigidity: convergence.rigidity,
        origin,
        direction,
        side,
        radiusX: portal.radiusX * convergence.radius,
        radiusY: portal.radiusY * convergence.radius,
        life: lifetime + 36,
    };
}

// Convergence keeps the current forward motion and compresses only the sideways spread around that path.
export function convergePoint(
    point: Point,
    convergence: ConvergenceFlow,
    phase: number = 0,
    radiusScale: number = 1,
): Point {
    if (!convergence?.active || convergence.progress <= 0) {
        return point;
    }

    const finalSpread = 0.18 + (1 - convergence.rigidity) * 0.28;
    const remainingSpread =
        finalSpread + (1 - convergence.progress) * (1 - finalSpread);
    const relative = {
        x: point.x - convergence.origin.x,
        y: point.y - convergence.origin.y,
    };
    const forward =
        relative.x * convergence.direction.x +
        relative.y * convergence.direction.y;
    const centerline = {
        x: convergence.origin.x + convergence.direction.x * forward,
        y: convergence.origin.y + convergence.direction.y * forward,
    };
    const compressed = {
        x:
            centerline.x +
            convergence.side.x *
                Math.cos(phase) *
                convergence.radiusX *
                remainingSpread *
                radiusScale,
        y:
            centerline.y +
            convergence.side.y *
                Math.sin(phase * 1.37) *
                convergence.radiusY *
                remainingSpread *
                radiusScale,
    };

    return {
        x: point.x + (compressed.x - point.x) * convergence.progress,
        y: point.y + (compressed.y - point.y) * convergence.progress,
    };
}

export function scaledParticleCount(
    baseCount: number,
    spellIR: any,
    config: AppConfig,
): number {
    return Math.min(
        config.renderer.particleCap,
        Math.round(baseCount * effectOpacity(spellIR)),
    );
}

// The activated paper is drawn as a tilted ellipse, so effects emit from that same screen-space portal.
export function activePortalPlane(
    canvas: { height: number },
    ring: RingCandidate,
): Portal {
    const scaleY = 0.44;
    const originY = canvas.height * 0.64;
    const liftY = canvas.height * 0.16;
    return {
        center: {
            x: ring.center.x,
            y: originY + (ring.center.y - originY) * scaleY + liftY,
        },
        radiusX: ring.radius,
        radiusY: ring.radius * scaleY,
        scaleY,
    };
}

export function randomPortalPoint(
    portal: Portal,
    radiusXScale: number = 1,
    radiusYScale: number = radiusXScale,
): Point {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random());
    return {
        x:
            portal.center.x +
            Math.cos(angle) * portal.radiusX * radiusXScale * radius,
        y:
            portal.center.y +
            Math.sin(angle) * portal.radiusY * radiusYScale * radius,
    };
}

// Convert paper-local x/y/z direction into screen space. Positive z points out of the paper toward the top.
export function portalOutDirection(spellIR: any): Vector {
    const direction = spellIR?.direction ?? {};
    const paperX = direction.x ?? 0;
    const paperY = direction.y ?? -1;
    const paperZ = direction.z ?? 0;
    const paperYScreenScale = 0.44;

    return normalizeVector({
        x: paperX,
        y: paperY * paperYScreenScale - paperZ,
    });
}

export function particleDepth(particle: { age: number; life: number }): number {
    return clamp(particle.age / Math.max(1, particle.life));
}

export function pruneParticles(state: EffectState): void {
    state.particles = state.particles.filter(
        (particle) => particle.age < particle.life,
    );
}
