import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageCircle,
  X,
  Send,
  MessageSquare,
  ExternalLink,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

type RepoSource = {
  title: string;
  path: string;
};

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  id: string;
  sources?: RepoSource[];
  streaming?: boolean;
};

type StreamHandlers = {
  onStatus?: (payload: { stage?: string }) => void;
  onDelta?: (payload: { text?: string }) => void;
  onSources?: (payload: { sources?: unknown }) => void;
  onDone?: (payload: unknown) => void;
};

const markdownComponents: Components = {
  a: ({ node, ...props }) => (
    <a
      {...props}
      className="text-[var(--color-fd-primary)] hover:underline"
      target="_blank"
      rel="noopener noreferrer"
    />
  ),
  pre: ({ node, children, ...props }) => {
    const child = React.Children.toArray(children)[0];

    if (React.isValidElement(child)) {
      const codeElement = child as React.ReactElement<{
        className?: string;
        children?: React.ReactNode;
      }>;
      const className =
        typeof codeElement.props.className === "string"
          ? codeElement.props.className
          : "";
      const code = extractCodeText(codeElement.props.children);
      const language = getCodeLanguage(className) ?? inferCodeLanguage(code);

      return <HighlightedCodeBlock code={code} language={language} />;
    }

    return (
      <pre
        {...props}
        className="overflow-x-auto rounded-xl border border-[var(--color-fd-border)] bg-[var(--color-fd-background)] px-4 py-3 text-[0.85em] leading-6"
      >
        {children}
      </pre>
    );
  },
  code: ({ node, children, ...props }) => (
    <code
      {...props}
      className="rounded border border-[var(--color-fd-border)] bg-[var(--color-fd-background)] px-1 py-0.5 text-[0.85em]"
    >
      {children}
    </code>
  ),
};

export function AIChatSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [width, setWidth] = useState(450);
  const [statusMessage, setStatusMessage] = useState("Ask a docs question.");
  const isDragging = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  };

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!isDragging.current) return;
    const newWidth = document.body.clientWidth - e.clientX;
    setWidth(Math.max(300, Math.min(newWidth, 800)));
  }, []);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    document.body.style.cursor = "";
  }, []);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    }
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isOpen, handlePointerMove, handlePointerUp]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: createMessageId(),
      role: "user",
      content: input.trim(),
    };
    const assistantMessageId = createMessageId();

    setInput("");
    setIsLoading(true);
    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        sources: [],
        streaming: true,
      },
    ]);

    try {
      let didReceiveDone = false;

      await streamSseResponse(
        "/api/assistant/stream",
        { question: userMessage.content },
        {
          onStatus: ({ stage }) => {
            setStatusMessage(formatStage(stage));
          },
          onDelta: ({ text }) => {
            if (!text) {
              return;
            }

            setMessages(
              updateMessage(assistantMessageId, (message) => ({
                ...message,
                content: message.content + text,
                streaming: true,
              })),
            );
          },
          onSources: ({ sources }) => {
            setMessages(
              updateMessage(assistantMessageId, (message) => ({
                ...message,
                sources: normalizeSources(sources),
              })),
            );
          },
          onDone: (payload) => {
            didReceiveDone = true;
            const answer = normalizeRepoAnswer(payload);

            setMessages(
              updateMessage(assistantMessageId, (message) => ({
                ...message,
                content: answer.answer || message.content,
                sources:
                  answer.sources.length > 0 ? answer.sources : message.sources,
                streaming: false,
              })),
            );

            setStatusMessage("Answer received.");
          },
        },
      );

      if (!didReceiveDone) {
        throw new Error(
          "The stream ended before the assistant returned a final answer.",
        );
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages(
        updateMessage(assistantMessageId, (message) => ({
          ...message,
          content:
            message.content ||
            `Sorry, I encountered an error. ${errorMessage(error)}`,
          streaming: false,
        })),
      );
      setStatusMessage("Request failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Trigger Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 p-3 bg-[var(--color-fd-primary)] text-[var(--color-fd-primary-foreground)] rounded-full shadow-lg hover:scale-105 transition-transform z-50 flex items-center justify-center"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}

      {/* Sidebar Overlay (Mobile) */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        style={{
          width:
            isOpen && typeof window !== "undefined" && window.innerWidth > 768
              ? width
              : undefined,
        }}
        className={`fixed top-0 right-0 h-full w-full md:w-auto bg-[var(--color-fd-background)] border-l border-[var(--color-fd-border)] shadow-2xl z-50 transform transition-transform duration-300 flex flex-col ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Resize Handle */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--color-fd-primary)]/50 active:bg-[var(--color-fd-primary)] transition-colors z-10 hidden md:block"
          onPointerDown={handlePointerDown}
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-[var(--color-fd-border)]">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="text-lg font-medium leading-none text-[var(--color-fd-foreground)]">
              Ask about owostack
            </h2>
            <div className="flex items-center gap-2 text-sm text-[var(--color-fd-muted-foreground)]">
              <span
                className={`h-2 w-2 rounded-full ${
                  isLoading ? "bg-amber-400 animate-pulse" : "bg-emerald-400"
                }`}
              />
              <span className="truncate">{summarizeStatus(statusMessage)}</span>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="mt-0.5 p-2 text-[var(--color-fd-muted-foreground)] hover:text-[var(--color-fd-foreground)] rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-[var(--color-fd-muted-foreground)] space-y-3">
              <MessageSquare className="w-6 h-6 fill-current text-[var(--color-fd-muted-foreground)]" />
              <p className="text-sm">Start a new chat below.</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col gap-1 ${
                  msg.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <span className="text-xs font-medium text-[var(--color-fd-muted-foreground)] px-1">
                  {msg.role === "user" ? "You" : ""}
                </span>
                <div
                  className={`text-sm ${
                    msg.role === "user"
                      ? "max-w-[90%] rounded-lg bg-[var(--color-fd-primary)] px-4 py-3 text-[var(--color-fd-primary-foreground)]"
                      : "w-full max-w-full text-[var(--color-fd-foreground)] prose prose-sm dark:prose-invert prose-p:leading-relaxed prose-pre:bg-[var(--color-fd-background)] prose-pre:border prose-pre:border-[var(--color-fd-border)] prose-code:before:content-none prose-code:after:content-none [&_.chat-code-block_pre]:m-0 [&_.chat-code-block_pre]:overflow-x-auto [&_.chat-code-block_pre]:bg-transparent [&_.chat-code-block_pre]:p-3 [&_.chat-code-block_pre]:text-[0.85em] [&_.chat-code-block_pre]:leading-6 [&_.chat-code-block_code]:border-0 [&_.chat-code-block_code]:bg-transparent [&_.chat-code-block_code]:p-0 [&_.chat-code-block_code]:text-inherit [&_.chat-code-block_code]:rounded-none"
                  }`}
                >
                  {msg.role === "user" ? (
                    msg.content
                  ) : msg.streaming && !msg.content ? (
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-fd-muted-foreground)] animate-bounce" />
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-fd-muted-foreground)] animate-bounce [animation-delay:-0.15s]" />
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-fd-muted-foreground)] animate-bounce [animation-delay:-0.3s]" />
                    </div>
                  ) : (
                    <div className="overflow-hidden">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {msg.content}
                      </ReactMarkdown>

                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-[var(--color-fd-border)] flex flex-col gap-2">
                          <span className="text-xs font-semibold text-[var(--color-fd-muted-foreground)] uppercase tracking-wider">
                            Sources
                          </span>
                          <div className="flex flex-col gap-2">
                            {msg.sources.map((source, i) => {
                              const href = getSourceHref(source.path);
                              const content = (
                                <>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-xs truncate group-hover:text-[var(--color-fd-primary)] transition-colors">
                                      {source.title || "Reference"}
                                    </span>
                                    {href ? (
                                      <ExternalLink className="w-3 h-3 text-[var(--color-fd-muted-foreground)] shrink-0" />
                                    ) : null}
                                  </div>
                                  <span className="text-[10px] text-[var(--color-fd-muted-foreground)] line-clamp-1">
                                    {source.path}
                                  </span>
                                </>
                              );

                              return href ? (
                                <a
                                  key={`${msg.id}-${source.path}-${i}`}
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex flex-col gap-0.5 p-2 rounded bg-[var(--color-fd-background)] border border-[var(--color-fd-border)] hover:border-[var(--color-fd-primary)] transition-colors group"
                                >
                                  {content}
                                </a>
                              ) : (
                                <div
                                  key={`${msg.id}-${source.path}-${i}`}
                                  className="flex flex-col gap-0.5 p-2 rounded bg-[var(--color-fd-background)] border border-[var(--color-fd-border)]"
                                >
                                  {content}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Form */}
        <div className="p-4 border-t border-[var(--color-fd-border)] bg-[var(--color-fd-background)]">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-2 relative bg-[var(--color-fd-background)] border border-[var(--color-fd-border)] rounded-xl focus-within:ring-1 focus-within:ring-[var(--color-fd-ring)] transition-all overflow-hidden"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Ask a question"
              className="w-full min-h-[50px] max-h-[200px] bg-transparent border-none outline-none resize-none px-4 py-3 text-sm text-[var(--color-fd-foreground)] placeholder:text-[var(--color-fd-muted-foreground)]"
              disabled={isLoading}
              rows={1}
            />
            <div className="flex justify-between items-center px-2 pb-2">
              <div />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="p-1.5 rounded-md text-[var(--color-fd-muted-foreground)] hover:text-[var(--color-fd-foreground)] hover:bg-[var(--color-fd-muted)] disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
          <div className="mt-2 px-1 text-xs text-[var(--color-fd-muted-foreground)]">
            Powered by{" "}
            <a
              href="https://github.com/Abdulmumin1/cull"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-fd-foreground)] hover:text-[var(--color-fd-primary)] hover:underline"
            >
              Cull
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

function createMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
}

function HighlightedCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function highlight() {
      try {
        const { codeToHtml } = await import("shiki");
        const highlighted = await codeToHtml(code, {
          lang: language,
          theme: "github-dark",
        });

        if (!cancelled) {
          setHtml(highlighted);
        }
      } catch {
        if (!cancelled) {
          setHtml(null);
        }
      }
    }

    void highlight();

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  if (!html) {
    return (
      <pre className="overflow-x-auto rounded-xl border border-[var(--color-fd-border)] bg-[#0d1117] px-3 py-2.5 text-[0.85em] leading-6">
        <code className="font-mono whitespace-pre">{code}</code>
      </pre>
    );
  }

  return (
    <div
      className="chat-code-block overflow-hidden rounded-xl border border-[var(--color-fd-border)] bg-[#0d1117]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function updateMessage(
  messageId: string,
  update: (message: Message) => Message,
) {
  return (messages: Message[]) =>
    messages.map((message) =>
      message.id === messageId ? update(message) : message,
    );
}

async function streamSseResponse(
  url: string,
  body: unknown,
  handlers: StreamHandlers,
) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await readErrorResponse(response);
  }

  if (!response.body) {
    throw new Error("Streaming response body missing.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundary = findSseBoundary(buffer);
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + (buffer[boundary] === "\r" ? 4 : 2));
      dispatchSseEvent(chunk, handlers);
      boundary = findSseBoundary(buffer);
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    dispatchSseEvent(buffer, handlers);
  }
}

function findSseBoundary(buffer: string) {
  const unixBoundary = buffer.indexOf("\n\n");
  const windowsBoundary = buffer.indexOf("\r\n\r\n");

  if (unixBoundary === -1) {
    return windowsBoundary;
  }

  if (windowsBoundary === -1) {
    return unixBoundary;
  }

  return Math.min(unixBoundary, windowsBoundary);
}

function dispatchSseEvent(chunk: string, handlers: StreamHandlers) {
  const lines = chunk.replace(/\r/g, "").split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const payload = dataLines.length
    ? (JSON.parse(dataLines.join("\n")) as unknown)
    : undefined;

  switch (event) {
    case "status":
      handlers.onStatus?.(payload as { stage?: string });
      return;
    case "delta":
      handlers.onDelta?.(payload as { text?: string });
      return;
    case "sources":
      handlers.onSources?.(payload as { sources?: unknown });
      return;
    case "done":
      handlers.onDone?.(payload);
      return;
    case "error":
      throw new Error(readStreamError(payload));
    default:
      return;
  }
}

function normalizeRepoAnswer(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return {
      answer: "",
      sources: [],
    };
  }

  const answer =
    "answer" in payload && typeof payload.answer === "string"
      ? payload.answer
      : "";
  const sources = "sources" in payload ? normalizeSources(payload.sources) : [];

  return { answer, sources };
}

function normalizeSources(value: unknown): RepoSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const title =
      "title" in item && typeof item.title === "string" ? item.title : "source";
    const path =
      "path" in item && typeof item.path === "string" ? item.path : "";

    return path ? [{ title, path }] : [];
  });
}

function formatStage(stage?: string) {
  switch (stage) {
    case "checking-repo":
      return "Checking docs state.";
    case "syncing":
      return "Docs agent is syncing in the background.";
    case "answering":
      return "Generating answer.";
    case "retrying-model":
      return "Retrying after a transient upstream failure.";
    default:
      return stage ? `Working: ${stage}` : "Working.";
  }
}

function summarizeStatus(status: string) {
  if (status === "Answer received.") {
    return "Answered";
  }

  if (status === "Request failed.") {
    return "Error";
  }

  if (status === "Ask a docs question.") {
    return "Ready";
  }

  if (
    status === "Generating answer." ||
    status.startsWith("Working:") ||
    status.includes("syncing")
  ) {
    return "Answering";
  }

  return status;
}

function getSourceHref(path: string) {
  if (/^https?:\/\//.test(path) || path.startsWith("/")) {
    return path;
  }

  return null;
}

async function readErrorResponse(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    if (typeof payload?.error === "string") {
      return new Error(payload.error);
    }
  } catch {}

  return new Error(`Request failed with ${response.status}`);
}

function readStreamError(payload: unknown) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return "The stream failed.";
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

function extractCodeText(value: React.ReactNode): string {
  if (typeof value === "string") {
    return value.replace(/\n$/, "");
  }

  if (Array.isArray(value)) {
    return value.map(extractCodeText).join("").replace(/\n$/, "");
  }

  if (React.isValidElement(value)) {
    const element = value as React.ReactElement<{ children?: React.ReactNode }>;
    return extractCodeText(element.props.children);
  }

  return "";
}

function getCodeLanguage(className: string) {
  const match = /language-([\w-]+)/.exec(className);
  return match?.[1] ?? null;
}

function inferCodeLanguage(code: string) {
  if (
    code.includes('from "owostack"') ||
    code.includes("const ") ||
    code.includes("import ")
  ) {
    return "typescript";
  }

  if (code.includes("<") && code.includes("/")) {
    return "html";
  }

  if (code.includes("{") || code.includes("[")) {
    return "javascript";
  }

  return "text";
}
