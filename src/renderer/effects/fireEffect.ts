import { randomBetween } from '../../utils/geometry';
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

/**
 * Configures the physics parameters for the fire effect based on the spell's properties.
 * It handles two modes: 'suspended' (floating in place) and 'flowing' (shooting out).
 *
 * @returns A configuration object for the fire particle simulation.
 */
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

    // If the spell has low gravity, fire particles enter 'suspended' mode.
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
        // Height above the parchment where suspended fire hovers.
        suspendedHeight:
            ring.radius * (0.34 + spellIR.force * 0.18 + scale * 0.08),
        // Hover area dimensions.
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
        // Intensity of the "bobbing" animation.
        suspendedBob: ring.radius * (0.008 + (1 - spellIR.stability) * 0.014),
        // Horizontal wandering intensity.
        suspendedWander:
            ring.radius *
            (0.012 + spellIR.spread * 0.03) *
            (1 - convergence.strength * 0.46) *
            (1 - focus * 0.44),
        // Physics constants for the hover behavior.
        suspendedTension: 0.014 + spellIR.stability * 0.018,
        suspendedDamping: 0.954 + spellIR.stability * 0.03,
    };
}

/**
 * Spawns a fire particle that hovers in a designated "home" position.
 * This is used for stable or prepared fire spells.
 */
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
    const homeX =
        ring.center.x + Math.cos(angle) * flow.suspendedRadiusX * radius;
    const homeY =
        ring.center.y + Math.sin(angle) * flow.suspendedRadiusY * radius;
    const homeZ = flow.suspendedHeight;

    const startJitter = ring.radius * 0.025;
    // Flicker adds high-frequency noise to the motion.
    const flicker =
        Math.sin(frame * 0.11 + phase) * (1 - spellIR.stability) * 0.42;

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

/**
 * Spawns a fire particle that shoots outward in the spell's direction.
 * This is used for active, high-force spells.
 */
function spawnFlowFireParticle(
    spellIR: SpellIR,
    ring: RingCandidate,
    portal: Portal,
    flow: FireFlow,
) {
    const scale = effectScale(spellIR);
    const focus = effectFocus(spellIR);
    const convergence = flow.convergence;

    // Spawn randomly on the paper surface within the circle.
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random());
    const sourceX =
        ring.center.x + Math.cos(angle) * ring.radius * 0.4 * radius;
    const sourceY =
        ring.center.y + Math.sin(angle) * ring.radius * 0.4 * radius;

    // Initial velocity determined by spell force.
    const speed =
        randomBetween(1.8, 4.2) * (0.5 + spellIR.force) * (0.92 + scale * 0.12);

    const dirX = spellIR.direction?.x ?? 0;
    const dirY = spellIR.direction?.y ?? 0;
    const dirZ = spellIR.direction?.z ?? 1;

    // Stability determines how much random "spray" there is.
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

/** Selects the appropriate spawn logic for a fire particle. */
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

/**
 * Updates fire particles in suspended (hovering) mode.
 *
 * Complex: Spring-based hovering.
 * Particles are attached to a "home" coordinate by virtual springs (tension).
 * They wander and bob around that home point using sine waves, creating
 * a smooth, magical floating effect.
 */
function updateSuspendedFireParticle(
    particle: any,
    flow: FireFlow,
    dt: number,
) {
    particle.age += dt;

    // Calculate the target position with rhythmic wandering and bobbing.
    const targetX =
        particle.homeX +
        Math.sin(particle.phase + particle.age * 0.038) * flow.suspendedWander;
    const targetY =
        particle.homeY +
        Math.sin(particle.phase * 1.7 + particle.age * 0.048) *
            flow.suspendedWander;
    const targetZ =
        particle.homeZ +
        Math.sin(particle.phase * 2.1 + particle.age * 0.052) *
            flow.suspendedBob;

    // Apply spring force towards the target position.
    particle.vx += (targetX - particle.x) * flow.suspendedTension * dt;
    particle.vy += (targetY - particle.y) * flow.suspendedTension * dt;
    particle.vz += (targetZ - particle.z) * flow.suspendedTension * dt;

    // Integrate velocity into position.
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.z += particle.vz * dt;

    // Apply damping (friction) to prevent the springs from oscillating infinitely.
    particle.vx *= flow.suspendedDamping;
    particle.vy *= flow.suspendedDamping;
    particle.vz *= flow.suspendedDamping;
}

/** Updates fire particles in flow (shooting) mode using simple ballistic motion. */
function updateFlowFireParticle(particle: any, flow: FireFlow, dt: number) {
    particle.age += dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.z += particle.vz * dt;

    // Slow down over time (air resistance).
    particle.vx *= 0.98;
    particle.vy *= 0.98;
    particle.vz *= 0.98;
}

/**
 * Converts internal fire simulation state into WebGL particle data.
 * Fire uses a color gradient from bright yellow (new/hot) to dark red (old/cool).
 */
function queueFireParticle(
    state: EffectState,
    particle: any,
    flow: FireFlow,
    spellIR: SpellIR,
    opacity: number,
) {
    const alpha = (1 - particle.age / particle.life) * opacity;
    if (alpha <= 0) return;

    // Fire colors: yellow core to red outer.
    const r = 1;
    const g = 0.4 + alpha * 0.5; // Greener when hot (high alpha).
    const b = 0.1 + alpha * 0.2;

    state.webglParticles.push({
        x: particle.x,
        y: particle.y,
        z: particle.z,
        radius: particle.radius * (0.8 + alpha * 0.4),
        r,
        g,
        b,
        a: alpha * 0.8,
    });
}

/**
 * Main entry point for the Fire elemental effect.
 * It manages the lifecycle and animation of fire particles within the spell.
 */
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

    // Determine how many particles to emit based on spell prepare intensity.
    const targetCount = scaledParticleCount(
        config.renderer.particleBaseCount * (0.78 + scale * 0.32),
        spellIR,
        config,
    );

    // Spawn new particles until the target count is reached.
    while (state.particles.length < targetCount) {
        state.particles.push(
            spawnFireParticle(spellIR, ring, portal, flow, state.fireFrame),
        );
    }

    // Update and render each active particle.
    for (const particle of state.particles) {
        if (flow.suspended) {
            updateSuspendedFireParticle(particle, flow, dt);
        } else {
            updateFlowFireParticle(particle, flow, dt);
        }
        queueFireParticle(state, particle, flow, spellIR, opacity);
    }

    // Remove particles that have died.
    pruneParticles(state);
}
