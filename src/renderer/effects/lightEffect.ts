import { randomBetween } from '../../utils/geometry';
import {
    effectOpacity,
    effectScale,
    pruneParticles,
    scaledParticleCount,
    EffectState,
} from './effectUtils';
import { SpellIR, RingCandidate, AppConfig } from '../../types';

export function drawLightEffect(
    ctx: CanvasRenderingContext2D,
    state: EffectState,
    spellIR: SpellIR,
    ring: RingCandidate,
    dt: number,
    config: AppConfig,
) {
    const scale = effectScale(spellIR);
    const opacity = effectOpacity(spellIR);
    state.lightFrame = (state.lightFrame ?? 0) + dt;

    const targetCount = scaledParticleCount(
        (34 + spellIR.force * 38) * (0.78 + scale * 0.28),
        spellIR,
        config,
    );

    while (state.particles.length < targetCount) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * ring.radius * 0.45;
        const speed = 5 + spellIR.force * 8;
        const dirX = spellIR.direction?.x ?? 0;
        const dirY = spellIR.direction?.y ?? 0;
        const dirZ = spellIR.direction?.z ?? 1;

        state.particles.push({
            x: ring.center.x + Math.cos(angle) * radius,
            y: ring.center.y + Math.sin(angle) * radius,
            z: 0,
            vx: dirX * speed,
            vy: dirY * speed,
            vz: dirZ * speed,
            radius: randomBetween(6, 12) * (0.8 + scale * 0.2),
            age: 0,
            life: randomBetween(80, 140),
        });
    }

    for (const particle of state.particles) {
        particle.age += dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.z += particle.vz * dt;

        // Light trails simulated by high speed and bloom-like glow
        const alpha = (1 - particle.age / particle.life) * opacity;
        if (alpha > 0) {
            state.webglParticles.push({
                x: particle.x,
                y: particle.y,
                z: particle.z,
                radius: particle.radius,
                r: 1,
                g: 0.98,
                b: 0.8,
                a: alpha * 0.9,
            });
        }
    }

    pruneParticles(state);
}
