import {
    canvasPointFromEvent,
    shouldKeepPoint,
    EventPoint,
} from './pointerNormalizer';
import { pathLength } from '../utils/geometry';
import { AppConfig, Stroke } from '../types';

export interface DrawingCaptureCallbacks {
    onPreview?: (stroke: Stroke | null) => void;
    onCommit?: (points: EventPoint[]) => void;
}

/**
 * Handles raw pointer input from the user and transforms it into ink strokes.
 * It manages the lifecycle of a drawing interaction: start, move (sampling), and commit.
 */
export class DrawingCapture {
    canvas: HTMLCanvasElement;
    config: AppConfig;
    callbacks: DrawingCaptureCallbacks;
    currentPoints: EventPoint[];
    pointerId: number | null;
    enabled: boolean;
    locked: boolean;

    /**
     * Initializes the capture system for a specific canvas element.
     */
    constructor(
        canvas: HTMLCanvasElement,
        config: AppConfig,
        callbacks: DrawingCaptureCallbacks = {},
    ) {
        this.canvas = canvas;
        this.config = config;
        this.callbacks = callbacks;
        this.currentPoints = [];
        this.pointerId = null;
        this.enabled = false;
        this.locked = false;

        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
    }

    /** Toggles whether drawing input is currently accepted. */
    setLocked(locked: boolean) {
        this.locked = locked;
        if (locked) {
            this.clearPreview();
        }
    }

    /** Attaches pointer event listeners to the canvas to begin capturing drawing input. */
    enable() {
        if (this.enabled) {
            return;
        }
        this.canvas.addEventListener('pointerdown', this.handlePointerDown);
        this.canvas.addEventListener('pointermove', this.handlePointerMove);
        this.canvas.addEventListener('pointerup', this.handlePointerUp);
        this.canvas.addEventListener('pointercancel', this.handlePointerUp);
        this.enabled = true;
    }

    /** Removes pointer event listeners from the canvas. */
    disable() {
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.canvas.removeEventListener('pointermove', this.handlePointerMove);
        this.canvas.removeEventListener('pointerup', this.handlePointerUp);
        this.canvas.removeEventListener('pointercancel', this.handlePointerUp);
        this.enabled = false;
    }

    /** Returns the stroke data for the line currently being drawn. */
    getCurrentStroke(): Stroke | null {
        if (this.currentPoints.length === 0) {
            return null;
        }
        return {
            id: 'preview',
            points: this.currentPoints.map((point) => ({ ...point })),
        };
    }

    /** Resets the temporary points and pointer state. */
    clearPreview() {
        this.currentPoints = [];
        this.pointerId = null;
    }

    /** Handler for the start of a drawing interaction. */
    handlePointerDown(event: PointerEvent) {
        if (this.locked) {
            event.preventDefault();
            return;
        }
        // Only accept primary button (usually left-click or stylus tip).
        if (event.button !== undefined && event.button !== 0) {
            return;
        }
        event.preventDefault();
        this.pointerId = event.pointerId;
        // Pointer capture ensures move events are sent even if the pointer leaves the canvas.
        this.canvas.setPointerCapture?.(event.pointerId);
        this.currentPoints = [canvasPointFromEvent(event, this.canvas)];
        this.callbacks.onPreview?.(this.getCurrentStroke());
    }

    /** Handler for pointer movement during a drawing interaction. */
    handlePointerMove(event: PointerEvent) {
        if (this.locked) {
            event.preventDefault();
            return;
        }
        if (this.pointerId !== event.pointerId) {
            return;
        }
        event.preventDefault();
        const point = canvasPointFromEvent(event, this.canvas);

        // Complex: Input Sampling.
        // To reduce data noise and improve performance, we only keep points that are
        // at least `minPointDistance` away from the previous point.
        if (
            shouldKeepPoint(
                this.currentPoints,
                point,
                this.config.input.minPointDistance,
            )
        ) {
            this.currentPoints.push(point);
            this.callbacks.onPreview?.(this.getCurrentStroke());
        }
    }

    /** Handler for the end of a drawing interaction. */
    handlePointerUp(event: PointerEvent) {
        if (this.locked) {
            event.preventDefault();
            this.clearPreview();
            return;
        }
        if (this.pointerId !== event.pointerId) {
            return;
        }
        event.preventDefault();
        this.canvas.releasePointerCapture?.(event.pointerId);

        const points = this.currentPoints;
        this.clearPreview();

        // Complex: Stroke Commitment.
        // We only "commit" the stroke to the permanent list if it passes
        // minimum length and point-count checks. This filters out tiny accidental clicks or "taps".
        if (
            points.length >= 2 &&
            pathLength(points) >= this.config.input.minStrokeLength
        ) {
            this.callbacks.onCommit?.(points);
            return;
        }

        this.callbacks.onPreview?.(null);
    }
}
