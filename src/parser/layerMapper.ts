import { clamp } from '../utils/geometry';
import { AppConfig } from '../types';

export interface LayerMapping {
    layer: 'center' | 'middle' | 'outer' | 'ringBoundary' | 'outside';
    nearBoundary: boolean;
}

/**
 * Maps a normalized radial distance to its corresponding logical layer in the spell circle.
 * It also determines if the point is "near a boundary", which can trigger ambiguity warnings.
 *
 * @param radiusNorm - The distance from the ring center, where 1.0 is the ring's radius.
 * @param config - Application configuration defining layer thresholds.
 * @returns The logical layer and a boolean indicating proximity to a boundary.
 */
export function mapRadiusToLayer(
    radiusNorm: number,
    config: AppConfig,
): LayerMapping {
    const layers = config.layers;
    let layer: LayerMapping['layer'] = 'outside';

    // Complex: Radial Zoning.
    // We categorize points based on their distance from the center.
    // 0.0 -> centerMax: The primary sigil area.
    // centerMax -> middleMax: The middle ring.
    // middleMax -> outerMax: The outer ring where signs usually go.
    // outerMax -> boundaryMax: The area occupied by the physical drawn ring itself.
    if (radiusNorm <= layers.centerMax) {
        layer = 'center';
    } else if (radiusNorm <= layers.middleMax) {
        layer = 'middle';
    } else if (radiusNorm <= layers.outerMax) {
        layer = 'outer';
    } else if (radiusNorm <= layers.boundaryMax) {
        layer = 'ringBoundary';
    }

    const boundaries = [
        0,
        layers.centerMax,
        layers.middleMax,
        layers.outerMax,
        layers.boundaryMax,
    ];

    // Calculate how close the point is to any of the layer transitions.
    const nearestBoundaryDistance = Math.min(
        ...boundaries.map((boundary) => Math.abs(radiusNorm - boundary)),
    );

    // Normalize the distance by the tolerance config to get a 0-1 "nearness" score.
    const boundaryDistanceScore = clamp(
        nearestBoundaryDistance / Math.max(0.001, layers.boundaryTolerance),
    );

    return {
        layer,
        // If the point is within roughly half of the tolerance width, mark it as "near boundary".
        nearBoundary: boundaryDistanceScore < 0.55,
    };
}
