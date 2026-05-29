import React from 'react';
import { useStore } from '../store/useStore';

const ControlPanel: React.FC = () => {
    const {
        strokes,
        pipeline,
        uiState,
        undo,
        clear,
        setGuides,
        setDiagnostics,
    } = useStore();

    const ringClosed = Boolean(pipeline?.ring?.complete);
    const undoDisabled = ringClosed || strokes.length === 0;

    return (
        <div className="flex flex-col">
            <section className="grid gap-[10px] border-b border-[rgba(36,27,22,0.16)] pb-[14px] mb-[14px]">
                <button
                    type="button"
                    onClick={undo}
                    disabled={undoDisabled}
                    className="wha-button w-full"
                >
                    Undo
                </button>
                <button
                    type="button"
                    onClick={clear}
                    disabled={strokes.length === 0}
                    className="wha-button w-full"
                >
                    Clear
                </button>
            </section>

            <section className="grid gap-[10px] border-b border-[rgba(36,27,22,0.16)] pb-[14px] mb-[14px]">
                <label className="toggle flex items-center justify-between min-h-[36px] border border-[rgba(36,27,22,0.2)] rounded-[6px] px-[12px] bg-[rgba(255,255,255,0.34)] cursor-pointer">
                    <span className="text-ink">Guides</span>
                    <input
                        type="checkbox"
                        checked={uiState.showGuides}
                        onChange={(e) => setGuides(e.target.checked)}
                        className="wha-toggle-input"
                    />
                </label>

                <label className="toggle flex items-center justify-between min-h-[36px] border border-[rgba(36,27,22,0.2)] rounded-[6px] px-[12px] bg-[rgba(255,255,255,0.34)] cursor-pointer">
                    <span className="text-ink">Glyph Diagnostics</span>
                    <input
                        type="checkbox"
                        checked={uiState.showDiagnostics}
                        onChange={(e) => setDiagnostics(e.target.checked)}
                        className="wha-toggle-input"
                    />
                </label>
            </section>
        </div>
    );
};

export default ControlPanel;
