/**
 * requestAnimationFrame transport loop.
 *
 * Keeps the playhead advancing in real time without the renderer caring where
 * the frame boundary is. Elapsed wall-clock time is accumulated into a float
 * "frame cursor" so the playhead lands on whole frames and no drift builds up
 * between ticks.
 */

export interface LoopCallbacks {
  /** Called with the fractional frame cursor each animation frame. */
  onTick: (frame: number) => void;
}

export class FrameLoop {
  private rafId: number | null = null;
  private lastTime = 0;
  private cursor = 0;
  private running = false;

  constructor(
    private readonly fps: number,
    private readonly callbacks: LoopCallbacks,
  ) {}

  start(fromFrame: number): void {
    this.stop();
    this.cursor = fromFrame;
    this.lastTime = performance.now();
    this.running = true;
    this.rafId = requestAnimationFrame(this.step);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private step = (now: number): void => {
    if (!this.running) return;

    // Clamp the delta so a backgrounded tab does not jump the playhead
    // forward by however long it was hidden.
    const elapsed = Math.min(now - this.lastTime, 250);
    this.lastTime = now;
    this.cursor += (elapsed / 1000) * this.fps;

    this.callbacks.onTick(this.cursor);
    this.rafId = requestAnimationFrame(this.step);
  };
}

/**
 * Seek a media element to a frame-accurate time.
 *
 * Video seeking is only reliable once the browser has enough buffered data,
 * so callers should pass `fastSeek` false for frame accuracy.
 */
export const seekVideo = (el: HTMLVideoElement, seconds: number): void => {
  if (Number.isFinite(seconds)) el.currentTime = Math.max(0, seconds);
};
