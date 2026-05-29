# Project Upgrade Roadmap: Witch Hat Atelier Spell Simulator

This document outlines potential improvements and new features to enhance the simulator's realism, robustness, and user experience.

## 🎨 Renderer & Visuals
- [ ] **WebGL/WebGPU Migration**: Replace the 2D Canvas particle system with a shader-based engine for high-performance magical effects (bloom, distortion, fluid sims).
- [ ] **High-Res Textures**: Add realistic paper grain and charcoal/ink brush textures.
- [ ] **Dynamic Lighting**: Make the magical effects cast light on the drawing and the "paper" surface.

## 👁️ Parser & Recognition
- [ ] **Distance Transform Matching**: Implement Chamfer Matching or similar distance-based algorithms in `templateMatcher.ts` for more "forgiving" symbol recognition.
- [ ] **Continuous Rotation Optimization**: Use gradient descent to find the exact optimal rotation of a symbol rather than checking fixed intervals.
- [ ] **Multi-Ring Support**: Upgrade `ringDetector.ts` to support nested circles or complex multi-ring geometries as seen in the manga's later chapters.
- [ ] **Gesture Shortcuts**: Add support for quick gestures (like a double-tap or a specific stroke) to clear the canvas or undo the last action.

## 🧠 Compiler & Magic Logic
- [ ] **Multi-Element Spells**: Allow the compiler to interpret spells with multiple sigils (e.g., Fire + Water = Steam).
- [ ] **Environmental Interaction**: Enable particles from different spells to interact (e.g., wind pushing fire, water extinguishing flames).
- [ ] **Spell Instability Logic**: Enhance `spellQuality.ts` to create "wild magic" or backfire effects if a spell is drawn with very low neatness.
- [ ] **Contextual Manifestations**: Make spells behave differently depending on where they are cast on the screen.

## 📱 User Interface & Experience
- [ ] **The Grimoire (Dictionary Editor)**: A built-in UI to draw, name, and save new custom sigils and signs to the local dictionary.
- [ ] **Spell Playback & Sharing**: Record the drawing process and allow users to export/import "Spell Scrolls" (JSON representations of the stroke sequence).
- [ ] **Guided Drawing Mode**: Provide a "ghost" overlay for beginners to trace complex spells from the sample library.
- [ ] **Mobile Optimization**: Improve touch-target sizes and full-screen support for tablet devices.

## 🛠️ Infrastructure & Performance
- [x] **Web Workers**: Move geometric calculations and recognition logic to background threads to ensure 60fps drawing on low-end devices.
- [x] **Visual Regression Testing**: Add automated tests to compare rendered spell effects against baseline snapshots.
- [x] **WASM Optimization**: Port heavy mathematical sections of the `parser` and `utils/geometry.ts` to AssemblyScript for peak performance.
