import { boundsForPoints, pathLength } from '../utils/geometry';
import { Point, Stroke, AppConfig, Bounds } from '../types';

export interface CleanedStroke extends Stroke {
    metrics: {
        length: number;
        bounds: Bounds;
        pointCount: number;
    };
}

/**
 * Smooths a sequence of points by applying a simple neighborhood averaging filter.
 * This helps reduce "hand jitter" from stylus or mouse input while maintaining the overall shape.
 *
 * @param points - The array of points to smooth.
 * @returns A new array of smoothed points.
 */
function smoothPoints(points: Point[]): Point[] {
    if (points.length < 4) {
        return points.map((point) => ({ ...point }));
    }

    return points.map((point, index) => {
        if (index === 0 || index === points.length - 1) {
            return { ...point };
        }
        const previous = points[index - 1];
        const next = points[index + 1];

        // Complex: Laplacian smoothing.
        // We calculate the new position by taking 50% of the current position and 25% of each neighbor's position.
        // This effectively "blunts" sharp corners and noise, pulling the point towards the center of its immediate path.
        // We keep the first and last points fixed to preserve the stroke's start and end locations.
        return {
            ...point,
            x: previous.x * 0.25 + point.x * 0.5 + next.x * 0.25,
            y: previous.y * 0.25 + point.y * 0.5 + next.y * 0.25,
        };
    });
}

/**
 * Processes raw input strokes to make them easier for the parser to handle.
 * It enforces limits on stroke and point counts, removes strokes that are too short,
 * and applies smoothing passes to reduce noise.
 *
 * @param rawStrokes - The strokes captured directly from user input.
 * @param config - Application configuration for limits and smoothing settings.
 * @returns An array of "cleaned" strokes with pre-calculated metrics like length and bounds.
 */
export function cleanStrokes(
    rawStrokes: Stroke[],
    config: AppConfig,
): CleanedStroke[] {
    const cleaned: CleanedStroke[] = [];
    let totalPoints = 0;

    for (const stroke of rawStrokes) {
        // Enforce safety limits to prevent performance issues with excessively large drawings.
        if (cleaned.length >= config.limits.maxStrokes) break;
        if (totalPoints >= config.limits.maxTotalPoints) break;

        let points = stroke.points.map((point) => ({ ...point }));

        // Enforce per-stroke point limit: prevents single strokes from being too complex.
        if (points.length > config.limits.maxPointsPerStroke) {
            points = points.slice(0, config.limits.maxPointsPerStroke);
        }

        // Enforce global point budget: ensures the total complexity of the drawing stays within bounds.
        if (totalPoints + points.length > config.limits.maxTotalPoints) {
            points = points.slice(
                0,
                config.limits.maxTotalPoints - totalPoints,
            );
        }

        if (points.length < 2) continue;

        // Apply multiple smoothing passes to progressively refine the stroke shape.
        for (let pass = 0; pass < config.input.smoothingPasses; pass += 1) {
            points = smoothPoints(points);
        }

        const length = pathLength(points);
        // Ignore strokes that are basically dots or tiny artifacts.
        if (length < config.input.minStrokeLength) continue;

        const bounds = boundsForPoints(points);
        totalPoints += points.length;

        cleaned.push({
            ...stroke,
            points,
            metrics: {
                length,
                bounds,
                pointCount: points.length,
            },
        });
    }

    return cleaned;
}
