import { angleDegFromCenter, distance } from '../utils/geometry';
import { mapRadiusToLayer, LayerMapping } from './layerMapper';
import {
    Point,
    Stroke,
    RingCandidate,
    AppConfig,
    StrokeClassification,
} from '../types';

export interface NormalizedPoint extends Point {
    radiusNorm: number;
    angleDeg: number;
    centeredX: number;
    centeredY: number;
}

// Convert canvas coordinates into ring-relative measurements.
/**
 * Transforms a point from screen space into a coordinate system relative to the spell ring.
 * The radius is normalized such that 1.0 is exactly the radius of the ring.
 *
 * @param point - The point in canvas pixels.
 * @param ring - The detected ring parameters.
 * @returns A point with added radial and angular information.
 */
function normalizePoint(point: Point, ring: RingCandidate): NormalizedPoint {
    const radiusNorm = distance(point, ring.center) / Math.max(1, ring.radius);
    return {
        ...point,
        radiusNorm,
        angleDeg: angleDegFromCenter(point, ring.center),
        centeredX: point.x - ring.center.x,
        centeredY: ring.center.y - point.y,
    };
}

/**
 * Categorizes every user stroke based on its physical relationship to the main spell circle.
 * This determines which strokes are analyzed as symbols and which are ignored.
 *
 * @param strokes - All cleaned strokes from the user.
 * @param ring - The detected ring context.
 * @param config - Application configuration for layer boundaries.
 * @returns A classification for each stroke (e.g. 'inside', 'ring', 'outside').
 */
export function classifyStrokesAgainstRing(
    strokes: Stroke[],
    ring: RingCandidate,
    config: AppConfig,
): StrokeClassification[] {
    if (!ring.found) {
        // If no ring exists, everything is effectively "unbounded".
        return strokes.map((stroke) => ({
            strokeId: stroke.id,
            classification: 'unbounded',
            insideRatio: 0,
            outsideRatio: 0,
            boundaryRatio: 0,
            usedByParser: false,
            canJoinSymbol: false,
        }));
    }

    const ringStrokeIds = new Set(ring.strokeIds);

    return strokes.map((stroke) => {
        // If the ring detector already claimed this stroke, mark it as 'ring'.
        if (ringStrokeIds.has(stroke.id)) {
            return {
                strokeId: stroke.id,
                classification: 'ring',
                insideRatio: 0,
                outsideRatio: 0,
                boundaryRatio: 1,
                usedByParser: false,
                canJoinSymbol: false,
            };
        }

        const normalized = stroke.points.map((point) =>
            normalizePoint(point, ring),
        );

        // Calculate the percentage of the stroke's points that fall into different radial zones.
        const insideRatio =
            normalized.filter(
                (point) => point.radiusNorm < config.layers.outerMax,
            ).length / Math.max(1, normalized.length);

        const boundaryRatio =
            normalized.filter(
                (point) =>
                    point.radiusNorm >=
                        config.layers.outerMax -
                            config.layers.boundaryTolerance &&
                    point.radiusNorm <= config.layers.boundaryMax,
            ).length / Math.max(1, normalized.length);

        const outsideRatio =
            normalized.filter(
                (point) => point.radiusNorm > config.layers.boundaryMax,
            ).length / Math.max(1, normalized.length);

        // Complex: Classification Heuristics.
        // We use ratios rather than binary checks to handle hand-drawn messiness.
        let classification: StrokeClassification['classification'] = 'inside';
        if (outsideRatio > 0.62) {
            classification = 'outside';
        } else if (insideRatio > 0.12 && outsideRatio > 0.18) {
            // A stroke that spans across the ring perimeter.
            classification = 'boundary-crossing';
        } else if (boundaryRatio > 0.55 && insideRatio < 0.45) {
            // A stroke drawn very close to the ring itself.
            classification = 'boundary-near';
        }

        // Symbols must be mostly inside the ring to be valid.
        const usedByParser = classification === 'inside' && insideRatio >= 0.45;

        return {
            strokeId: stroke.id,
            classification,
            insideRatio,
            outsideRatio,
            boundaryRatio,
            usedByParser,
            canJoinSymbol:
                usedByParser ||
                (classification === 'boundary-near' && outsideRatio <= 0.08),
        };
    });
}

export interface PolarSummary extends LayerMapping {
    radiusNorm: number;
    angleDeg: number;
}

/**
 * Calculates a complete polar and semantic mapping for a single point.
 *
 * @returns An object containing normalized radius, angle, and the logical layer (center/inner/outer).
 */
export function summarizePolar(
    point: Point,
    ring: RingCandidate,
    config: AppConfig,
): PolarSummary {
    const normalized = normalizePoint(point, ring);
    const layer = mapRadiusToLayer(normalized.radiusNorm, config);
    return {
        radiusNorm: normalized.radiusNorm,
        angleDeg: normalized.angleDeg,
        ...layer,
    };
}
