import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Plus, Send, Server, Bot, Trash2 } from 'lucide-react';
import {
  useChatNodes,
  useChatBots,
  useChatConversations,
  useChatMessages,
  useCreateConversation,
  useDeleteConversation,
} from '../hooks/useChat';
import { streamChat, type ChatMessage } from '../api/chat.api';

export function ChatPage() {
  const { data: nodes = [] } = useChatNodes();
  const { data: conversations = [] } = useChatConversations();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();

  const [selectedNode, setSelectedNode] = useState<string>('');
  const [selectedBot, setSelectedBot] = useState<string>('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: bots = [] } = useChatBots(selectedNode || null);
  const { data: loadedMsgs, refetch } = useChatMessages(activeId);

  useEffect(() => {
    if (loadedMsgs) setMsgs(loadedMsgs);
  }, [loadedMsgs]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs]);

  const activeConv = conversations.find((c) => c.id === activeId);

  const handleNewConversation = useCallback(async () => {
    if (!selectedNode || !selectedBot) return;
    const conv = await createConversation.mutateAsync({
      machineId: selectedNode,
      agentId: selectedBot,
    });
    setActiveId(conv.id);
    setMsgs([]);
  }, [selectedNode, selectedBot, createConversation]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !activeId || streaming) return;
    setInput('');
    setStreaming(true);

    const now = new Date().toISOString();
    const userMsg: ChatMessage = {
      id: `local-u-${Date.now()}`,
      conversationId: activeId,
      role: 'user',
      content: text,
      createdAt: now,
    };
    const assistantMsg: ChatMessage = {
      id: `local-a-${Date.now()}`,
      conversationId: activeId,
      role: 'assistant',
      content: '',
      createdAt: now,
    };
    setMsgs((prev) => [...prev, userMsg, assistantMsg]);

    try {
      for await (const ev of streamChat(activeId, text)) {
        if (ev.type === 'token') {
          const delta = (ev.data.content as string) ?? '';
          setMsgs((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m)),
          );
        } else if (ev.type === 'error') {
          const message = (ev.data.message as string) ?? '出错了';
          setMsgs((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: `⚠️ ${message}` } : m,
            ),
          );
        }
      }
    } finally {
      setStreaming(false);
      refetch();
    }
  }, [input, activeId, streaming, refetch]);

  const openConversation = (id: string) => {
    setActiveId(id);
    const conv = conversations.find((c) => c.id === id);
    if (conv) {
      setSelectedNode(conv.machineId);
      setSelectedBot(conv.agentId);
    }
  };

  return (
    <div className="flex h-full gap-3 p-4">
      {/* History rail */}
      <div className="w-60 shrink-0 flex flex-col bg-claw-card border border-claw-border rounded-xl overflow-hidden">
        <div className="px-3 py-3 border-b border-claw-border flex items-center gap-2 text-claw-text font-semibold text-sm">
          <MessageSquare size={16} /> 对话历史
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 && (
            <p className="text-xs text-claw-muted px-2 py-3">还没有对话</p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-sm ${
                activeId === c.id
                  ? 'bg-claw-primary/20 text-claw-primary-light'
                  : 'text-claw-muted hover:bg-claw-input hover:text-claw-text'
              }`}
            >
              <Bot size={14} className="shrink-0" />
              <span className="truncate flex-1">{c.title || `${c.agentId}`}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation.mutate(c.id);
                  if (activeId === c.id) setActiveId(null);
                }}
                className="opacity-0 group-hover:opacity-100 text-claw-muted hover:text-red-400"
                aria-label="删除会话"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col bg-claw-card border border-claw-border rounded-xl overflow-hidden">
        {/* Selector bar */}
        <div className="px-4 py-3 border-b border-claw-border flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Server size={15} className="text-claw-muted" />
            <select
              className="bg-claw-input border border-claw-border rounded-lg px-2.5 py-1.5 text-sm text-claw-text focus:outline-none focus:border-claw-primary"
              value={selectedNode}
              onChange={(e) => {
                setSelectedNode(e.target.value);
                setSelectedBot('');
              }}
            >
              <option value="">选择节点</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.host})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Bot size={15} className="text-claw-muted" />
            <select
              className="bg-claw-input border border-claw-border rounded-lg px-2.5 py-1.5 text-sm text-claw-text focus:outline-none focus:border-claw-primary disabled:opacity-50"
              value={selectedBot}
              disabled={!selectedNode}
              onChange={(e) => setSelectedBot(e.target.value)}
            >
              <option value="">选择 Bot</option>
              {bots.map((b) => (
                <option key={b.agentId} value={b.agentId}>
                  {b.name || b.agentId}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleNewConversation}
            disabled={!selectedNode || !selectedBot || createConversation.isPending}
            className="ml-auto flex items-center gap-1.5 bg-claw-primary/20 text-claw-primary-light hover:bg-claw-primary/30 disabled:opacity-40 rounded-lg px-3 py-1.5 text-sm font-medium"
          >
            <Plus size={15} /> 新会话
          </button>
        </div>

        {/* Transcript */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {!activeId && (
            <div className="h-full flex flex-col items-center justify-center text-claw-muted gap-2">
              <MessageSquare size={32} className="opacity-40" />
              <p className="text-sm">选择节点和 Bot，点「新会话」开始对话</p>
            </div>
          )}
          {activeId && msgs.length === 0 && (
            <div className="h-full flex items-center justify-center text-claw-muted text-sm">
              对 {activeConv?.agentId} 说点什么吧
            </div>
          )}
          {msgs.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}
            >
              {m.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-claw-primary/20 text-claw-primary-light flex items-center justify-center text-[11px] font-medium shrink-0">
                  <Bot size={14} />
                </div>
              )}
              <div
                className={`max-w-[78%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  m.role === 'user'
                    ? 'bg-claw-primary/20 text-claw-primary-light'
                    : 'bg-claw-input text-claw-text'
                }`}
              >
                {m.content || (streaming ? '…' : '')}
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-claw-border flex items-end gap-2">
          <textarea
            className="flex-1 bg-claw-input border border-claw-border rounded-lg px-3 py-2 text-sm text-claw-text placeholder-claw-muted focus:outline-none focus:border-claw-primary resize-none"
            rows={1}
            placeholder={activeId ? '输入消息，Enter 发送…' : '先开一个会话'}
            disabled={!activeId || streaming}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <button
            onClick={handleSend}
            disabled={!activeId || streaming || !input.trim()}
            className="bg-claw-primary/20 text-claw-primary-light hover:bg-claw-primary/30 disabled:opacity-40 rounded-lg px-3.5 py-2.5"
            aria-label="发送"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
