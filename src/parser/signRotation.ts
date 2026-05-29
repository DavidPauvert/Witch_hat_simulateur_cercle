import {
    boundsForStrokes,
    centerOfBounds,
    degreesToRadians,
    normalizeAngleDeg,
} from '../utils/geometry';
import {
    Point,
    SymbolKind,
    SymbolEntry,
    RecognitionPlan,
    SymbolCandidate,
} from '../types';

const CANONICAL_SIGN_ANGLE_DEG = 270;
const SIGN_ROTATION_TOLERANCE_DEG = 15;

/**
 * Calculates the rotation required to align a drawn sign with its canonical orientation in the dictionary.
 * Signs are typically drawn relative to the ring's radial direction, but templates are stored at a 270-degree angle (top).
 *
 * @param candidateAngleDeg - The angle from the ring center to the symbol's center.
 * @returns The base rotation in degrees.
 */
function signCandidateToTemplateRotationDeg(
    candidateAngleDeg?: number,
): number {
    return normalizeAngleDeg(
        (candidateAngleDeg ?? CANONICAL_SIGN_ANGLE_DEG) -
            CANONICAL_SIGN_ANGLE_DEG,
    );
}

/** Returns a small set of rotation offsets to check during recognition to account for slight hand-drawn tilting. */
function signRecognitionRotations(): number[] {
    return [
        normalizeAngleDeg(-SIGN_ROTATION_TOLERANCE_DEG),
        0,
        SIGN_ROTATION_TOLERANCE_DEG,
    ];
}

interface RotationTransform {
    cos: number;
    sin: number;
}

/** Pre-calculates sine and cosine for a given angle to speed up coordinate rotations. */
function rotationTransform(degrees: number): RotationTransform | null {
    if (!degrees) {
        return null;
    }

    const radians = degreesToRadians(degrees);
    return {
        cos: Math.cos(radians),
        sin: Math.sin(radians),
    };
}

/**
 * Rotates a 2D point around a given center point.
 *
 * @param point - The point to rotate.
 * @param center - The pivot point.
 * @param transform - The pre-calculated sin/cos pair.
 * @returns The new rotated coordinates.
 */
function rotatePoint(
    point: Point,
    center: Point,
    transform: RotationTransform | null,
): Point {
    if (!transform) {
        return point;
    }

    const x = point.x - center.x;
    const y = point.y - center.y;
    return {
        x: center.x + x * transform.cos - y * transform.sin,
        y: center.y + x * transform.sin + y * transform.cos,
    };
}

/**
 * Rotates an entire symbol candidate (all its strokes and points) around its center.
 * This is used to "un-rotate" signs drawn at an angle before matching them against templates.
 *
 * @param candidate - The symbol to rotate.
 * @param rotationDeg - The angle in degrees.
 * @returns A new candidate object with rotated geometry and updated bounds.
 */
function rotateCandidate(
    candidate: SymbolCandidate,
    rotationDeg: number,
): SymbolCandidate {
    const transform = rotationTransform(rotationDeg);
    if (!transform) {
        return candidate;
    }

    const center = candidate.center ?? centerOfBounds(candidate.bounds);
    const strokes = candidate.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) =>
            rotatePoint(point, center, transform),
        ),
    }));
    const bounds = boundsForStrokes(strokes);

    return {
        ...candidate,
        bounds,
        center: centerOfBounds(bounds),
        // Update orientation metrics to reflect the new geometry.
        orientationDeg: normalizeAngleDeg(
            (candidate.orientationDeg ?? 0) + rotationDeg,
        ),
        directedOrientationDeg: normalizeAngleDeg(
            (candidate.directedOrientationDeg ?? 0) + rotationDeg,
        ),
        strokes,
    };
}

/**
 * Prepares a strategy for matching a symbol against the dictionary.
 *
 * Complex: Different symbol kinds have different rotation logic.
 * - Sigils (kind !== 'sign'): Usually rotation-invariant or have specific allowed angles.
 * - Signs (kind === 'sign'): Always drawn radially. We rotate the candidate to "upright"
 *   orientation so it can be compared to standard templates.
 */
export function recognitionPlanForSymbol(
    kind: SymbolKind,
    entry: SymbolEntry,
    candidate: SymbolCandidate,
): RecognitionPlan {
    if (kind !== 'sign') {
        return {
            candidate,
            baseRotationDeg: 0,
            options: {
                rotationInvariant: entry.recognitionRotationInvariant ?? true,
                allowedRotationsDeg: entry.allowedRotationsDeg,
            },
        };
    }

    // For signs, we calculate the angle needed to rotate them back to the canonical template direction.
    const baseRotationDeg = signCandidateToTemplateRotationDeg(
        candidate.angleDeg,
    );
    return {
        // Perform the actual geometric rotation on the candidate.
        candidate: rotateCandidate(candidate, baseRotationDeg),
        baseRotationDeg,
        options: {
            rotationInvariant: false,
            // Only check a small window of fuzzy rotations around the "upright" position.
            allowedRotationsDeg: signRecognitionRotations(),
        },
    };
}
