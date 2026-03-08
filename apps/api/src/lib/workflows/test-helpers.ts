import { vi } from "vitest";

export function createWorkflowStepMock() {
  return {
    sleep: vi.fn(async () => undefined),
    do: vi.fn(async (...args: any[]) => {
      const fn = typeof args[1] === "function" ? args[1] : args[2];
      return fn();
    }),
  };
}

export function createWorkflowInstance<T extends { prototype: object }>(
  workflow: T,
  env: Record<string, unknown>,
) {
  return Object.assign(Object.create(workflow.prototype), {
    env,
  }) as InstanceType<T>;
}
