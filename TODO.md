# Project Upgrade Roadmap: Witch Hat Atelier Spell Simulator

This document outlines potential improvements and new features to enhance the simulator's realism, robustness, and user experience.

## 👁️ Parser & Recognition

- [x] **Distance Transform Matching**: Implement Chamfer Matching or similar distance-based algorithms in `templateMatcher.ts` for more "forgiving" symbol recognition.
- [x] **Continuous Rotation Optimization**: Use gradient descent to find the exact optimal rotation of a symbol rather than checking fixed intervals.
- [x] **Multi-Ring Support**: Upgrade `ringDetector.ts` to support nested circles or complex multi-ring geometries as seen in the manga's later chapters.
- [ ] **Gesture Shortcuts**: Add support for quick gestures (like a double-tap or a specific stroke) to clear the canvas or undo the last action.

## 📱 User Interface & Experience

- [ ] **The Grimoire (Dictionary Editor)**: A built-in UI to draw, name, and save new custom sigils and signs to the local dictionary.
- [ ] **Spell Playback & Sharing**: Record the drawing process and allow users to export/import "Spell Scrolls" (JSON representations of the stroke sequence).
- [ ] **Guided Drawing Mode**: Provide a "ghost" overlay for beginners to trace complex spells from the sample library.
- [ ] **Mobile Optimization**: Improve touch-target sizes and full-screen support for tablet devices.
