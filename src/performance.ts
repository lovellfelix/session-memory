export interface PerformanceStats {
  avg: number;
  min: number;
  max: number;
  count: number;
  p50: number;
  p95: number;
  p99: number;
}

export class PerformanceTracker {
  private static instance: PerformanceTracker;
  private timings: Map<string, number[]> = new Map();
  private maxSamples: number = 1000;

  private constructor() {}

  static getInstance(): PerformanceTracker {
    if (!PerformanceTracker.instance) {
      PerformanceTracker.instance = new PerformanceTracker();
    }
    return PerformanceTracker.instance;
  }

  start(operation: string): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      if (!this.timings.has(operation)) {
        this.timings.set(operation, []);
      }
      const samples = this.timings.get(operation)!;
      samples.push(duration);
      
      if (samples.length > this.maxSamples) {
        samples.shift();
      }
    };
  }

  getStats(operation: string): PerformanceStats | null {
    const durations = this.timings.get(operation);
    if (!durations || durations.length === 0) {
      return null;
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    
    return {
      avg: sum / sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      count: sorted.length,
      p50: this.percentile(sorted, 0.5),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99)
    };
  }

  getAllStats(): Map<string, PerformanceStats> {
    const stats = new Map<string, PerformanceStats>();
    for (const [operation, _] of this.timings) {
      const opStats = this.getStats(operation);
      if (opStats) {
        stats.set(operation, opStats);
      }
    }
    return stats;
  }

  reset(operation?: string): void {
    if (operation) {
      this.timings.delete(operation);
    } else {
      this.timings.clear();
    }
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }
}

export const performanceTracker = PerformanceTracker.getInstance();
