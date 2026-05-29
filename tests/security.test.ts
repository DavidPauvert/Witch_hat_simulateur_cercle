import { describe, it, expect } from 'vitest';
import { cleanStrokes } from '../src/parser/strokeCleaner';
import { analyzeTopologicalClosure } from '../src/parser/topologicalFloodFill';
import { CONFIG } from '../src/config';
import { Stroke } from '../src/types';

describe('Security & Robustness', () => {
    it('should truncate strokes with too many points', () => {
        const tooManyPoints = Array.from({ length: 2000 }, (_, i) => ({
            x: i,
            y: i,
        }));
        const rawStrokes: Stroke[] = [{ id: 's1', points: tooManyPoints }];

        const cleaned = cleanStrokes(rawStrokes, CONFIG);
        expect(cleaned[0].points.length).toBeLessThanOrEqual(
            CONFIG.limits.maxPointsPerStroke,
        );
    });

    it('should limit the total number of points across all strokes', () => {
        const points = [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
        ];
        const manyStrokes: Stroke[] = Array.from({ length: 200 }, (_, i) => ({
            id: `s${i}`,
            points: [...points],
        }));

        const cleaned = cleanStrokes(manyStrokes, CONFIG);
        const totalPoints = cleaned.reduce(
            (sum, s) => sum + s.points.length,
            0,
        );

        expect(cleaned.length).toBeLessThanOrEqual(CONFIG.limits.maxStrokes);
        expect(totalPoints).toBeLessThanOrEqual(CONFIG.limits.maxTotalPoints);
    });

    it('should handle extreme coordinates without crashing (OOM prevention)', () => {
        const strokes: Stroke[] = [
            {
                id: 's1',
                points: [
                    { x: 0, y: 0 },
                    { x: 1, y: 1 },
                ],
            },
            {
                id: 's2',
                points: [
                    { x: 1000000, y: 1000000 },
                    { x: 1000001, y: 1000001 },
                ],
            },
        ];

        // This would normally cause an OOM if it tried to allocate a 1,000,000x1,000,000 raster.
        // The implementation should now downscale the raster.
        const result = analyzeTopologicalClosure(strokes, CONFIG);

        expect(result.raster.width * result.raster.height).toBeLessThanOrEqual(
            CONFIG.limits.maxRasterArea + 1000,
        ); // Small margin
        expect(result.closed).toBe(false);
    });
});
