import { randomBetween } from '../../utils/geometry';
import {
    effectOpacity,
    effectScale,
    pruneParticles,
    scaledParticleCount,
    EffectState,
} from './effectUtils';
import { SpellIR, RingCandidate, AppConfig } from '../../types';

export function drawEarthEffect(
    ctx: CanvasRenderingContext2D,
    state: EffectState,
    spellIR: SpellIR,
    ring: RingCandidate,
    dt: number,
    config: AppConfig,
) {
    const scale = effectScale(spellIR);
    const opacity = effectOpacity(spellIR);
    state.earthFrame = (state.earthFrame ?? 0) + dt;
    
    const targetCount = scaledParticleCount(
        (68 + spellIR.force * 78) * (0.82 + scale * 0.28),
        spellIR,
        config,
    );
    
    while (state.particles.length < targetCount) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.sqrt(Math.random()) * ring.radius * 0.35;
        const speed = (1.5 + spellIR.force * 2.5);
        const dirX = spellIR.direction?.x ?? 0;
        const dirY = spellIR.direction?.y ?? 0;
        const dirZ = spellIR.direction?.z ?? 1;

        state.particles.push({
            x: ring.center.x + Math.cos(angle) * radius,
            y: ring.center.y + Math.sin(angle) * radius,
            z: 0,
            vx: dirX * speed + randomBetween(-0.4, 0.4),
            vy: dirY * speed + randomBetween(-0.4, 0.4),
            vz: dirZ * speed + randomBetween(-0.4, 0.4),
            radius: randomBetween(4, 11) * (0.85 + scale * 0.2),
            age: 0,
            life: randomBetween(50, 92),
        });
    }

    for (const particle of state.particles) {
        particle.age += dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.z += particle.vz * dt;
        
        // Earth drag/gravity
        particle.vz -= 0.05 * dt;
        particle.vx *= 0.98;
        particle.vy *= 0.98;
        particle.vz *= 0.98;

        if (particle.z < 0) {
            particle.z = 0;
            particle.vx *= 0.5;
            particle.vy *= 0.5;
            particle.vz = 0;
        }

        const alpha = (1.0 - particle.age / particle.life) * opacity;
        if (alpha > 0) {
            state.webglParticles.push({
                x: particle.x,
                y: particle.y,
                z: particle.z,
                radius: particle.radius,
                r: 0.4,
                g: 0.3,
                b: 0.15,
                a: alpha * 0.9
            });
        }
    }

    pruneParticles(state);
}
