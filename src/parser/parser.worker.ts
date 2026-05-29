import { classifyDrawing } from './drawingClassifier';
import { compileSpell } from '../compiler/spellBuilder';
import { initWasm } from './wasmBridge';

// Initialize WASM as soon as possible
initWasm();

self.onmessage = async (event: MessageEvent) => {
    const { strokes, previousRing, dictionary, config } = event.data;

    try {
        // Ensure WASM is ready before processing
        await initWasm();

        const pipeline = classifyDrawing({
            strokes,
            previousRing,
            dictionary,
            config,
        });

        const spellIR = compileSpell({
            glyphAST: pipeline.glyphAST,
            config,
        });

        self.postMessage({
            pipeline,
            spellIR,
        });
    } catch (error) {
        console.error('[Worker] Error during recompute:', error);
    }
};
