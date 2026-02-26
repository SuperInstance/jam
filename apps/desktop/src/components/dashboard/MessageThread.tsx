import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';

interface MessageThreadProps {
  messages: Array<{
    id: string;
    senderId: string;
    content: string;
    timestamp: string;
  }>;
  agents: Record<string, { name: string; color: string }>;
  onSend: (content: string) => void;
  isLoading: boolean;
}

const plugins = { code };

export const MessageThread = React.memo(function MessageThread({ messages, agents, onSend, isLoading }: MessageThreadProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const prevMsgCount = useRef(messages.length);

  // Scroll to bottom — instant on mount/channel switch, smooth on new messages
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'instant') => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  // Instant scroll on mount or when message list resets (channel switch)
  useEffect(() => {
    scrollToBottom('instant');
    prevMsgCount.current = messages.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smooth scroll only when new messages arrive (and user is at bottom)
  useEffect(() => {
    if (messages.length > prevMsgCount.current && atBottom) {
      scrollToBottom('instant');
    }
    prevMsgCount.current = messages.length;
  }, [messages.length, atBottom, scrollToBottom]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput('');
    setAtBottom(true);
    // Scroll after send — slight delay for DOM update
    requestAnimationFrame(() => scrollToBottom('instant'));
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 relative">
      {/* Message list */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.map((msg) => {
          const sender = agents[msg.senderId];
          return (
            <div key={msg.id} className="flex gap-3">
              {/* Avatar */}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
                style={{ backgroundColor: sender?.color ?? '#6b7280' }}
              >
                {(sender?.name ?? '?').charAt(0).toUpperCase()}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-sm font-semibold"
                    style={{ color: sender?.color ?? '#9ca3af' }}
                  >
                    {sender?.name ?? 'Unknown'}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="prose prose-invert prose-sm max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 mt-0.5">
                  <Streamdown mode="static" plugins={plugins}>
                    {msg.content}
                  </Streamdown>
                </div>
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce" />
              <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.15s]" />
              <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.3s]" />
            </div>
            <span>Typing...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      {!atBottom && (
        <button
          onClick={() => {
            scrollToBottom('instant');
            setAtBottom(true);
          }}
          className="absolute bottom-20 right-6 w-8 h-8 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center text-zinc-300 hover:bg-zinc-600 hover:text-white transition-colors shadow-lg"
          title="Scroll to bottom"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-zinc-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message..."
            className="flex-1 bg-zinc-800 text-sm text-white rounded-lg px-3 py-2 border border-zinc-700 focus:border-zinc-500 focus:outline-none placeholder-zinc-500"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
});
