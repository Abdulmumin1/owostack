import type { EventStore, EventStoreConfig } from "./types";
import { AnalyticsEngineStore } from "./backends/analytics-engine";
import { PipelineStore } from "./backends/pipeline";

export function createEventStore(config: EventStoreConfig): EventStore {
  switch (config.backend) {
    case "pipeline":
      return new PipelineStore(config);
    case "analytics-engine":
    default:
      return new AnalyticsEngineStore(config);
  }
}
