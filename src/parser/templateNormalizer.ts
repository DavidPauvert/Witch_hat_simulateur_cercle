import { boundsForPoints, clamp, distance } from '../utils/geometry';
import { Point, Stroke } from '../types';

export interface NormalizationOptions {
    samplesPerStroke?: number;
    digits?: number;
    fitToBounds?: boolean;
}

export interface NormalizedResult {
    sourceAspectRatio: number;
    strokes: Point[][];
}

/** Ensures that the input, whether a Stroke object or a point array, is returned as a point array. */
function asPointArray(stroke: Stroke | Point[]): Point[] {
    return Array.isArray(stroke) ? stroke : (stroke.points ?? []);
}

/**
 * Re-samples a stroke into a fixed number of equidistant points.
 * This ensures that recognition is independent of drawing speed or input device resolution.
 *
 * @param points - The original points of the stroke.
 * @param targetCount - The desired number of points in the output.
 * @returns A new array of points spaced evenly along the original path.
 */
function resampleStroke(points: Point[], targetCount: number): Point[] {
    if (!points.length || targetCount <= 0) {
        return [];
    }
    if (points.length === 1 || targetCount === 1) {
        return Array.from({ length: targetCount }, () => ({
            x: points[0].x,
            y: points[0].y,
        }));
    }

    // Complex: Path Length Resampling.
    // 1. Calculate cumulative distance along the stroke's path.
    const cumulative = [0];
    for (let index = 1; index < points.length; index += 1) {
        cumulative.push(
            cumulative[index - 1] + distance(points[index - 1], points[index]),
        );
    }

    const total = cumulative[cumulative.length - 1];
    if (total <= 0.0001) {
        return Array.from({ length: targetCount }, () => ({
            x: points[0].x,
            y: points[0].y,
        }));
    }

    // 2. Interpolate new points at regular intervals along that distance.
    const result: Point[] = [];
    let segmentIndex = 1;
    for (let sample = 0; sample < targetCount; sample += 1) {
        const target = (total * sample) / Math.max(1, targetCount - 1);
        while (
            segmentIndex < cumulative.length - 1 &&
            cumulative[segmentIndex] < target
        ) {
            segmentIndex += 1;
        }

        const previousDistance = cumulative[segmentIndex - 1];
        const nextDistance = cumulative[segmentIndex];
        const local = clamp(
            (target - previousDistance) /
                Math.max(0.0001, nextDistance - previousDistance),
        );
        const previous = points[segmentIndex - 1];
        const next = points[segmentIndex];

        // Standard linear interpolation between the two original points surrounding the target distance.
        result.push({
            x: previous.x + (next.x - previous.x) * local,
            y: previous.y + (next.y - previous.y) * local,
        });
    }

    return result;
}

/** Rounds point coordinates to a specific number of decimal places to reduce data size and noise. */
function roundPoint(point: Point, digits: number): Point {
    const factor = 10 ** digits;
    return {
        x: Math.round(point.x * factor) / factor,
        y: Math.round(point.y * factor) / factor,
    };
}

/**
 * Normalizes a set of strokes by scaling and centering them into a unit square (0..1 range).
 * It also re-samples each stroke to a fixed point count for consistent template matching.
 *
 * @param strokes - The input strokes.
 * @param options - Normalization settings like sample count and precision.
 * @returns The normalized strokes and the original aspect ratio.
 */
export function normalizeStrokesForTemplate(
    strokes: (Stroke | Point[])[],
    options: NormalizationOptions = {},
): NormalizedResult {
    const samplesPerStroke = options.samplesPerStroke ?? 32;
    const digits = options.digits ?? 4;
    const sourceStrokes = strokes
        .map(asPointArray)
        .filter((points) => points.length > 0)
        .map((points) => points.map((point) => ({ x: point.x, y: point.y })));
    const allPoints = sourceStrokes.flat();

    if (!allPoints.length) {
        return {
            sourceAspectRatio: 1,
            strokes: [],
        };
    }

    // Find the bounding box to determine centering and scaling.
    const bounds = boundsForPoints(allPoints);
    const scale = options.fitToBounds
        ? Math.max(bounds.width, bounds.height, 0.0001)
        : Math.max(bounds.width, bounds.height, 1);

    const center = {
        x: bounds.minX + bounds.width / 2,
        y: bounds.minY + bounds.height / 2,
    };

    // Transform each point: (p - center) / scale + 0.5.
    // This shifts the symbol's geometric center to (0.5, 0.5) and scales it to fit within 0..1.
    const normalizedStrokes = sourceStrokes.map((points) => {
        const sampled = resampleStroke(points, samplesPerStroke);
        return sampled.map((point) =>
            roundPoint(
                {
                    x: (point.x - center.x) / scale + 0.5,
                    y: (point.y - center.y) / scale + 0.5,
                },
                digits,
            ),
        );
    });

    return {
        sourceAspectRatio:
            Math.round(
                (bounds.width /
                    Math.max(options.fitToBounds ? 0.0001 : 1, bounds.height)) *
                    1000,
            ) / 1000,
        strokes: normalizedStrokes,
    };
}
