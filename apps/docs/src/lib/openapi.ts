import spec from "../../openapi.json" with { type: "json" };
import { createOpenApiServer } from "./openapi-server";

export const openapi = createOpenApiServer(spec as Record<string, unknown>);
