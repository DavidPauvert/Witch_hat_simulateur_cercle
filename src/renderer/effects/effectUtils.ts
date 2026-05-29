import {
    clamp,
    normalizeVector,
    perpendicularVector,
} from '../../utils/geometry';
import {
    Point,
    Vector,
    RingCandidate,
    AppConfig,
} from '../../types';

import { WebGLParticle } from '../webgl/webglRenderer';

export interface EffectState {
    particles: any[];
    webglParticles: WebGLParticle[];
    [key: string]: any;
}

/**
 * Resets the simulation state by clearing all active particles and custom metadata.
 */
export function resetParticleState(state: EffectState): void {
    for (const key of Object.keys(state)) {
        delete state[key];
    }
    state.particles = [];
    state.webglParticles = [];
}

/** Calculates a 1..0 alpha value for a particle that fades out as it reaches its end of life. */
export function particleAlpha(particle: { age: number; life: number }): number {
    return clamp(1 - particle.age / particle.life);
}

/**
 * Calculates alpha for a particle that fades in quickly and then remains visible
 * until the spell's global emission starts to drop.
 */
export function steadyParticleAlpha(
    particle: { age: number },
    spellIR: any,
    fadeInFrames: number = 10,
): number {
    return Math.min(1, particle.age / fadeInFrames) * effectOpacity(spellIR);
}

/** Converts the spell's duration in seconds to a target frame count for the simulation. */
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

/** Retrieves the visual scale multiplier from the Spell IR. */
export function effectScale(spellIR: any): number {
    return Math.max(1, spellIR?.effectScale ?? 1);
}

/** Retrieves the current preparation/emission level (0..1). */
export function effectOpacity(spellIR: any): number {
    return clamp(spellIR?.emission ?? 1);
}

/** Retrieves the gravity factor (0..1). */
export function effectGravity(spellIR: any): number {
    return clamp(spellIR?.gravity ?? 1);
}

/** Retrieves the focus parameter (0..1), indicating how concentrated the effect is. */
export function effectFocus(spellIR: any): number {
    return clamp(spellIR?.focus ?? 0.5);
}

/** Helper to get the inverse of gravity (for floating effects). */
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

/**
 * Precomputes the shared physics and flow data for a specific frame of the simulation.
 * This is the common "engine" data used by all elemental effects.
 */
export function elementFlow(
    spellIR: any,
    portal: Portal,
    frame: number,
): ElementFlow {
    const direction = portalOutDirection(spellIR);
    return {
        direction,
        // Side vector is used for lateral jitter and spreading.
        side: perpendicularVector(direction),
        scale: effectScale(spellIR),
        focus: effectFocus(spellIR),
        convergence: convergenceFlow(spellIR, portal, frame),
    };
}

/**
 * Utility to narrow down a numeric range or size based on the spell's focus and
 * any active convergence effects.
 */
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

/** Retrieves the numeric intensity of a specific semantic manifestation. */
function manifestationStrength(spellIR: any, id: string): number {
    return clamp(spellIR?.manifestations?.[id]?.strength ?? 0);
}

/** Standard hermite interpolation function for smooth transitions. */
function smoothstep(value: number): number {
    const clamped = clamp(value);
    return clamped * clamped * (3 - 2 * clamped);
}

/** Extracts convergence parameters from the Spell IR. */
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

/**
 * Calculates the current intensity and location of the "convergence" effect for a frame.
 * Convergence pulls particles towards a specific point within the spell circle.
 */
export function convergenceFlow(
    spellIR: any,
    portal: Portal,
    frame: number,
): ConvergenceFlow {
    const convergence = effectConvergence(spellIR);
    const active = convergence.strength > 0.001;
    const lifetime = spellLifetimeFrames(spellIR, 0);
    // Convergence often takes time to "wind up" and reach full strength.
    const shrinkFrames = Math.max(18, lifetime * 0.26);
    const progress = active
        ? convergence.strength * smoothstep(frame / shrinkFrames)
        : 0;

    const direction = portalOutDirection(spellIR);
    const side = perpendicularVector(direction);

    // Map the convergence's normalized point (-1..1) to actual canvas coordinates
    // within the tilted portal ellipse.
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

/**
 * Applies focal pull to a particle's coordinate.
 *
 * Complex: Convergence math.
 * Instead of just pulling points toward a center, this identifies the "centerline"
 * of the spell's path and compresses the particles laterally around that line.
 * This creates a focused beam or column rather than a simple spherical clump.
 */
export function convergePoint(
    point: Point,
    convergence: ConvergenceFlow,
    phase: number = 0,
    radiusScale: number = 1,
): Point {
    if (!convergence?.active || convergence.progress <= 0) {
        return point;
    }

    // High rigidity means the particles are pulled closer to the absolute center.
    const finalSpread = 0.18 + (1 - convergence.rigidity) * 0.28;
    const remainingSpread =
        finalSpread + (1 - convergence.progress) * (1 - finalSpread);

    const relative = {
        x: point.x - convergence.origin.x,
        y: point.y - convergence.origin.y,
    };

    // Calculate distance along the path direction.
    const forward =
        relative.x * convergence.direction.x +
        relative.y * convergence.direction.y;

    const centerline = {
        x: convergence.origin.x + convergence.direction.x * forward,
        y: convergence.origin.y + convergence.direction.y * forward,
    };

    // Project the point onto the compressed ellipse around the centerline.
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

    // Blend the original point with the compressed point based on convergence progress.
    return {
        x: point.x + (compressed.x - point.x) * convergence.progress,
        y: point.y + (compressed.y - point.y) * convergence.progress,
    };
}

/** Returns the number of particles to emit based on spell preparation intensity and global caps. */
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

/**
 * Calculates the geometry of the "spell portal".
 * In the visual design, the spell circle on the table is viewed from an angle.
 * This function defines the screen-space ellipse that particles should emit from.
 */
export function activePortalPlane(
    canvas: { height: number },
    ring: RingCandidate,
): Portal {
    // scaleY is the "tilt" factor (0.44 creates a flat perspective).
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

/** Generates a random point within the elliptical boundary of the spell portal. */
export function randomPortalPoint(
    portal: Portal,
    radiusXScale: number = 1,
    radiusYScale: number = radiusXScale,
): Point {
    const angle = Math.random() * Math.PI * 2;
    // Math.sqrt gives a uniform distribution within a disk.
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

/**
 * Transforms the abstract 3D spell direction into a 2D screen-space launch vector.
 * It accounts for the perspective tilt of the parchment surface.
 */
export function portalOutDirection(spellIR: any): Vector {
    const direction = spellIR?.direction ?? {};
    const paperX = direction.x ?? 0;
    const paperY = direction.y ?? -1;
    const paperZ = direction.z ?? 0;
    const paperYScreenScale = 0.44;

    // We combine the 'surface' direction (X, Y) with the 'outward' depth (Z).
    return normalizeVector({
        x: paperX,
        y: paperY * paperYScreenScale - paperZ,
    });
}

/** Normalized age of the particle (0..1). */
export function particleDepth(particle: { age: number; life: number }): number {
    return clamp(particle.age / Math.max(1, particle.life));
}

/** Removes all particles that have exceeded their maximum lifespan. */
export function pruneParticles(state: EffectState): void {
    state.particles = state.particles.filter(
        (particle) => particle.age < particle.life,
    );
}
