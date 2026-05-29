import { randomBetween, clamp } from '../../utils/geometry';
import {
    activePortalPlane,
    convergenceFlow,
    convergePoint,
    effectFocus,
    effectGravity,
    effectOpacity,
    effectScale,
    effectSuspension,
    particleAlpha,
    particleDepth,
    portalOutDirection,
    pruneParticles,
    randomPortalPoint,
    scaledParticleCount,
    spellLifetimeFrames,
    steadyParticleAlpha,
    EffectState,
    Portal,
    ConvergenceFlow,
} from './effectUtils';
import { SpellIR, RingCandidate, AppConfig, Vector } from '../../types';

interface FireFlow {
    suspended: boolean;
    gravity: number;
    suspension: number;
    direction: Vector;
    side: Vector;
    convergence: ConvergenceFlow;
    suspendedLife: number;
    suspendedHeight: number;
    suspendedRadiusX: number;
    suspendedRadiusY: number;
    suspendedBob: number;
    suspendedWander: number;
    suspendedTension: number;
    suspendedDamping: number;
}

function fireFlowConfig(
    spellIR: SpellIR,
    ring: RingCandidate,
    portal: Portal,
    frame: number,
): FireFlow {
    const direction = portalOutDirection(spellIR);
    const side = { x: -direction.y, y: direction.x };
    const scale = effectScale(spellIR);
    const focus = effectFocus(spellIR);
    const gravity = effectGravity(spellIR);
    const suspension = effectSuspension(spellIR);
    const suspended = suspension >= 0.55;
    const convergence = convergenceFlow(spellIR, portal, frame);

    return {
        suspended,
        gravity,
        suspension,
        direction,
        side,
        convergence,
        suspendedLife: spellLifetimeFrames(spellIR),
        suspendedHeight:
            ring.radius * (0.34 + spellIR.force * 0.18 + scale * 0.08),
        suspendedRadiusX:
            ring.radius *
            (0.16 + spellIR.spread * 0.16 + scale * 0.04) *
            (1 - convergence.strength * 0.48) *
            (1 - focus * 0.28),
        suspendedRadiusY:
            ring.radius *
            (0.11 + spellIR.spread * 0.12 + scale * 0.028) *
            (1 - convergence.strength * 0.48) *
            (1 - focus * 0.28),
        suspendedBob: ring.radius * (0.008 + (1 - spellIR.stability) * 0.014),
        suspendedWander:
            ring.radius *
            (0.012 + spellIR.spread * 0.03) *
            (1 - convergence.strength * 0.46) *
            (1 - focus * 0.44),
        suspendedTension: 0.014 + spellIR.stability * 0.018,
        suspendedDamping: 0.954 + spellIR.stability * 0.03,
    };
}

function spawnSuspendedFireParticle(
    spellIR: SpellIR,
    ring: RingCandidate,
    portal: Portal,
    flow: FireFlow,
    frame: number,
) {
    const scale = effectScale(spellIR);
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random());
    const phase = randomBetween(0, Math.PI * 2);
    
    // Position in paper space (Z is up)
    const homeX = ring.center.x + Math.cos(angle) * flow.suspendedRadiusX * radius;
    const homeY = ring.center.y + Math.sin(angle) * flow.suspendedRadiusY * radius;
    const homeZ = flow.suspendedHeight;
    
    const startJitter = ring.radius * 0.025;
    const flicker = Math.sin(frame * 0.11 + phase) * (1 - spellIR.stability) * 0.42;

    return {
        x: homeX + randomBetween(-startJitter, startJitter),
        y: homeY + randomBetween(-startJitter, startJitter),
        z: homeZ + randomBetween(-startJitter, startJitter),
        vx: randomBetween(-0.28, 0.28) + flicker * 0.32,
        vy: randomBetween(-0.22, 0.22),
        vz: randomBetween(-0.15, 0.15),
        homeX,
        homeY,
        homeZ,
        radius:
            randomBetween(8, 18) *
            (0.86 + spellIR.force * 0.22) *
            (0.82 + scale * 0.28),
        phase,
        age: 0,
        life: flow.suspendedLife,
    };
}

function spawnFlowFireParticle(
    spellIR: SpellIR,
    ring: RingCandidate,
    portal: Portal,
    flow: FireFlow,
) {
    const scale = effectScale(spellIR);
    const focus = effectFocus(spellIR);
    const convergence = flow.convergence;
    
    // Spawn on the paper surface
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random());
    const sourceX = ring.center.x + Math.cos(angle) * ring.radius * 0.4 * radius;
    const sourceY = ring.center.y + Math.sin(angle) * ring.radius * 0.4 * radius;
    
    const speed =
        randomBetween(1.8, 4.2) *
        (0.5 + spellIR.force) *
        (0.92 + scale * 0.12);
    
    const dirX = spellIR.direction?.x ?? 0;
    const dirY = spellIR.direction?.y ?? 0;
    const dirZ = spellIR.direction?.z ?? 1;

    const jitter = (1 - spellIR.stability) * 0.5;

    return {
        x: sourceX,
        y: sourceY,
        z: 0,
        vx: dirX * speed + randomBetween(-jitter, jitter),
        vy: dirY * speed + randomBetween(-jitter, jitter),
        vz: dirZ * speed + randomBetween(-jitter, jitter),
        radius:
            randomBetween(5, 14) *
            (0.75 + spellIR.force) *
            (0.82 + scale * 0.28),
        phase: randomBetween(0, Math.PI * 2),
        age: 0,
        life: randomBetween(32, 62) * (0.88 + spellIR.stability * 0.34),
    };
}

function spawnFireParticle(
    spellIR: SpellIR,
    ring: RingCandidate,
    portal: Portal,
    flow: FireFlow,
    frame: number,
) {
    return flow.suspended
        ? spawnSuspendedFireParticle(spellIR, ring, portal, flow, frame)
        : spawnFlowFireParticle(spellIR, ring, portal, flow);
}

function updateSuspendedFireParticle(
    particle: any,
    flow: FireFlow,
    dt: number,
) {
    particle.age += dt;

    const targetX =
        particle.homeX +
        Math.sin(particle.phase + particle.age * 0.038) * flow.suspendedWander;
    const targetY =
        particle.homeY +
        Math.sin(particle.phase * 1.7 + particle.age * 0.048) *
            flow.suspendedWander;
    const targetZ = 
        particle.homeZ + 
        Math.sin(particle.phase * 2.1 + particle.age * 0.052) * flow.suspendedBob;

    particle.vx += (targetX - particle.x) * flow.suspendedTension * dt;
    particle.vy += (targetY - particle.y) * flow.suspendedTension * dt;
    particle.vz += (targetZ - particle.z) * flow.suspendedTension * dt;
    
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.z += particle.vz * dt;
    
    particle.vx *= flow.suspendedDamping;
    particle.vy *= flow.suspendedDamping;
    particle.vz *= flow.suspendedDamping;
}

function updateFlowFireParticle(particle: any, flow: FireFlow, dt: number) {
    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.z += particle.vz * dt;
    
    // Simple gravity/drag
    particle.vx *= 0.98;
    particle.vy *= 0.98;
    particle.vz *= 0.98;
}

function queueFireParticle(
    state: EffectState,
    particle: any,
    flow: FireFlow,
    spellIR: SpellIR,
    opacity: number,
) {
    const alpha = (1.0 - particle.age / particle.life) * opacity;
    if (alpha <= 0) return;

    // Fire colors: yellow core to red outer
    // r, g, b, a
    const r = 1.0;
    const g = 0.4 + alpha * 0.5;
    const b = 0.1 + alpha * 0.2;

    state.webglParticles.push({
        x: particle.x,
        y: particle.y,
        z: particle.z,
        radius: particle.radius * (0.8 + alpha * 0.4),
        r, g, b, a: alpha * 0.8
    });
}

export function drawFireEffect(
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
    state.fireFrame = (state.fireFrame ?? 0) + dt;
    const flow = fireFlowConfig(spellIR, ring, portal, state.fireFrame);
    
    const targetCount = scaledParticleCount(
        config.renderer.particleBaseCount * (0.78 + scale * 0.32),
        spellIR,
        config,
    );
    
    while (state.particles.length < targetCount) {
        state.particles.push(
            spawnFireParticle(spellIR, ring, portal, flow, state.fireFrame),
        );
    }

    for (const particle of state.particles) {
        if (flow.suspended) {
            updateSuspendedFireParticle(particle, flow, dt);
        } else {
            updateFlowFireParticle(particle, flow, dt);
        }
        queueFireParticle(state, particle, flow, spellIR, opacity);
    }

    pruneParticles(state);
}
