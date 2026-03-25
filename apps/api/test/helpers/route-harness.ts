import { Hono } from "hono";

export function createRouteTestApp<TVariables extends Record<string, unknown>>(
  route: Hono<any>,
  variables: TVariables,
) {
  const app = new Hono<{ Variables: TVariables }>();
  const defaultExecutionCtx = {
    waitUntil(_promise: Promise<unknown>) {},
    passThroughOnException() {},
  };

  app.use("*", async (c, next) => {
    for (const [key, value] of Object.entries(variables)) {
      c.set(key as never, value as never);
    }
    await next();
  });

  app.route("/", route);

  const request = (
    input: string,
    init?: RequestInit,
    env?: Record<string, unknown>,
    executionCtx?: Pick<
      ExecutionContext,
      "waitUntil" | "passThroughOnException"
    >,
  ) => {
    return app.fetch(
      new Request(new URL(input, "http://localhost").toString(), init),
      env,
      (executionCtx || defaultExecutionCtx) as ExecutionContext,
    );
  };

  return Object.assign(app, { request });
}
