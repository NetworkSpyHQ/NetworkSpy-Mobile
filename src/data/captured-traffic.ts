import type { TrafficEntry } from '@/types/traffic';

let capturedTraffic: TrafficEntry[] = [];

export function addCapturedEntry(entry: TrafficEntry): void {
  capturedTraffic.unshift(entry);
  if (capturedTraffic.length > 1000) {
    capturedTraffic = capturedTraffic.slice(0, 1000);
  }
}

export function getCapturedTraffic(): TrafficEntry[] {
  return capturedTraffic;
}

export function getCapturedById(id: string): TrafficEntry | undefined {
  return capturedTraffic.find((e) => e.id === id);
}
