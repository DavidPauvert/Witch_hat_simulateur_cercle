import {
    clamp,
    perpendicularVector,
    randomBetween,
} from '../../utils/geometry';
import {
    activePortalPlane,
    convergenceFlow,
    effectFocus,
    effectGravity,
    effectOpacity,
    effectScale,
    effectSuspension,
    portalOutDirection,
    pruneParticles,
    scaledParticleCount,
    spellLifetimeFrames,
    EffectState,
    Portal,
    ConvergenceFlow,
} from './effectUtils';
import { SpellIR, RingCandidate, AppConfig, Vector, Point } from '../../types';

const DEPTH_SCALE = 0.58;
const WATER_ALPHA_SCALE = 0.58;

interface WaterFlow {
    suspended: boolean;
    gravity: number;
    suspension: number;
    direction: Vector;
    directionCoherence: number;
    side: Vector;
    convergence: ConvergenceFlow;
    converging: boolean;
    convergenceProgress: number;
    sourceRadiusX: number;
    sourceRadiusY: number;
    horizontalSpeed: number;
    verticalSpeed: number;
    gravityForce: number;
    streamLength: number;
    streamDepth: number;
    lateralPush: number;
    depthPush: number;
    maxHeightHint: number;
    suspendedLife: number;
    suspendedHeight: number;
    suspendedRadius: number;
    suspendedBob: number;
    suspendedWander: number;
    suspendedTension: number;
    suspendedDamping: number;
    minRadius: number;
    radiusScale: number;
}

function waterFlowConfig(
    spellIR: SpellIR,
    ring: RingCandidate,
    portal: Portal,
    frame: number,
): WaterFlow {
    const scale = effectScale(spellIR);
    const focus = effectFocus(spellIR);
    const gravity = effectGravity(spellIR);
    const suspension = effectSuspension(spellIR);
    const suspended = suspension >= 0.55;
    const direction = portalOutDirection(spellIR);
    const side = perpendicularVector(direction);
    const directionIR = spellIR.direction ?? {};
    const directionCoherence = clamp(
        spellIR.directionCoherence ??
            Math.hypot(directionIR.x ?? 0, directionIR.y ?? 0),
    );
    const convergence = convergenceFlow(spellIR, portal, frame);
    const convergenceStrength = convergence.strength;
    const convergenceProgress = convergence.progress;
    const horizontalShare = clamp(
        Math.hypot(directionIR.x ?? 0, directionIR.y ?? 0),
    );
    const verticalShare = clamp(directionIR.z ?? 1);
    const sourceScale =
        Math.min(0.64, 0.22 + scale * 0.06 + spellIR.spread * 0.18) *
        (1 - convergenceStrength * 0.36) *
        (1 - focus * 0.24);
    const pressure = (3.15 + spellIR.force * 5.65) * (0.88 + scale * 0.12);
    const suspendedRadius =
        ring.radius *
        (0.18 + spellIR.spread * 0.18 + scale * 0.035) *
        (1 - convergenceStrength * 0.5) *
        (1 - focus * 0.28);
    const travelFactor = 1 - suspension * 0.78;

    return {
        suspended,
        gravity,
        suspension,
        direction,
        directionCoherence,
        side,
        convergence,
        converging: convergence.active,
        convergenceProgress: convergence.progress,
        sourceRadiusX: portal.radiusX * sourceScale,
        sourceRadiusY: portal.radiusY * sourceScale,
        horizontalSpeed:
            pressure * (0.08 + (0.22 + horizontalShare * 0.86) * travelFactor),
        verticalSpeed:
            pressure * (0.16 + (0.62 + verticalShare * 0.52) * travelFactor),
        gravityForce:
            (0.052 + spellIR.force * 0.038 + (1 - spellIR.stability) * 0.018) *
            gravity *
            (1 - Math.max(convergenceStrength, convergenceProgress)),
        streamLength:
            ring.radius *
            (0.16 +
                scale * 0.04 +
                (0.76 + spellIR.range * 0.34 + spellIR.force * 0.96) *
                    travelFactor) *
            (1 - convergenceStrength * 0.34),
        streamDepth:
            ring.radius *
            (0.035 + spellIR.spread * 0.07 + suspension * 0.08) *
            (0.8 + scale * 0.18) *
            (1 - convergenceStrength * 0.48) *
            (1 - focus * 0.38),
        lateralPush:
            ring.radius *
            (0.004 + spellIR.spread * 0.018) *
            (1.12 - spellIR.stability * 0.38) *
            (1 - convergenceStrength * 0.44) *
            (1 - focus * 0.42),
        depthPush:
            ring.radius *
            (0.004 + spellIR.spread * 0.016) *
            (1.08 - spellIR.stability * 0.34) *
            (1 - convergenceStrength * 0.44) *
            (1 - focus * 0.42),
        maxHeightHint: ring.radius * (0.9 + spellIR.force * 1.2 + scale * 0.12),
        suspendedLife: spellLifetimeFrames(spellIR),
        suspendedHeight:
            ring.radius *
            (0.34 + spellIR.force * 0.16 + spellIR.spread * 0.1 + scale * 0.08),
        suspendedRadius,
        suspendedBob: ring.radius * (0.008 + (1 - spellIR.stability) * 0.012),
        suspendedWander:
            suspendedRadius * (0.05 + (1 - spellIR.stability) * 0.08),
        suspendedTension: 0.012 + spellIR.stability * 0.014,
        suspendedDamping: 0.958 + spellIR.stability * 0.026,
        minRadius: 3.6 * (0.86 + scale * 0.14),
        radiusScale:
            (0.82 + scale * 0.2) *
            (0.92 + spellIR.force * 0.18) *
            (1 - convergenceStrength * 0.14),
    };
}

function randomPortalSource(portal: Portal, flow: WaterFlow): Point {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random());

    return {
        x: portal.center.x + Math.cos(angle) * flow.sourceRadiusX * radius,
        y: portal.center.y + Math.sin(angle) * flow.sourceRadiusY * radius,
    };
}

function spawnSuspendedWaterParticle(
    spellIR: SpellIR,
    ring: RingCandidate,
    portal: Portal,
    flow: WaterFlow,
    frame: number,
) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * flow.suspendedRadius;
    const phase = randomBetween(0, Math.PI * 2);

    // Position in paper space (Z is up)
    const homeX = ring.center.x + Math.cos(angle) * radius;
    const homeY = ring.center.y + Math.sin(angle) * radius;
    const homeZ = flow.suspendedHeight;

    const baseRadius = randomBetween(7.4, 14.6) * flow.radiusScale;

    return {
        x: homeX,
        y: homeY,
        z: homeZ,
        vx: randomBetween(-0.15, 0.15),
        vy: randomBetween(-0.15, 0.15),
        vz: randomBetween(-0.15, 0.15),
        homeX,
        homeY,
        homeZ,
        baseRadius,
        radius: baseRadius,
        phase,
        age: 0,
        life: flow.suspendedLife,
    };
}

function spawnWaterParticle(
    spellIR: SpellIR,
    ring: RingCandidate,
    portal: Portal,
    flow: WaterFlow,
    frame: number,
) {
    if (flow.suspended) {
        return spawnSuspendedWaterParticle(spellIR, ring, portal, flow, frame);
    }

    // Spawn on surface
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * ring.radius * 0.3;
    const sourceX = ring.center.x + Math.cos(angle) * radius;
    const sourceY = ring.center.y + Math.sin(angle) * radius;

    const speed = 2 + spellIR.force * 4;
    const dirX = spellIR.direction?.x ?? 0;
    const dirY = spellIR.direction?.y ?? 0;
    const dirZ = spellIR.direction?.z ?? 1;

    const jitter = (1 - spellIR.stability) * 0.8;

    return {
        x: sourceX,
        y: sourceY,
        z: 0,
        vx: dirX * speed + randomBetween(-jitter, jitter),
        vy: dirY * speed + randomBetween(-jitter, jitter),
        vz: dirZ * speed + randomBetween(-jitter, jitter),
        baseRadius: randomBetween(6.4, 12.8) * flow.radiusScale,
        radius: 0,
        phase: randomBetween(0, Math.PI * 2),
        age: 0,
        life: randomBetween(56, 98) * (0.84 + spellIR.stability * 0.32),
    };
}

function updateSuspendedWaterParticle(
    particle: any,
    flow: WaterFlow,
    dt: number,
) {
    particle.age += dt;

    const targetX =
        particle.homeX +
        Math.cos(particle.phase + particle.age * 0.026) * flow.suspendedWander;
    const targetY =
        particle.homeY +
        Math.sin(particle.phase * 1.4 + particle.age * 0.028) *
            flow.suspendedWander;
    const targetZ =
        particle.homeZ +
        Math.sin(particle.phase * 1.7 + particle.age * 0.032) *
            flow.suspendedBob;

    particle.vx += (targetX - particle.x) * flow.suspendedTension * dt;
    particle.vy += (targetY - particle.y) * flow.suspendedTension * dt;
    particle.vz += (targetZ - particle.z) * flow.suspendedTension * dt;

    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.z += particle.vz * dt;

    particle.vx *= flow.suspendedDamping;
    particle.vy *= flow.suspendedDamping;
    particle.vz *= flow.suspendedDamping;

    const shimmer =
        0.95 + Math.sin(particle.phase + particle.age * 0.12) * 0.05;
    particle.radius = Math.max(flow.minRadius, particle.baseRadius * shimmer);
}

function updateWaterParticle(particle: any, flow: WaterFlow, dt: number) {
    if (flow.suspended) {
        updateSuspendedWaterParticle(particle, flow, dt);
        return;
    }

    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.z += particle.vz * dt;

    // Gravity
    particle.vz -= 0.08 * dt;

    // Drag
    particle.vx *= 0.99;
    particle.vy *= 0.99;
    particle.vz *= 0.99;

    const shimmer =
        0.94 + Math.sin(particle.phase + particle.age * 0.18) * 0.06;
    particle.radius = Math.max(flow.minRadius, particle.baseRadius * shimmer);

    // Collision with paper
    if (particle.z < 0 && particle.vz < 0) {
        particle.z = 0;
        particle.vz *= -0.3; // Bounce
        particle.vx *= 0.8;
        particle.vy *= 0.8;
    }
}

function queueWaterParticle(
    state: EffectState,
    particle: any,
    flow: WaterFlow,
    spellIR: SpellIR,
    opacity: number,
) {
    const alpha =
        (1 - particle.age / particle.life) * opacity * WATER_ALPHA_SCALE;
    if (alpha <= 0) return;

    // Water colors: blue to light blue
    const r = 0.1 + alpha * 0.2;
    const g = 0.4 + alpha * 0.4;
    const b = 0.8 + alpha * 0.2;

    state.webglParticles.push({
        x: particle.x,
        y: particle.y,
        z: particle.z,
        radius: particle.radius,
        r,
        g,
        b,
        a: alpha,
    });
}

export function drawWaterEffect(
    ctx: CanvasRenderingContext2D,
    state: EffectState,
    spellIR: SpellIR,
    ring: RingCandidate,
    dt: number,
    config: AppConfig,
) {
    const scale = effectScale(spellIR);
    const opacity = effectOpacity(spellIR);
    const portal = activePortalPlane(ctx.canvas, ring);
    state.waterFrame = (state.waterFrame ?? 0) + dt;
    const flow = waterFlowConfig(spellIR, ring, portal, state.waterFrame);

    const targetCount = scaledParticleCount(
        config.renderer.particleBaseCount * (0.66 + scale * 0.22),
        spellIR,
        config,
    );

    while (state.particles.length < targetCount) {
        state.particles.push(
            spawnWaterParticle(spellIR, ring, portal, flow, state.waterFrame),
        );
    }

    for (const particle of state.particles) {
        updateWaterParticle(particle, flow, dt);
        queueWaterParticle(state, particle, flow, spellIR, opacity);
    }

    pruneParticles(state);
}
