export interface HoldControllerOptions {
  intervalMs?: number;
  step?: number;
  onStep: (direction: 1 | -1) => void;
}

export function createHoldController({ intervalMs = 80, onStep }: HoldControllerOptions) {
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;

  const stop = () => {
    if (timer !== null) {
      globalThis.clearInterval(timer);
      timer = null;
    }
  };

  const start = (direction: 1 | -1) => {
    if (timer !== null) {
      globalThis.clearInterval(timer);
    }
    onStep(direction);
    timer = globalThis.setInterval(() => {
      onStep(direction);
    }, intervalMs);
  };

  return { start, stop };
}
