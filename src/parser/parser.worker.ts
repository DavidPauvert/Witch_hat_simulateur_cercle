import { classifyDrawing } from './drawingClassifier';
import { compileSpell } from '../compiler/spellBuilder';
import { initWasm } from './wasmBridge';

/**
 * Web Worker for heavy drawing analysis and spell compilation.
 * Running this in a separate thread ensures the UI remains responsive (60fps)
 * even while complex geometric matching is taking place.
 */

// Initialize WASM as soon as possible to minimize latency on the first message.
initWasm();

/**
 * Message handler for the worker.
 * It receives the current raw strokes and dictionary, performs classification and compilation,
 * and sends the resulting AST and Spell IR back to the main thread.
 */
globalThis.onmessage = async (event: MessageEvent) => {
    const { strokes, previousRing, dictionary, config } = event.data;

    try {
        // Ensure WASM is ready before processing the drawing.
        await initWasm();

        // 1. Transform raw strokes into a structured Glyph AST.
        const pipeline = classifyDrawing({
            strokes,
            previousRing,
            dictionary,
            config,
        });

        // 2. Transform the Glyph AST into a high-level Spell IR (Intermediate Representation).
        // This stage applies semantic rules and validates the spell's logic.
        const spellIR = compileSpell({
            glyphAST: pipeline.glyphAST,
            config,
        });

        // Send the complete results back to the store on the main thread.
        self.postMessage({
            pipeline,
            spellIR,
        });
    } catch (error) {
        console.error('[Worker] Error during recompute:', error);
    }
};
