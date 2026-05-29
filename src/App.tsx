import React, { useEffect } from 'react';
import { useStore } from './store/useStore';
import Header from './components/Header';
import ControlPanel from './components/ControlPanel';
import CanvasPanel from './components/CanvasPanel';
import DictionaryPanel from './components/DictionaryPanel';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import SpellSummary from './components/SpellSummary';

/**
 * Root component of the application.
 * It sets up the main workspace layout using a grid with three columns:
 * 1. Left sidebar for controls and real-time spell state.
 * 2. Center area for the drawing canvas.
 * 3. Right sidebar for the symbol dictionary and advanced diagnostics.
 */
const App: React.FC = () => {
    const { init, uiState, setActiveTab } = useStore();

    // Initialize the application store (load dictionaries, setup worker) on mount.
    useEffect(() => {
        init();
    }, [init]);

    return (
        <div className="max-w-[1480px] min-h-screen mx-auto p-6 flex flex-col h-screen overflow-hidden text-ink">
            <Header />

            <main className="workspace grid gap-[18px] flex-1 min-h-0 grid-cols-[minmax(230px,0.8fr)_minmax(0,2.2fr)_minmax(280px,1fr)]">
                {/* Left Sidebar: Contains global drawing settings and a summary of the current spell. */}
                <aside className="wha-panel" aria-label="Spell controls">
                    <div className="flex-1 overflow-y-auto p-[14px] flex flex-col custom-scrollbar">
                        <ControlPanel />
                        <div className="mt-auto border-t border-[rgba(36,27,22,0.16)] pt-[14px]">
                            <h2 className="font-display text-mutedink text-base font-semibold tracking-normal uppercase mb-[10px]">
                                Spell State
                            </h2>
                            <SpellSummary />
                        </div>
                    </div>
                </aside>

                {/* Center Section: The interactive drawing surface where the user creates spell diagrams. */}
                <section
                    className="wha-panel"
                    aria-label="Spell drawing surface"
                >
                    <CanvasPanel />
                </section>

                {/* Right Sidebar: Switchable tabs for the reference dictionary and technical AST diagnostics. */}
                <aside
                    className="wha-panel"
                    aria-label="Dictionary and diagnostics"
                >
                    <nav className="grid grid-cols-2 gap-0 border-b border-[rgba(36,27,22,0.2)] mb-[14px] flex-shrink-0">
                        {[
                            { id: 'summary', label: 'Dictionary' },
                            { id: 'diagnostics', label: 'Diagnostic' },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`min-w-0 px-2 py-2 text-sm font-bold uppercase tracking-widest transition-all border-b-2 bg-transparent shadow-none rounded-none ${
                                    uiState.activeTab === tab.id
                                        ? 'text-ink border-teal bg-[rgba(255,251,233,0.56)]'
                                        : 'text-mutedink border-transparent hover:bg-[rgba(255,242,197,0.64)]'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </nav>

                    <div className="flex-1 overflow-hidden p-[14px] pt-0 flex flex-col">
                        {uiState.activeTab === 'summary' ? (
                            <DictionaryPanel />
                        ) : (
                            <DiagnosticsPanel />
                        )}
                    </div>
                </aside>
            </main>

            <footer className="app-footer grid gap-1 mt-[14px] text-[12px] text-[rgba(255,249,232,0.78)] text-left leading-[1.4] flex-shrink-0 font-sans">
                <p>
                    Unofficial fan-made spell diagram simulator inspired by
                    Witch Hat Atelier.
                </p>
            </footer>
        </div>
    );
};

export default App;
