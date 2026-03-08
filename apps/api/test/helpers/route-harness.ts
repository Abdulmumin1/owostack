import { Hono } from "hono";

export function createRouteTestApp<TVariables extends Record<string, unknown>>(
  route: Hono<any>,
  variables: TVariables,
) {
  const app = new Hono<{ Variables: TVariables }>();

  app.use("*", async (c, next) => {
    for (const [key, value] of Object.entries(variables)) {
      c.set(key as never, value as never);
    }
    await next();
  });

  app.route("/", route);
  return app;
}
