import { create } from 'zustand';
import {
    Stroke,
    Dictionary,
    SpellIR,
    RingCandidate,
    Point,
} from '../types';
import { CONFIG } from '../config';
import { loadDictionary } from '../dictionary/dictionaryLoader';
import { ClassificationResult } from '../parser/drawingClassifier';

interface UIState {
    showGuides: boolean;
    showDiagnostics: boolean;
    activeTab: string;
}

interface AppStore {
    strokes: Stroke[];
    currentStroke: Stroke | null;
    dictionary: Dictionary | null;
    pipeline: ClassificationResult | null;
    spellIR: SpellIR | null;
    previousRing: RingCandidate | null;
    isComputing: boolean;
    uiState: UIState;

    // Actions
    init: () => Promise<void>;
    addStroke: (points: Point[]) => void;
    setCurrentStroke: (stroke: Stroke | null) => void;
    undo: () => void;
    clear: () => void;
    scaleStrokes: (scaleX: number, scaleY: number) => void;
    setGuides: (show: boolean) => void;
    setDiagnostics: (show: boolean) => void;
    setActiveTab: (tab: string) => void;
    recompute: () => void;
    setStrokes: (strokes: Stroke[]) => void;
}

let nextStrokeId = 1;

const parserWorker = new Worker(
    new URL('../parser/parser.worker.ts', import.meta.url),
    { type: 'module' },
);

/**
 * The primary state management hub for the application, built with Zustand.
 * It coordinates the raw drawing data, the symbol dictionary, and
 * communication with the background Web Worker.
 */
export const useStore = create<AppStore>((set, get) => ({
    // Current list of finished ink strokes.
    strokes: [],
    // The stroke currently being drawn by the user.
    currentStroke: null,
    // Reference dictionary of sigils and signs.
    dictionary: null,
    // Intermediate results from the geometric pipeline.
    pipeline: null,
    // High-level functional parameters for the spell.
    spellIR: null,
    // The ring detected in the previous pass, used as a hint for the current pass.
    previousRing: null,
    // Boolean flag for showing a loading state if needed.
    isComputing: false,

    uiState: {
        showGuides: true,
        showDiagnostics: false,
        activeTab: 'summary',
    },

    /**
     * Initializes the store:
     * 1. Sets up the response handler for the background worker.
     * 2. Loads the symbol definitions from JSON.
     * 3. Triggers the first parser pass.
     */
    init: async () => {
        parserWorker.onmessage = (event) => {
            const { pipeline, spellIR } = event.data;
            set({
                pipeline,
                spellIR,
                previousRing: pipeline.ring,
                isComputing: false,
            });
        };

        try {
            const dictionary = await loadDictionary();
            set({ dictionary });
            get().recompute();
        } catch (error) {
            console.error('Failed to load dictionary:', error);
        }
    },

    /**
     * Commits a sequence of points as a new finished stroke.
     */
    addStroke: (points) => {
        const stroke: Stroke = {
            id: `s${nextStrokeId++}`,
            points: points.map((p) => ({ ...p })),
            startedAt: points[0]?.t ?? performance.now(),
            endedAt: points.at(-1)?.t ?? performance.now(),
        };
        set((state) => ({
            strokes: [...state.strokes, stroke],
            currentStroke: null,
        }));
        get().recompute();
    },

    /** Updates the temporary 'preview' stroke while the user is still dragging. */
    setCurrentStroke: (currentStroke) => set({ currentStroke }),

    /** Removes the most recently added stroke. */
    undo: () => {
        set((state) => ({
            strokes: state.strokes.slice(0, -1),
            // Reset previous ring to force a fresh detection after an undo.
            previousRing: null,
        }));
        get().recompute();
    },

    /** Clears all drawing data. */
    clear: () => {
        set({ strokes: [], previousRing: null, currentStroke: null });
        get().recompute();
    },

    /**
     * Scales all stroke coordinates.
     * Called when the canvas is resized to ensure drawing remains aligned.
     */
    scaleStrokes: (scaleX, scaleY) => {
        set((state) => ({
            strokes: state.strokes.map((stroke) => ({
                ...stroke,
                points: stroke.points.map((point) => ({
                    ...point,
                    x: point.x * scaleX,
                    y: point.y * scaleY,
                })),
            })),
            previousRing: null,
        }));
        get().recompute();
    },

    // UI State management setters.
    setGuides: (showGuides) =>
        set((state) => ({ uiState: { ...state.uiState, showGuides } })),
    setDiagnostics: (showDiagnostics) =>
        set((state) => ({ uiState: { ...state.uiState, showDiagnostics } })),
    setActiveTab: (activeTab) =>
        set((state) => ({ uiState: { ...state.uiState, activeTab } })),

    /**
     * Offloads the heavy geometric analysis and spell compilation to a Web Worker.
     * This prevents the main UI thread from stuttering during drawing.
     */
    recompute: () => {
        const { strokes, dictionary, previousRing } = get();
        if (!dictionary) return;

        set({ isComputing: true });

        parserWorker.postMessage({
            strokes,
            previousRing,
            dictionary,
            config: CONFIG,
        });
    },

    /** Batch updates all strokes at once. */
    setStrokes: (strokes) => {
        set({ strokes, previousRing: null });
        get().recompute();
    },
}));
