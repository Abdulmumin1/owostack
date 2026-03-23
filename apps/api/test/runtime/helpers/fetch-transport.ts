export interface CapturedFetchRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  bodyText: string;
  json<T = unknown>(): T;
  form(): URLSearchParams;
}

export interface ExpectedFetchCall {
  name?: string;
  method: string;
  origin?: string;
  path: string | RegExp;
  assert?: (request: CapturedFetchRequest) => void | Promise<void>;
  respond:
    | Response
    | ((request: CapturedFetchRequest) => Response | Promise<Response>);
}

function normalizeHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    Array.from(headers.entries()).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
}

function matchesPath(pathname: string, expected: string | RegExp): boolean {
  return typeof expected === "string"
    ? pathname === expected
    : expected.test(pathname);
}

export class SequencedFetchTransport {
  private callIndex = 0;
  readonly requests: CapturedFetchRequest[] = [];

  constructor(private readonly expectedCalls: ExpectedFetchCall[]) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const bodyText = await request.clone().text();
    const captured: CapturedFetchRequest = {
      method: request.method.toUpperCase(),
      url,
      headers: normalizeHeaders(request.headers),
      bodyText,
      json<T = unknown>() {
        return JSON.parse(bodyText || "{}") as T;
      },
      form() {
        return new URLSearchParams(bodyText);
      },
    };

    const expected = this.expectedCalls[this.callIndex];
    if (!expected) {
      throw new Error(`Unexpected fetch call: ${captured.method} ${url}`);
    }

    const expectedMethod = expected.method.toUpperCase();
    if (captured.method !== expectedMethod) {
      throw new Error(
        `Expected ${expectedMethod} for ${expected.name || expected.path}, got ${captured.method}`,
      );
    }

    if (expected.origin && url.origin !== expected.origin) {
      throw new Error(
        `Expected origin ${expected.origin} for ${expected.name || expected.path}, got ${url.origin}`,
      );
    }

    if (!matchesPath(url.pathname, expected.path)) {
      throw new Error(
        `Expected path ${String(expected.path)} for ${expected.name || expected.path}, got ${url.pathname}`,
      );
    }

    this.requests.push(captured);
    this.callIndex += 1;
    await expected.assert?.(captured);

    return typeof expected.respond === "function"
      ? await expected.respond(captured)
      : expected.respond;
  }

  assertComplete(): void {
    if (this.callIndex !== this.expectedCalls.length) {
      throw new Error(
        `Expected ${this.expectedCalls.length} fetch calls, received ${this.callIndex}`,
      );
    }
  }
}

export async function withFetchTransport<T>(
  transport: SequencedFetchTransport,
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = transport.fetch.bind(transport) as typeof fetch;

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export function jsonResponse(
  body: unknown,
  init: ResponseInit = { status: 200 },
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}
