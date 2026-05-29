import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { SymbolEntry } from '../types';

const StrokePreview: React.FC<{ strokes: any[] }> = ({ strokes }) => {
    if (!strokes?.length) return null;

    return (
        <div className="reference-preview w-[82px] aspect-square border border-[rgba(36,27,22,0.14)] rounded-[6px] bg-panel flex-shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full">
                {strokes.map((stroke, i) => {
                    const points = stroke
                        .map((p: any) => `${8 + p.x * 84},${8 + p.y * 84}`)
                        .join(' ');
                    return (
                        <polyline
                            key={i}
                            points={points}
                            className="fill-none stroke-ink stroke-[4] stroke-round stroke-linejoin"
                        />
                    );
                })}
            </svg>
        </div>
    );
};

const ReferenceCard: React.FC<{
    entry: SymbolEntry;
    kind: 'sigil' | 'sign' | 'sample';
}> = ({ entry, kind }) => {
    const isSample = kind === 'sample';
    const hasStrokes = Boolean(
        isSample
            ? (entry as any).strokes?.length
            : entry.strokeTemplate?.strokes?.length,
    );
    const strokes = isSample
        ? (entry as any).strokes
        : entry.strokeTemplate?.strokes;

    return (
        <article className="reference-card border border-[rgba(36,27,22,0.14)] rounded-[6px] p-[9px] bg-[rgba(255,251,233,0.82)] grid grid-cols-[82px_minmax(0,1fr)] gap-[9px] items-center">
            <StrokePreview strokes={strokes} />
            <div className="min-w-0">
                <div className="reference-card-header flex items-baseline justify-between gap-[10px] mb-[6px]">
                    <strong className="text-ink text-[14px] truncate block">
                        {entry.displayName || entry.id}
                    </strong>
                    <span className="text-mutedink text-[12px] capitalize">
                        {entry.element || kind}
                    </span>
                </div>

                {isSample && (entry as any).description && (
                    <p className="reference-card-description m-0 mb-[8px] text-mutedink text-[12px] leading-[1.4] line-clamp-2">
                        {(entry as any).description}
                    </p>
                )}

                <dl className="grid gap-[4px] m-0">
                    <div className="flex justify-between gap-[12px]">
                        <dt className="text-mutedink text-[12px]">Layers</dt>
                        <dd className="m-0 text-right text-[12px] text-ink truncate">
                            {(entry.allowedLayers || []).join(', ')}
                        </dd>
                    </div>
                    {!isSample && (
                        <div className="flex justify-between gap-[12px]">
                            <dt className="text-mutedink text-[12px]">
                                Template
                            </dt>
                            <dd className="m-0 text-right text-[12px] text-ink">
                                {hasStrokes ? 'Available' : 'None'}
                            </dd>
                        </div>
                    )}
                </dl>
            </div>
        </article>
    );
};

const DictionaryPanel: React.FC = () => {
    const { dictionary } = useStore();
    const [activeTab, setActiveTab] = useState<'samples' | 'sigils' | 'signs'>(
        'samples',
    );

    if (!dictionary)
        return (
            <div className="flex items-center justify-center h-full text-mutedink italic text-sm">
                Loading library...
            </div>
        );

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <nav className="reference-tabs grid grid-cols-3 gap-0 mb-[10px] border-b border-[rgba(36,27,22,0.18)] flex-shrink-0">
                {[
                    { id: 'samples', label: 'Sample Spells' },
                    { id: 'sigils', label: 'Sigils' },
                    { id: 'signs', label: 'Signs' },
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

            <div className="reference-list flex-1 overflow-y-auto space-y-[8px] custom-scrollbar pr-1">
                <p className="panel-description m-0 mb-[10px] text-mutedink text-[12px] leading-[1.35]">
                    {activeTab === 'samples' &&
                        'Sample spells show complete seal layouts you can use as drawing references.'}
                    {activeTab === 'sigils' &&
                        'Sigils, typically placed in the center of a seal, control what type of spell a seal will generate.'}
                    {activeTab === 'signs' &&
                        'Signs control what form spells will take. They serve as modifiers, allowing the effect of a spell to be altered.'}
                </p>

                {activeTab === 'samples' &&
                    (dictionary.sampleSpells || []).map((sample: any) => (
                        <ReferenceCard
                            key={sample.id}
                            entry={sample}
                            kind="sample"
                        />
                    ))}
                {activeTab === 'sigils' &&
                    Object.values(dictionary.sigils || {}).map((sigil: any) => (
                        <ReferenceCard
                            key={sigil.id}
                            entry={sigil}
                            kind="sigil"
                        />
                    ))}
                {activeTab === 'signs' &&
                    Object.values(dictionary.signs || {}).map((sign: any) => (
                        <ReferenceCard key={sign.id} entry={sign} kind="sign" />
                    ))}
            </div>
        </div>
    );
};

export default DictionaryPanel;
