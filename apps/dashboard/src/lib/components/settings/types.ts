/**
 * Shared types for settings page components
 */

export interface ProviderAccount {
  id: string;
  organizationId: string;
  providerId: string;
  environment: "test" | "live";
  displayName?: string | null;
  credentials: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string | number;
  lastUsedAt?: string | number | null;
}

export interface TeamMember {
  id: string;
  role: string;
  createdAt: string | number;
  user: {
    id: string;
    name?: string | null;
    email: string;
  };
}

export interface WebhookUrl {
  providerId: string;
  url: string;
}

export interface OverageSettings {
  billingInterval: string;
  thresholdAmount: number | null;
  autoCollect: boolean;
  gracePeriodHours: number;
}
