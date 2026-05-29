import {
    boundsForStrokes,
    centerOfBounds,
    degreesToRadians,
    normalizeAngleDeg,
} from '../utils/geometry';
import {
    Point,
    Stroke,
    SymbolKind,
    SymbolEntry,
    RecognitionPlan,
    SymbolCandidate,
} from '../types';

const CANONICAL_SIGN_ANGLE_DEG = 270;
const SIGN_ROTATION_TOLERANCE_DEG = 15;

function signCandidateToTemplateRotationDeg(
    candidateAngleDeg?: number,
): number {
    return normalizeAngleDeg(
        (candidateAngleDeg ?? CANONICAL_SIGN_ANGLE_DEG) -
            CANONICAL_SIGN_ANGLE_DEG,
    );
}

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
        orientationDeg: normalizeAngleDeg(
            (candidate.orientationDeg ?? 0) + rotationDeg,
        ),
        directedOrientationDeg: normalizeAngleDeg(
            (candidate.directedOrientationDeg ?? 0) + rotationDeg,
        ),
        strokes,
    };
}

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

    const baseRotationDeg = signCandidateToTemplateRotationDeg(
        candidate.angleDeg,
    );
    return {
        candidate: rotateCandidate(candidate, baseRotationDeg),
        baseRotationDeg,
        options: {
            rotationInvariant: false,
            allowedRotationsDeg: signRecognitionRotations(),
        },
    };
}
