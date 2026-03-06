/**
 * Shared chat thread component built on assistant-ui primitives.
 * Reusable across playground and any future chat interfaces.
 */
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  type ChatModelAdapter,
  useLocalRuntime,
} from '@assistant-ui/react';
import { SendHorizontal, Square, Copy, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

export interface ChatThreadMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatThreadProps {
  onSendMessage: (message: string) => AsyncGenerator<{ type: string; data: Record<string, unknown> }> | Promise<string>;
  header?: ReactNode;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

function UserMessage() {
  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[80%] bg-claw-primary/20 text-claw-text rounded-2xl rounded-br-sm px-4 py-2.5 text-sm">
        <MessagePrimitive.Content />
      </div>
    </div>
  );
}

function AssistantMessage() {
  return (
    <div className="flex justify-start mb-3 group">
      <div className="max-w-[85%]">
        <div className="bg-claw-card border border-claw-border rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-claw-text">
          <MessagePrimitive.Content />
        </div>
        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ActionBarPrimitive.Copy asChild>
            <button className="p-1 text-claw-muted hover:text-claw-text rounded transition-colors">
              <Copy size={12} />
            </button>
          </ActionBarPrimitive.Copy>
          <ActionBarPrimitive.Reload asChild>
            <button className="p-1 text-claw-muted hover:text-claw-text rounded transition-colors">
              <RefreshCw size={12} />
            </button>
          </ActionBarPrimitive.Reload>
        </div>
      </div>
    </div>
  );
}

function Composer({ placeholder }: { placeholder: string }) {
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2 border-t border-claw-border px-4 pt-3 pb-5 bg-claw-sidebar/30">
      <ComposerPrimitive.Input
        placeholder={placeholder}
        className="flex-1 bg-claw-bg border border-claw-border rounded-xl px-4 py-2.5 text-sm text-claw-text placeholder-claw-muted focus:border-claw-primary focus:outline-none resize-none min-h-[40px] max-h-[120px]"
        autoFocus
      />
      <ComposerPrimitive.Send asChild>
        <button className="p-2.5 bg-claw-primary text-white rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0">
          <SendHorizontal size={16} />
        </button>
      </ComposerPrimitive.Send>
      <ComposerPrimitive.Cancel asChild>
        <button className="p-2.5 bg-claw-danger/20 text-claw-danger rounded-xl hover:bg-claw-danger/30 transition-colors shrink-0">
          <Square size={16} />
        </button>
      </ComposerPrimitive.Cancel>
    </ComposerPrimitive.Root>
  );
}

export function ChatThread({
  onSendMessage,
  header,
  className = '',
  placeholder = '输入消息开始测试...',
}: ChatThreadProps) {
  const adapter: ChatModelAdapter = {
    async *run({ messages }) {
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage) return;

      const userText = lastMessage.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');

      const result = onSendMessage(userText);

      if (Symbol.asyncIterator in result) {
        let fullText = '';
        for await (const event of result) {
          if (event.type === 'text-delta') {
            fullText += event.data.content as string;
            yield { content: [{ type: 'text' as const, text: fullText }] };
          }
          if (event.type === 'error') {
            fullText += `\n\n**Error:** ${event.data.message}`;
            yield { content: [{ type: 'text' as const, text: fullText }] };
          }
          if (event.type === 'tool-call-begin') {
            fullText += `\n\n> Tool: \`${event.data.name}\`\n`;
            yield { content: [{ type: 'text' as const, text: fullText }] };
          }
          if (event.type === 'tool-call-result') {
            const res = (event.data.result as string).slice(0, 500);
            fullText += `> Result: ${res}\n`;
            yield { content: [{ type: 'text' as const, text: fullText }] };
          }
        }
        return { content: [{ type: 'text' as const, text: fullText }] };
      }

      const text = await result;
      return { content: [{ type: 'text' as const, text }] };
    },
  };

  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className={`flex flex-col h-full ${className}`}>
        {header}
        <ThreadPrimitive.Root className="flex-1 flex flex-col min-h-0">
          <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-4">
            <ThreadPrimitive.Empty>
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-12 h-12 rounded-2xl bg-claw-primary/10 flex items-center justify-center mb-3">
                  <span className="text-2xl">🤖</span>
                </div>
                <p className="text-sm text-claw-muted">Send a message to start testing the skill</p>
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
          </ThreadPrimitive.Viewport>
          <Composer placeholder={placeholder} />
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  );
}
