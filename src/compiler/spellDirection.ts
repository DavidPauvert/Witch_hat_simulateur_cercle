import {
    clamp,
    degreesToRadians,
    radiansToDegrees,
    roundedDegrees,
} from '../utils/geometry';
import { SpellDirection, Vector } from '../types';

const MAX_COMPONENT_TILT_DEG = 82;
const FORCE_TILT_MAX_DEG = 76;
const MIN_SURFACE_DIRECTION_MAGNITUDE = 0.001;

/**
 * Converts individual X and Y tilt angles into a normalized 3D unit vector.
 * This is used to determine the launch direction of spell effects.
 *
 * @param xTiltDeg - Tilt angle along the X-axis in degrees.
 * @param yTiltDeg - Tilt angle along the Y-axis in degrees.
 * @returns A SpellDirection object containing normalized coordinates and tilt metrics.
 */
export function directionFromTiltAngles(
    xTiltDeg: number = 0,
    yTiltDeg: number = 0,
): SpellDirection {
    const xTilt = clamp(
        xTiltDeg,
        -MAX_COMPONENT_TILT_DEG,
        MAX_COMPONENT_TILT_DEG,
    );
    const yTilt = clamp(
        yTiltDeg,
        -MAX_COMPONENT_TILT_DEG,
        MAX_COMPONENT_TILT_DEG,
    );

    // Complex: Trigonometric projection.
    // We treat xTilt and yTilt as slopes on a plane relative to the Z-axis (normal).
    // tan(tilt) gives the ratio of horizontal displacement to vertical depth.
    const xSlope = Math.tan(degreesToRadians(xTilt));
    const ySlope = Math.tan(degreesToRadians(yTilt));

    // Normalize the [xSlope, ySlope, 1] vector to get a unit vector.
    const magnitude = Math.hypot(xSlope, ySlope, 1);
    const x = xSlope / magnitude;
    const y = ySlope / magnitude;
    const z = 1 / magnitude;

    return {
        x,
        y,
        z,
        xTiltDeg: roundedDegrees(xTilt),
        yTiltDeg: roundedDegrees(yTilt),
        tiltFromZDeg: roundedDegrees(radiansToDegrees(Math.acos(z))),
    };
}

/**
 * Calculates a 3D launch direction based on a 2D surface vector and spell force.
 *
 * Complex: Radial Projectile Mapping.
 * The 2D surface vector (derived from signs) determines the "bearing" or horizontal path.
 * The 'force' parameter determines how much the spell tilts away from the normal (Z) axis.
 * High force results in a "flatter" trajectory along the surface.
 */
export function directionFromSurfaceVector(
    surfaceDirection: Vector,
    force: number,
): SpellDirection {
    const surfaceMagnitude = Math.hypot(
        surfaceDirection?.x ?? 0,
        surfaceDirection?.y ?? 0,
    );

    // If the signs cancel each other out, the direction defaults to straight up (Z-axis).
    if (surfaceMagnitude < MIN_SURFACE_DIRECTION_MAGNITUDE) {
        return directionFromTiltAngles(0, 0);
    }

    // Map force to a tilt angle (0 to 76 degrees).
    const tiltFromZDeg = clamp(force ?? 0) * FORCE_TILT_MAX_DEG;
    const tiltRadians = degreesToRadians(tiltFromZDeg);

    // Project the 2D bearing onto the 3D unit sphere using spherical coordinates.
    const surfaceScale = Math.sin(tiltRadians) / surfaceMagnitude;
    const x = surfaceDirection.x * surfaceScale;
    const y = surfaceDirection.y * surfaceScale;
    const z = Math.cos(tiltRadians);

    return {
        x,
        y,
        z,
        xTiltDeg: roundedDegrees(radiansToDegrees(Math.atan2(x, z))),
        yTiltDeg: roundedDegrees(radiansToDegrees(Math.atan2(y, z))),
        tiltFromZDeg: roundedDegrees(tiltFromZDeg),
    };
}
