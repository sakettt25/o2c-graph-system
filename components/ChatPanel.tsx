'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChatMessage } from '@/lib/types';
import {
  createConversationSession,
  loadConversation,
  saveConversation,
  getActiveConversationId,
  setActiveConversationId,
  ConversationSession,
} from '@/lib/conversation-memory';

interface Props {
  history: ChatMessage[];
  onNewMessage: (msg: ChatMessage) => void;
  onHighlight: (nodeIds: string[]) => void;
}

const SUGGESTED_QUERIES = [
  'Which products have the most billing documents?',
  'Trace the full flow of billing document 91150187',
  'Show sales orders delivered but not billed',
  'Top 5 customers by total order value',
  'List orders with incomplete O2C flows',
  'Which deliveries have no billing document?',
];

function SQLBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 relative group">
      <div className="sql-block">{sql}</div>
      <button
        onClick={() => { navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? '✓ copied' : 'copy'}
      </button>
    </div>
  );
}

function DataTable({ rows }: { rows: Record<string, string | null>[] }) {
  if (!rows.length) return <p className="text-xs text-slate-600 mt-1 italic">No rows returned.</p>;
  const cols = Object.keys(rows[0]).slice(0, 6);
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-white/[0.06]">
      <table className="data-table">
        <thead>
          <tr>{cols.map(c => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 15).map((r, i) => (
            <tr key={i}>
              {cols.map(c => <td key={c} title={r[c] ?? ''}>{r[c] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 15 && (
        <div className="px-2 py-1.5 text-[10px] text-slate-600 text-center border-t border-white/[0.04]">
          +{rows.length - 15} more rows
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg, onHighlight }: { msg: ChatMessage; onHighlight: (ids: string[]) => void }) {
  const isUser = msg.role === 'user';
  const [showSQL, setShowSQL] = useState(false);
  const [showTable, setShowTable] = useState(false);

  return (
    <div className={`chat-message flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2 shadow-lg shadow-blue-500/20">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="2" strokeWidth={2}/>
            <circle cx="5" cy="19" r="2" strokeWidth={2}/>
            <circle cx="19" cy="19" r="2" strokeWidth={2}/>
            <path d="M12 7v3M5 17l5-4M19 17l-5-4" strokeWidth={2} strokeLinecap="round"/>
          </svg>
        </div>
      )}

      <div className={`max-w-[88%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div
          className={`rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
            isUser
              ? 'bg-blue-600 text-white rounded-br-sm'
              : msg.content.startsWith('⚠') || msg.content.includes('designed to answer')
              ? 'bg-amber-500/10 border border-amber-500/20 text-amber-200 rounded-bl-sm'
              : 'bg-[#141a2e] border border-white/[0.06] text-slate-200 rounded-bl-sm'
          }`}
        >
          <span className={msg.isStreaming ? 'cursor-blink' : ''}>{msg.content}</span>
        </div>

        {/* Metadata row */}
        {!isUser && !msg.isStreaming && (msg.sql || msg.rows?.length) && (
          <div className="flex gap-1.5 ml-0.5">
            {msg.sql && (
              <button
                onClick={() => setShowSQL(v => !v)}
                className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
              >
                {showSQL ? '↑ SQL' : '⌗ SQL'}
              </button>
            )}
            {msg.rows && msg.rows.length > 0 && (
              <button
                onClick={() => setShowTable(v => !v)}
                className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
              >
                {showTable ? '↑ Data' : `⊞ ${msg.rows.length} rows`}
              </button>
            )}
            {msg.highlightedNodes && msg.highlightedNodes.length > 0 && (
              <button
                onClick={() => onHighlight(msg.highlightedNodes!)}
                className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors"
              >
                ◎ Highlight {msg.highlightedNodes.length}
              </button>
            )}
          </div>
        )}

        {showSQL && msg.sql && <SQLBlock sql={msg.sql} />}
        {showTable && msg.rows && <DataTable rows={msg.rows} />}
      </div>
    </div>
  );
}

export default function ChatPanel({ history, onNewMessage, onHighlight }: Props) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [localHistory, setLocalHistory] = useState<ChatMessage[]>([]);
  const [currentConversation, setCurrentConversation] = useState<ConversationSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Initialize conversation from localStorage on mount
  useEffect(() => {
    try {
      const activeConvId = getActiveConversationId();
      if (activeConvId) {
        const loaded = loadConversation(activeConvId);
        if (loaded) {
          setCurrentConversation(loaded);
          setLocalHistory(loaded.messages);
          return;
        }
      }
      // Create new conversation if none exists
      const newConv = createConversationSession([]);
      setCurrentConversation(newConv);
      setActiveConversationId(newConv.id);
    } catch (err) {
      console.warn('Failed to load conversation from storage:', err);
      const newConv = createConversationSession([]);
      setCurrentConversation(newConv);
    }
  }, []);

  // Persist conversation when history changes
  useEffect(() => {
    if (!currentConversation) return;
    try {
      const updated = {
        ...currentConversation,
        messages: localHistory,
        updatedAt: Date.now(),
        title: localHistory.length > 0 ? currentConversation.title : 'New Conversation',
      };
      saveConversation(updated);
    } catch (err) {
      console.warn('Failed to save conversation:', err);
    }
  }, [localHistory, currentConversation]);

  const allMessages = [...localHistory];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages.length, allMessages[allMessages.length - 1]?.content]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    const streamingMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    };

    setLocalHistory(prev => [...prev, userMsg, streamingMsg]);
    setInput('');
    setIsLoading(true);

    // Build conversation context (last 6 messages)
    const contextHistory = localHistory.slice(-6).map(m => ({
      role: m.role,
      content: m.content,
    }));

    try {
      abortRef.current = new AbortController();

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim(), history: contextHistory }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      // Check if it's a JSON response (guardrail/error)
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        const finalMsg: ChatMessage = {
          ...streamingMsg,
          content: data.answer ?? data.error ?? 'An error occurred.',
          isStreaming: false,
        };
        setLocalHistory(prev => prev.map(m => m.id === streamingMsg.id ? finalMsg : m));
        onNewMessage(finalMsg);
        return;
      }

      // Streaming response
      const sql = res.headers.get('X-SQL') ? decodeURIComponent(res.headers.get('X-SQL')!) : undefined;
      const highlightedNodes = res.headers.get('X-Highlighted-Nodes')
        ? JSON.parse(decodeURIComponent(res.headers.get('X-Highlighted-Nodes')!)) as string[]
        : [];
      const rowsPreview = res.headers.get('X-Rows-Preview')
        ? JSON.parse(decodeURIComponent(res.headers.get('X-Rows-Preview')!)) as Record<string, string | null>[]
        : [];

      // Highlight immediately
      if (highlightedNodes.length > 0) {
        onHighlight(highlightedNodes);
      }

      // Stream text
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value);
        setLocalHistory(prev =>
          prev.map(m => m.id === streamingMsg.id ? { ...m, content: fullText } : m)
        );
      }

      const finalMsg: ChatMessage = {
        ...streamingMsg,
        content: fullText,
        sql,
        rows: rowsPreview,
        highlightedNodes,
        isStreaming: false,
      };

      setLocalHistory(prev => prev.map(m => m.id === streamingMsg.id ? finalMsg : m));
      onNewMessage(finalMsg);

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errMsg: ChatMessage = {
        ...streamingMsg,
        content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
        isStreaming: false,
      };
      setLocalHistory(prev => prev.map(m => m.id === streamingMsg.id ? errMsg : m));
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, localHistory, onHighlight, onNewMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }, [input, sendMessage]);

  const handleClearHistory = useCallback(() => {
    if (confirm('Clear conversation history? This cannot be undone.')) {
      setLocalHistory([]);
      const newConv = createConversationSession([]);
      setCurrentConversation(newConv);
      setActiveConversationId(newConv.id);
    }
  }, []);

  return (
    <div className="h-full flex flex-col glass-panel border-l">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Chat with Graph</h2>
          <p className="text-[11px] text-slate-500">Order to Cash · AI Analyst</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearHistory}
            title="Clear conversation history"
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <div className="flex items-center gap-1.5">
            <span className="pulse-dot w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            <span className="text-[11px] text-emerald-400">Dodge AI</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Welcome message */}
        {allMessages.length === 0 && (
          <div className="space-y-4">
            <div className="chat-message flex justify-start">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="2" strokeWidth={2}/>
                  <circle cx="5" cy="19" r="2" strokeWidth={2}/>
                  <circle cx="19" cy="19" r="2" strokeWidth={2}/>
                  <path d="M12 7v3M5 17l5-4M19 17l-5-4" strokeWidth={2} strokeLinecap="round"/>
                </svg>
              </div>
              <div className="bg-[#141a2e] border border-white/[0.06] rounded-xl rounded-bl-sm px-3 py-2.5 text-xs text-slate-200 leading-relaxed max-w-[88%]">
                Hi! I can help you analyze the <strong className="text-blue-300">Order to Cash</strong> process. Ask me about sales orders, billing documents, deliveries, payments, customers, or products in the dataset.
              </div>
            </div>

            {/* Suggested queries */}
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-600 uppercase tracking-widest px-1">Try asking</p>
              {SUGGESTED_QUERIES.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="w-full text-left text-[11px] px-3 py-2 rounded-lg border border-white/[0.06] text-slate-400 hover:text-slate-200 hover:bg-blue-500/5 hover:border-blue-500/20 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {allMessages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} onHighlight={onHighlight} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 p-3 border-t border-white/[0.06]">
        <div className="relative flex items-end gap-2 bg-[#141a2e] border border-white/[0.08] rounded-xl overflow-hidden focus-within:border-blue-500/40 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about orders, billing, deliveries..."
            rows={1}
            style={{ resize: 'none', minHeight: '40px', maxHeight: '100px' }}
            className="flex-1 bg-transparent text-xs text-slate-200 placeholder-slate-600 px-3 py-2.5 outline-none"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="mr-2 mb-1.5 w-7 h-7 btn-glow rounded-lg flex items-center justify-center flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none transition-all"
          >
            {isLoading ? (
              <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-[9px] text-slate-700 mt-1.5 text-center">
          Powered by Dodge AI · Grounded in SAP O2C dataset
        </p>
      </div>
    </div>
  );
}
