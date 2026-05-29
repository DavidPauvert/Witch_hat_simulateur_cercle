import React from 'react';

interface JsonTreeProps {
    value: any;
    label?: string;
}

const JsonTree: React.FC<JsonTreeProps> = ({ value, label }) => {
    if (value && typeof value === 'object') {
        const isArray = Array.isArray(value);
        const entries = Object.entries(value);
        const meta =
            entries.length === 0
                ? ' empty '
                : ` ${entries.length} ${entries.length === 1 ? 'item' : 'items'} `;

        return (
            <div className="ml-4 font-mono text-xs">
                <details open className="group">
                    <summary className="cursor-pointer list-none hover:bg-slate-700/50 rounded px-1 transition-colors">
                        <span className="text-slate-500 group-open:hidden">
                            ▶
                        </span>
                        <span className="text-slate-500 hidden group-open:inline">
                            ▼
                        </span>
                        {label && (
                            <span className="text-indigo-400 font-bold ml-1">
                                {JSON.stringify(label)}:{' '}
                            </span>
                        )}
                        <span className="text-slate-300">
                            {isArray ? '[' : '{'}
                        </span>
                        <span className="text-slate-500 italic text-[10px]">
                            {meta}
                        </span>
                        <span className="text-slate-300">
                            {isArray ? ']' : '}'}
                        </span>
                    </summary>
                    <div className="border-l border-slate-700 ml-2 pl-2">
                        {entries.map(([key, val]) => (
                            <JsonTree key={key} label={key} value={val} />
                        ))}
                    </div>
                </details>
            </div>
        );
    }

    const type = value === null ? 'null' : typeof value;
    let color = 'text-slate-100';
    if (type === 'string') color = 'text-emerald-400';
    if (type === 'number') color = 'text-amber-400';
    if (type === 'boolean') color = 'text-purple-400';
    if (value === null) color = 'text-slate-500';

    return (
        <div className="ml-4 font-mono text-xs leading-relaxed">
            {label && (
                <span className="text-indigo-400 font-bold">
                    {JSON.stringify(label)}:{' '}
                </span>
            )}
            <span className={color}>{JSON.stringify(value)}</span>
        </div>
    );
};

export default JsonTree;
