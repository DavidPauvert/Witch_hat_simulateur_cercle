import React, { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { buildDiagnosticState } from '../debug/diagnosticState';
import JsonTree from './JsonTree';

const DiagnosticsPanel: React.FC = () => {
    const { strokes, pipeline, spellIR } = useStore();
    const [activeTab, setActiveTab] = useState<'parser' | 'ast' | 'ir'>(
        'parser',
    );
    const [copied, setCopied] = useState(false);

    const state = useMemo(
        () =>
            buildDiagnosticState({
                rawStrokes: strokes,
                pipeline,
                spellIR,
            }),
        [strokes, pipeline, spellIR],
    );

    const panelData = useMemo(() => {
        switch (activeTab) {
            case 'ast':
                return state.glyphAST;
            case 'ir':
                return state.spellIR;
            case 'parser':
            default:
                return {
                    rawStrokes: state.rawStrokes,
                    ring: state.ring,
                    classifications: state.classifications,
                    candidates: state.candidates,
                    recognitions: state.recognitions,
                };
        }
    }, [activeTab, state]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(
                JSON.stringify(panelData, null, 2),
            );
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy!', err);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <nav className="diagnostics-tabs grid grid-cols-3 gap-0 mb-[10px] border-b border-[rgba(36,27,22,0.18)] flex-shrink-0">
                {[
                    { id: 'parser', label: 'Parser' },
                    { id: 'ast', label: 'AST' },
                    { id: 'ir', label: 'IR' },
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`min-w-0 px-2 py-2 text-[11px] font-bold uppercase tracking-tight transition-all border-b-2 bg-transparent shadow-none rounded-none ${
                            activeTab === tab.id
                                ? 'text-ink border-teal bg-[rgba(255,251,233,0.56)]'
                                : 'text-mutedink border-transparent hover:bg-[rgba(255,242,197,0.64)]'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </nav>

            <div className="diagnostic-panel-shell flex-1 flex flex-col min-h-0 relative">
                <p className="panel-description m-0 mb-[10px] text-mutedink text-[12px] leading-[1.35]">
                    {activeTab === 'parser' &&
                        'Parser shows the raw drawing analysis: cleaned strokes, ring detection, stroke classification, symbol candidates, and recognition scores.'}
                    {activeTab === 'ast' &&
                        'AST (Abstract Syntax Tree) is the parsed glyph structure, similar to programming-language ASTs: ring, sigils, signs, and unknown marks.'}
                    {activeTab === 'ir' &&
                        'IR (Intermediate Representation) is the compiled spell behavior: validity, active state, element, strength, quality, and stability.'}
                </p>

                <div className="diagnostic-viewer-shell relative flex-1 min-h-0 flex flex-col bg-panel border border-[rgba(36,27,22,0.16)] rounded-[6px] overflow-hidden">
                    <button
                        onClick={handleCopy}
                        className="diagnostic-copy-button absolute top-[7px] right-[7px] z-10 min-h-[28px] px-[9px] rounded-[6px] bg-[rgba(255,242,197,0.92)] text-mutedink text-[12px] border border-[rgba(36,27,22,0.16)] hover:bg-[#ffe6a3] transition-colors shadow-sm"
                    >
                        {copied ? 'Copied!' : 'Copy'}
                    </button>

                    <div className="diagnostic-output flex-1 overflow-auto p-[10px] custom-scrollbar select-text text-ink font-mono text-[12px] leading-[1.45] bg-[#fffbe9]">
                        <JsonTree value={panelData} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DiagnosticsPanel;
