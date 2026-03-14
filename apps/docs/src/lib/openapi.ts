import spec from "../../openapi.json" with { type: "json" };
import { createProxy } from "../../../../node_modules/.pnpm/fumadocs-openapi@10.3.11_@types+react-dom@19.2.3_@types+react@19.2.11__@types+react@19.2.11_f_4vajuwwsjclupzfadwtrr3lupy/node_modules/fumadocs-openapi/dist/server/proxy.js";
import { upgrade } from "../../../../node_modules/.pnpm/@scalar+openapi-upgrader@0.1.8/node_modules/@scalar/openapi-upgrader/dist/upgrade.js";
import { resolveReferences } from "../../../../node_modules/.pnpm/@scalar+openapi-parser@0.24.10/node_modules/@scalar/openapi-parser/dist/utils/resolve-references.js";

type ProcessedDocument = {
  dereferenced: Record<string, unknown>;
  bundled: Record<string, unknown>;
  getRawRef: (obj: object) => string | undefined;
  _internal_idToSchema: () => Map<string, object>;
};

type OpenAPIServer = {
  options: {
    proxyUrl?: string;
  };
  createProxy: typeof createProxy;
  getSchema: (document: string) => Promise<ProcessedDocument>;
  getSchemas: () => Promise<Record<string, ProcessedDocument>>;
};

const DOCUMENT_ID = "./openapi.json";
let cache: Promise<Record<string, ProcessedDocument>> | undefined;

async function processDocument(): Promise<ProcessedDocument> {
  const bundled = upgrade(structuredClone(spec), "3.2") as Record<
    string,
    unknown
  >;
  const idToSchema = new Map<string, object>();
  const schemaToId = new WeakMap<object, string>();

  const { schema } = resolveReferences(bundled, {
    throwOnError: true,
    onDereference({ schema, ref }) {
      idToSchema.set(ref, schema);
      schemaToId.set(schema, ref);
    },
  });

  return {
    bundled,
    dereferenced: schema as Record<string, unknown>,
    getRawRef(obj) {
      return schemaToId.get(obj);
    },
    _internal_idToSchema() {
      return idToSchema;
    },
  };
}

export const openapi: OpenAPIServer = {
  options: {},
  createProxy,
  async getSchemas() {
    cache ??= Promise.resolve().then(async () => ({
      [DOCUMENT_ID]: await processDocument(),
    }));
    return cache;
  },
  async getSchema(document) {
    const schemas = await this.getSchemas();

    if (document in schemas) {
      return schemas[document];
    }

    throw new Error(
      `[Fumadocs OpenAPI] the document "${document}" is not listed in the input map.`,
    );
  },
};
