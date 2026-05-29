import React from 'react';

const Header: React.FC = () => {
    return (
        <header className="flex items-end justify-between gap-[18px] mb-[18px] text-[#fff9e8]">
            <div>
                <p className="eyebrow font-display text-gold text-[13px] uppercase tracking-normal mb-[6px]">
                    Glyph Compiler
                </p>
                <h1 className="font-display text-[28px] leading-[1.1] font-bold tracking-normal m-0">
                    Witch Hat Atelier Spell Simulator
                </h1>
            </div>
            <div className="header-actions flex items-center gap-[10px]">
                <a
                    className="header-link font-sans min-h-[36px] inline-flex items-center border border-[rgba(255,247,219,0.34)] rounded-full px-[14px] text-[#fff8df] no-underline bg-[rgba(36,27,22,0.28)] hover:bg-[rgba(36,27,22,0.44)] transition-colors"
                    href="https://github.com/ytnrvdf/wha-spell-simulator"
                    target="_blank"
                    rel="noreferrer"
                >
                    GitHub
                </a>
            </div>
        </header>
    );
};

export default Header;
