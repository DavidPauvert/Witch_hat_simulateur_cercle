import { create } from 'zustand';
import {
    Stroke,
    Dictionary,
    GlyphAST,
    SpellIR,
    RingCandidate,
    Point,
} from '../types';
import { CONFIG } from '../config';
import {
    classifyDrawing,
    ClassificationResult,
} from '../parser/drawingClassifier';
import { compileSpell } from '../compiler/spellBuilder';
import { loadDictionary } from '../dictionary/dictionaryLoader';

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
}

let nextStrokeId = 1;

export const useStore = create<AppStore>((set, get) => ({
    strokes: [],
    currentStroke: null,
    dictionary: null,
    pipeline: null,
    spellIR: null,
    previousRing: null,
    uiState: {
        showGuides: true,
        showDiagnostics: false,
        activeTab: 'summary',
    },

    init: async () => {
        try {
            const dictionary = await loadDictionary();
            set({ dictionary });
            get().recompute();
        } catch (error) {
            console.error('Failed to load dictionary:', error);
        }
    },

    addStroke: (points) => {
        const stroke: Stroke = {
            id: `s${nextStrokeId++}`,
            points: points.map((p) => ({ ...p })),
            startedAt: points[0]?.t ?? performance.now(),
            endedAt: points[points.length - 1]?.t ?? performance.now(),
        };
        set((state) => ({
            strokes: [...state.strokes, stroke],
            currentStroke: null,
        }));
        get().recompute();
    },

    setCurrentStroke: (currentStroke) => set({ currentStroke }),

    undo: () => {
        set((state) => ({
            strokes: state.strokes.slice(0, -1),
            previousRing: null,
        }));
        get().recompute();
    },

    clear: () => {
        set({ strokes: [], previousRing: null, currentStroke: null });
        get().recompute();
    },

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

    setGuides: (showGuides) =>
        set((state) => ({ uiState: { ...state.uiState, showGuides } })),
    setDiagnostics: (showDiagnostics) =>
        set((state) => ({ uiState: { ...state.uiState, showDiagnostics } })),
    setActiveTab: (activeTab) =>
        set((state) => ({ uiState: { ...state.uiState, activeTab } })),

    recompute: () => {
        const { strokes, dictionary, previousRing } = get();
        if (!dictionary) return;

        const pipeline = classifyDrawing({
            strokes,
            previousRing,
            dictionary,
            config: CONFIG,
        });

        const spellIR = compileSpell({
            glyphAST: pipeline.glyphAST,
            config: CONFIG,
        });

        set({
            pipeline,
            spellIR,
            previousRing: pipeline.ring,
        });
    },
}));
