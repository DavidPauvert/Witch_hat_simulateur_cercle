import { Point, Stroke, Bounds, Vector } from '../types';

const FULL_CIRCLE_DEG = 360;
const HALF_CIRCLE_DEG = 180;

/** Ensures a value stays within the [min, max] range. */
export function clamp(value: number, min: number = 0, max: number = 1): number {
    return Math.max(min, Math.min(max, value));
}

/** Ensures a value stays within [-limit, limit]. */
export function clampSigned(value: number, limit: number): number {
    return clamp(value, -limit, limit);
}

/** Rounds a degree value to three decimal places. */
export function roundedDegrees(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/** Generates a random float between min and max. */
export function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/** Returns a vector rotated 90 degrees clockwise. */
export function perpendicularVector(vector: Vector): Vector {
    return {
        x: -vector.y,
        y: vector.x,
    };
}

/** Scales a vector so its total magnitude is exactly 1.0. */
export function normalizeVector(vector: Vector): Vector {
    const magnitude = Math.hypot(vector.x, vector.y);
    if (magnitude < 0.001) {
        return { x: 0, y: -1 };
    }
    return {
        x: vector.x / magnitude,
        y: vector.y / magnitude,
    };
}

/** Wraps an angle to be within the [0, 360) degree range. */
export function normalizeAngleDeg(value: number): number {
    return ((value % FULL_CIRCLE_DEG) + FULL_CIRCLE_DEG) % FULL_CIRCLE_DEG;
}

/** Converts degrees to radians. */
export function degreesToRadians(degrees: number): number {
    return (degrees * Math.PI) / HALF_CIRCLE_DEG;
}

/** Converts radians to degrees. */
export function radiansToDegrees(radians: number): number {
    return (radians * HALF_CIRCLE_DEG) / Math.PI;
}

/** Euclidean distance between two points. */
export function distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

/** Calculates the total length of a path formed by an array of points. */
export function pathLength(points: Point[]): number {
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
        length += distance(points[index - 1], points[index]);
    }
    return length;
}

/** Calculates the path length of a Stroke object. */
export function strokeLength(stroke: Stroke): number {
    return pathLength(stroke.points ?? []);
}

/** Flattens multiple strokes into a single array of points. */
export function allPoints(strokes: Stroke[]): Point[] {
    return strokes.flatMap((stroke) => stroke.points ?? []);
}

/** Calculates the axis-aligned bounding box (AABB) for a set of points. */
export function boundsForPoints(points: Point[]): Bounds {
    if (!points.length) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }

    return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

/** Calculates the bounding box for a group of strokes. */
export function boundsForStrokes(strokes: Stroke[]): Bounds {
    return boundsForPoints(allPoints(strokes));
}

/** Returns the geometric center of a bounding box. */
export function centerOfBounds(bounds: Bounds): Point {
    return {
        x: bounds.minX + bounds.width / 2,
        y: bounds.minY + bounds.height / 2,
    };
}

/** Calculates the average position (arithmetic mean) of all points. */
export function centroid(points: Point[]): Point {
    if (!points.length) {
        return { x: 0, y: 0 };
    }
    const total = points.reduce(
        (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
        { x: 0, y: 0 },
    );
    return {
        x: total.x / points.length,
        y: total.y / points.length,
    };
}

/** Expands a bounding box by a fixed amount in all directions. */
export function expandBounds(bounds: Bounds, amount: number): Bounds {
    return {
        minX: bounds.minX - amount,
        minY: bounds.minY - amount,
        maxX: bounds.maxX + amount,
        maxY: bounds.maxY + amount,
        width: bounds.width + amount * 2,
        height: bounds.height + amount * 2,
    };
}

/** Checks if two bounding boxes overlap. */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
    return (
        a.minX <= b.maxX &&
        a.maxX >= b.minX &&
        a.minY <= b.maxY &&
        a.maxY >= b.minY
    );
}

/** Calculates the angle from a center point to a target point in degrees. */
export function angleDegFromCenter(point: Point, center: Point): number {
    return normalizeAngleDeg(
        radiansToDegrees(Math.atan2(center.y - point.y, point.x - center.x)),
    );
}

/** Converts a 2D vector [x, y] to an angle in degrees. */
export function angleFromCanvasVector(x: number, y: number): number {
    return normalizeAngleDeg(radiansToDegrees(Math.atan2(-y, x)));
}

/** Converts an angle in degrees back into a 2D unit vector. */
export function vectorFromAngleDeg(angleDeg: number): Vector {
    const radians = degreesToRadians(angleDeg);
    return {
        x: Math.cos(radians),
        y: -Math.sin(radians),
    };
}

/** Calculates the shortest angular distance between two angles (0..180). */
export function angularDifference(a: number, b: number): number {
    const diff =
        Math.abs(normalizeAngleDeg(a) - normalizeAngleDeg(b)) % FULL_CIRCLE_DEG;
    return diff > HALF_CIRCLE_DEG ? FULL_CIRCLE_DEG - diff : diff;
}

/** Arithmetic mean of an array of numbers. */
export function mean(values: number[]): number {
    if (!values.length) {
        return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Standard deviation of an array of numbers. */
export function stddev(values: number[]): number {
    if (values.length < 2) {
        return 0;
    }
    const average = mean(values);
    const variance = mean(values.map((value) => (value - average) ** 2));
    return Math.sqrt(variance);
}

/**
 * Finds the dominant axis (undirected orientation) of a set of points.
 *
 * Complex: Principal Component Analysis (simplified).
 * This calculates the covariance of the point cloud's distribution to find the
 * "long" axis of the shape. This is more robust than just checking width vs height
 * because it works for tilted shapes.
 */
export function dominantAxisOrientationDeg(points: Point[]): number {
    if (points.length < 2) {
        return 0;
    }

    const center = centroid(points);
    let xx = 0;
    let xy = 0;
    let yy = 0;

    for (const point of points) {
        const dx = point.x - center.x;
        const dy = point.y - center.y;
        xx += dx * dx;
        xy += dx * dy;
        yy += dy * dy;
    }

    // The angle of the primary eigenvector of the covariance matrix.
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    return normalizeAngleDeg(
        angleFromCanvasVector(Math.cos(angle), Math.sin(angle)),
    );
}

/** Finds the directed angle from the very first point of a drawing to the very last. */
export function directedStrokeAngle(strokes: Stroke[]): number {
    const firstStroke = strokes.find((stroke) => stroke.points.length > 1);
    const lastStroke = [...strokes]
        .reverse()
        .find((stroke) => stroke.points.length > 1);
    if (!firstStroke || !lastStroke) {
        return 0;
    }
    const first = firstStroke.points[0];
    const last = lastStroke.points[lastStroke.points.length - 1];
    return angleFromCanvasVector(last.x - first.x, last.y - first.y);
}

/**
 * Measures how "closed" a set of strokes is by finding the shortest gap between any two endpoints.
 */
export function endpointClosedness(strokes: Stroke[], size: number): number {
    const endpoints = strokes.flatMap((stroke) => {
        if (stroke.points.length < 2) {
            return [];
        }
        return [stroke.points[0], stroke.points[stroke.points.length - 1]];
    });

    if (endpoints.length < 2 || size <= 0) {
        return 0;
    }

    let minEndpointDistance = Infinity;
    for (let a = 0; a < endpoints.length; a += 1) {
        for (let b = a + 1; b < endpoints.length; b += 1) {
            minEndpointDistance = Math.min(
                minEndpointDistance,
                distance(endpoints[a], endpoints[b]),
            );
        }
    }

    // Normalize the gap distance relative to the symbol's overall size.
    return clamp(1 - minEndpointDistance / Math.max(8, size * 0.28));
}

/** Rounds a number to a fixed decimal precision. */
export function formatNumber(value: number, digits: number = 3): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return value;
    }
    return Number(value.toFixed(digits));
}
