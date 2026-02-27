export class DurableObject<TEnv = unknown> {
  protected ctx: any;
  protected env: TEnv;

  constructor(ctx: any, env: TEnv) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkflowEvent<TPayload = unknown> {
  constructor(public payload: TPayload) {}
}

export class WorkflowStep {
  async do<T>(_name: string, fn: () => Promise<T> | T): Promise<T> {
    return await fn();
  }

  async sleep(_name: string, _ms: number): Promise<void> {}
}

export class WorkflowEntrypoint<TEnv = unknown, TPayload = unknown> {
  protected env!: TEnv;

  constructor(env?: TEnv) {
    if (env !== undefined) {
      this.env = env;
    }
  }

  // Placeholder base signature for compatibility with subclasses in tests.
  async run(_event: WorkflowEvent<TPayload>, _step: WorkflowStep): Promise<unknown> {
    return undefined;
  }
}
