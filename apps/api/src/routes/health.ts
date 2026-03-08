import { Hono } from "hono";
import type { Env, Variables } from "../index";

export function createHealthRoute() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  app.get("/", (c) => c.json({ status: "healthy" }));

  return app;
}

export default createHealthRoute();
