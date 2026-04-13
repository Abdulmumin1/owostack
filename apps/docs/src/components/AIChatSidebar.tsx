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

type Chunk = {
  id?: string;
  item?: {
    key?: string;
    metadata?: {
      title?: string;
      description?: string;
    };
  };
};

type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  chunks?: Chunk[];
};

export function AIChatSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [width, setWidth] = useState(450);
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

    const userMessage: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(
        "https://8aa5c4ad-00c7-4c2c-96b2-ac41d8cd941d.search.ai.cloudflare.com/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: messages
              .map((m) => ({ role: m.role, content: m.content }))
              .concat({ role: "user", content: userMessage.content }),
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to fetch response");
      }

      const data = await response.json();
      const assistantMessage = data.choices[0].message;
      const chunks = data.chunks || [];

      setMessages((prev) => [...prev, { ...assistantMessage, chunks }]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again later.",
        },
      ]);
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
        <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--color-fd-border)]">
          <div>
            <h2 className="text-lg font-medium text-[var(--color-fd-foreground)]">
              AI Chat
            </h2>
            <p className="text-sm text-[var(--color-fd-muted-foreground)]">
              Owostack docs assistant
            </p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 text-[var(--color-fd-muted-foreground)] hover:text-[var(--color-fd-foreground)] rounded-md transition-colors"
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
            messages.map((msg, index) => (
              <div
                key={index}
                className={`flex flex-col gap-1 ${
                  msg.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <span className="text-xs font-medium text-[var(--color-fd-muted-foreground)] px-1">
                  {msg.role === "user" ? "You" : "Owostack AI"}
                </span>
                <div
                  className={`px-4 py-3 max-w-[90%] text-sm rounded-lg ${
                    msg.role === "user"
                      ? "bg-[var(--color-fd-primary)] text-[var(--color-fd-primary-foreground)]"
                      : "bg-[var(--color-fd-muted)] text-[var(--color-fd-foreground)] border border-[var(--color-fd-border)] prose prose-sm dark:prose-invert prose-p:leading-relaxed prose-pre:bg-[var(--color-fd-background)] prose-pre:border prose-pre:border-[var(--color-fd-border)]"
                  }`}
                >
                  {msg.role === "user" ? (
                    msg.content
                  ) : (
                    <div className="overflow-hidden">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ node, ...props }) => (
                            <a
                              {...props}
                              className="text-[var(--color-fd-primary)] hover:underline"
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          ),
                          code: ({ node, className, children, ...props }) => {
                            const isInline = !className;
                            return isInline ? (
                              <code
                                {...props}
                                className="bg-[var(--color-fd-background)] px-1 py-0.5 rounded border border-[var(--color-fd-border)] text-[0.85em]"
                              >
                                {children}
                              </code>
                            ) : (
                              <code {...props} className={className}>
                                {children}
                              </code>
                            );
                          },
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>

                      {msg.chunks && msg.chunks.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-[var(--color-fd-border)] flex flex-col gap-2">
                          <span className="text-xs font-semibold text-[var(--color-fd-muted-foreground)] uppercase tracking-wider">
                            Sources
                          </span>
                          <div className="flex flex-col gap-2">
                            {msg.chunks.map((chunk, i) =>
                              chunk.item?.key ? (
                                <a
                                  key={i}
                                  href={chunk.item.key}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex flex-col gap-0.5 p-2 rounded bg-[var(--color-fd-background)] border border-[var(--color-fd-border)] hover:border-[var(--color-fd-primary)] transition-colors group"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-xs truncate group-hover:text-[var(--color-fd-primary)] transition-colors">
                                      {chunk.item.metadata?.title ||
                                        "Reference"}
                                    </span>
                                    <ExternalLink className="w-3 h-3 text-[var(--color-fd-muted-foreground)] shrink-0" />
                                  </div>
                                  {chunk.item.metadata?.description && (
                                    <span className="text-[10px] text-[var(--color-fd-muted-foreground)] line-clamp-1">
                                      {chunk.item.metadata.description}
                                    </span>
                                  )}
                                </a>
                              ) : null,
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex flex-col items-start gap-1">
              <span className="text-xs font-medium text-[var(--color-fd-muted-foreground)] px-1">
                Owostack AI
              </span>
              <div className="px-4 py-3 rounded-lg max-w-[85%] text-sm bg-[var(--color-fd-muted)] text-[var(--color-fd-foreground)] border border-[var(--color-fd-border)] flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-fd-muted-foreground)] animate-bounce" />
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-fd-muted-foreground)] animate-bounce [animation-delay:-0.15s]" />
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-fd-muted-foreground)] animate-bounce [animation-delay:-0.3s]" />
              </div>
            </div>
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
        </div>
      </div>
    </>
  );
}
