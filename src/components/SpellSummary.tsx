import React from 'react';
import { useStore } from '../store/useStore';
import { GLYPH_WARNINGS } from '../parser/glyphWarnings';

const Meter: React.FC<{
    label: string;
    value: number;
    showDiagnostics: boolean;
}> = ({ label, value, showDiagnostics }) => {
    const percent = Math.round(value * 100);

    let level: 'low' | 'medium' | 'high' = 'low';
    if (percent > 70) level = 'high';
    else if (percent > 35) level = 'medium';

    const levelColor = {
        low: 'bg-ember',
        medium: 'bg-[#d4a13d]',
        high: 'bg-[#2f8a64]',
    }[level];

    return (
        <div className="meter-row grid grid-cols-[82px_minmax(0,1fr)] items-center gap-[10px] text-mutedink text-[14px]">
            <span>{label}</span>
            <div className="meter h-[9px] overflow-hidden rounded-full bg-[rgba(36,27,22,0.14)] relative">
                <span
                    className={`block h-full transition-[width] duration-160 ease-in-out rounded-inherit ${levelColor}`}
                    style={{ width: `${percent}%` }}
                />
            </div>
            {showDiagnostics && (
                <span className="diagnostic-meter-value min-w-[34px] text-right text-ink font-mono text-[14px]">
                    {percent}%
                </span>
            )}
        </div>
    );
};

const SpellSummary: React.FC = () => {
    const { pipeline, spellIR, uiState } = useStore();

    const ringClosed = Boolean(pipeline?.ring?.complete);
    const hasUnsupportedMultipleRings = Boolean(
        pipeline?.ring?.unsupportedMultipleRings?.length,
    );
    const hasUnsupportedMultipleSigils = Boolean(
        pipeline?.glyphAST?.unsupportedMultipleSigils?.length,
    );
    const closedWithoutSpell = ringClosed && !spellIR?.active;

    const getStatus = () => {
        if (hasUnsupportedMultipleRings)
            return 'Multiple rings detected - undo or clear';
        if (hasUnsupportedMultipleSigils)
            return 'Multiple sigils detected - undo or clear';
        if (closedWithoutSpell) {
            const warnings = spellIR?.warnings ?? [];
            if (
                warnings.includes(GLYPH_WARNINGS.primaryElementMissing) ||
                warnings.includes(GLYPH_WARNINGS.primaryElementUnsupported)
            )
                return 'Ring closed - unsupported element';
            if (warnings.includes(GLYPH_WARNINGS.symbolContaminated))
                return 'Ring closed - contaminated sigil';
            if (warnings.includes(GLYPH_WARNINGS.symbolAmbiguous))
                return 'Ring closed - ambiguous sigil';
            if (warnings.includes(GLYPH_WARNINGS.primarySigilAmbiguous))
                return 'Ring closed - ambiguous sigil';
            if (warnings.includes(GLYPH_WARNINGS.primarySigilConfidenceLow))
                return 'Ring closed - unstable sigil';
            return 'Ring closed - no stable magic detected';
        }
        return spellIR?.status ?? 'No ring detected';
    };

    const getStatusClass = () => {
        if (spellIR?.active) return 'active';
        if (spellIR?.prepared) return 'prepared';
        if (closedWithoutSpell || !spellIR?.valid) return 'invalid';
        return '';
    };

    const manifestations = Object.entries(spellIR?.manifestations ?? {})
        .filter(([, m]) => m.strength > 0)
        .map(([id]) => id);

    return (
        <div className="flex flex-col">
            <div
                className={`spell-state-status w-full max-w-full my-[8px] mx-0 p-0 border-0 rounded-none text-[13px] font-semibold text-left text-ink inline-flex items-center gap-[8px] shadow-none bg-transparent ${getStatusClass()}`}
            >
                <span
                    className={`status-dot w-[9px] h-[9px] flex-[0_0_auto] rounded-full bg-[rgba(36,27,22,0.38)] 
          ${spellIR?.active || spellIR?.prepared ? 'bg-teal' : ''} 
          ${closedWithoutSpell || !spellIR?.valid ? 'bg-[#8d5149]' : ''}`}
                />
                {getStatus()}
            </div>

            <section className="summary-band grid grid-cols-1 gap-[10px] border-b border-[rgba(36,27,22,0.16)] pb-[14px]">
                <div className="flex items-baseline justify-between gap-[14px]">
                    <span className="label text-mutedink text-[13px]">
                        Element
                    </span>
                    <strong className="text-teal text-[14px] text-right capitalize">
                        {spellIR?.element || 'None'}
                    </strong>
                </div>
                <div className="flex items-baseline justify-between gap-[14px]">
                    <span className="label text-mutedink text-[13px]">
                        Manifestations
                    </span>
                    <strong className="text-teal text-[14px] text-right">
                        {manifestations.length > 0
                            ? manifestations.join(', ')
                            : 'None'}
                    </strong>
                </div>
            </section>

            <section
                className={`meter-list grid gap-[12px] py-[16px] px-0 ${uiState.showDiagnostics ? 'diagnostics-visible' : ''}`}
            >
                <Meter
                    label="Quality"
                    value={spellIR?.quality ?? 0}
                    showDiagnostics={uiState.showDiagnostics}
                />
                <Meter
                    label="Stability"
                    value={spellIR?.stability ?? 0}
                    showDiagnostics={uiState.showDiagnostics}
                />
                <Meter
                    label="Force"
                    value={spellIR?.force ?? 0}
                    showDiagnostics={uiState.showDiagnostics}
                />
            </section>

            {spellIR?.warnings && spellIR.warnings.length > 0 && (
                <div className="space-y-2 mt-2">
                    <span className="text-[10px] uppercase tracking-wider text-mutedink font-bold flex items-center">
                        Warnings
                    </span>
                    <ul className="text-[11px] text-ember/80 list-disc list-inside space-y-1 ml-1 bg-ember/5 p-2 rounded-[6px] border border-ember/10">
                        {spellIR.warnings.map((w, i) => (
                            <li key={i} className="leading-tight">
                                {w.replace(/_/g, ' ')}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

export default SpellSummary;
