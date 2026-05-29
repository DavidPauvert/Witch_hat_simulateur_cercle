import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const samplesPath = path.join(
    __dirname,
    '../src/dictionary/sample-spells.json',
);
const samples = JSON.parse(fs.readFileSync(samplesPath, 'utf8'));

// Test a representative set of samples
const testSamples = samples.slice(0, 3);

test.describe('Visual Regression', () => {
    test.use({ viewport: { width: 1500, height: 1000 } });

    for (const sample of testSamples) {
        test(`renders ${sample.id} correctly`, async ({ page }) => {
            test.setTimeout(60000);

            page.on('console', (msg) => console.log(`[Browser] ${msg.text()}`));

            await page.goto('/');

            // Force square canvas area for consistent recognition
            await page.evaluate(() => {
                const shell = document.querySelector(
                    '.canvas-shell',
                ) as HTMLElement;
                if (shell) {
                    shell.style.width = '800px';
                    shell.style.height = '800px';
                    shell.style.flex = 'none';
                }
            });

            // Wait for store to be initialized and dictionary to be loaded
            await page.waitForFunction(() => {
                const store = (globalThis as any).store;
                return store && store.getState().dictionary !== null;
            });

            // Give layout a moment to stabilize
            await page.waitForTimeout(500);

            // Inject strokes scaled by canvas size
            await page.evaluate((sampleData) => {
                const canvas = document.getElementById(
                    'glyphCanvas',
                ) as HTMLCanvasElement;
                const width = canvas.width;
                const height = canvas.height;

                const strokes = sampleData.strokes.map(
                    (points: any[], i: number) => ({
                        id: `test-s${i}`,
                        points: points.map((p) => ({
                            x: p.x * width,
                            y: p.y * height,
                            t: Date.now(),
                        })),
                        startedAt: Date.now(),
                        endedAt: Date.now(),
                    }),
                );

                (globalThis as any).store.getState().setStrokes(strokes);
            }, sample);

            // Wait for computation to finish
            await page.waitForFunction(
                () => {
                    const state = (globalThis as any).store.getState();
                    return (
                        state.isComputing === false && state.pipeline !== null
                    );
                },
                { timeout: 20000 },
            );

            // Wait for spell to be valid
            await page.waitForFunction(
                () => {
                    const spellIR = (globalThis as any).store.getState().spellIR;
                    return spellIR?.valid;
                },
                { timeout: 15000 },
            );

            // Force activation if it's not active (to see particles in snapshots)
            await page.evaluate(() => {
                const store = (globalThis as any).store;
                const state = store.getState();
                if (state.spellIR && !state.spellIR.active) {
                    store.setState({
                        spellIR: {
                            ...state.spellIR,
                            active: true,
                            activatedAt: performance.now(),
                        },
                    });
                }
            });

            // Give a little time for particle effects to start and stabilize
            await page.waitForTimeout(1000);

            // Take screenshot of the canvas area
            const canvasShell = page.locator('.canvas-shell');
            await expect(canvasShell).toHaveScreenshot(`${sample.id}.png`, {
                maxDiffPixelRatio: 0.15,
                animations: 'allow',
            });
        });
    }
});
