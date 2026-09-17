import { ArrowUp, Copy, Ellipsis, Sparkles, Undo2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Menu } from "../../ui/Menu.tsx";
import { TextArea } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  ops?: number;
}

const INITIAL_MESSAGES: Message[] = [
  { id: "m1", role: "user", text: "Make the event card pop when I tap it, like a gentle spring." },
  {
    id: "m2",
    role: "assistant",
    text: "Done. I wired Interaction → Switch → Pop Animation → Transition and bound it to Event Card’s scale (1 → 1.08). Tap the card in the viewer to try it.",
    ops: 12,
  },
  { id: "m3", role: "user", text: "Can it feel a little snappier?" },
  { id: "m4", role: "assistant", text: "I set bounciness to 3 and speed to 14. It now settles in 0.41 s with a 3.8% overshoot.", ops: 2 },
];

const MCP_ENDPOINT = "http://127.0.0.1:4317/mcp";

/** Chat with Claude about the prototype. Uses a connected Claude app or your own API key. */
export function AssistantDrawer({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { id: `u${current.length}`, role: "user", text },
      { id: `a${current.length}`, role: "assistant", text: "This preview isn’t connected to Claude yet. Connect Claude Desktop or Claude Code above, or add an API key, and I’ll build it." },
    ]);
    setDraft("");
    requestAnimationFrame(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }));
  };

  return (
    <div className="sb-drawer__panel">
      <header className="sb-drawer__header">
        <Sparkles size={14} strokeWidth={2} className="sb-drawer__header-icon" data-tone="ai" aria-hidden />
        <h2 className="sb-drawer__title">Assistant</h2>
        <Badge tone="ai" size="sm">
          Claude
        </Badge>
        <div className="sb-drawer__header-actions">
          <Menu
            aria-label="Assistant options"
            placement="bottom-end"
            entries={[
              { id: "new", label: "New conversation", onSelect: () => setMessages([]) },
              { id: "key", label: "Use my API key…" },
              { type: "separator" },
              { id: "privacy", label: "What Claude can see", description: "The open document and your selection" },
            ]}
          >
            <IconButton size="sm" icon={<Ellipsis size={14} />} label="Assistant options" />
          </Menu>
          <IconButton size="sm" icon={<X size={14} />} label="Close" shortcut="Escape" onClick={onClose} />
        </div>
      </header>

      <section className="sb-assistant__connect">
        <div className="sb-assistant__connect-title">Bring your own Claude</div>
        <p className="sb-assistant__connect-text">Point Claude Desktop or Claude Code at Sonobe’s local MCP server. Claude edits this prototype with the same undoable changes you make.</p>
        <div className="sb-assistant__endpoint">
          <code className="sb-selectable">{MCP_ENDPOINT}</code>
          <IconButton
            size="xs"
            icon={<Copy size={12} />}
            label="Copy server address"
            onClick={() => {
              void navigator.clipboard?.writeText(MCP_ENDPOINT).catch(() => undefined);
              toast({ title: "Server address copied", tone: "success" });
            }}
          />
        </div>
        <div className="sb-assistant__connect-actions">
          <Button size="sm" variant="ai">
            Connect Claude Desktop
          </Button>
          <Button size="sm" variant="ghost">
            Claude Code setup
          </Button>
        </div>
      </section>

      <div ref={threadRef} className="sb-assistant__thread sb-scroll" role="log" aria-label="Conversation">
        {messages.length === 0 && <div className="sb-assistant__empty">Ask Claude to build an interaction, explain a patch, or find out why a tap isn’t firing.</div>}
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="sb-msg sb-selectable" data-role="user">
              {message.text}
            </div>
          ) : (
            <div key={message.id} className="sb-msg" data-role="assistant">
              <span className="sb-msg__avatar" aria-hidden>
                <Sparkles size={12} strokeWidth={2} />
              </span>
              <div className="sb-msg__body">
                <div className="sb-msg__text sb-selectable">{message.text}</div>
                {message.ops !== undefined && (
                  <div className="sb-msg__ops">
                    <Badge size="sm" className="sb-tabular">
                      {message.ops} changes
                    </Badge>
                    <Button size="sm" variant="ghost" icon={<Undo2 size={12} />} onClick={() => toast({ title: `Undid ${message.ops} changes` })}>
                      Undo
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ),
        )}
      </div>

      <footer className="sb-assistant__composer">
        <TextArea
          aria-label="Message Claude"
          placeholder="Ask Claude to build or explain something…"
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="sb-assistant__composer-bar">
          <span className="sb-assistant__context">Event Card is selected</span>
          <Button size="sm" variant="primary" icon={<ArrowUp size={13} strokeWidth={2.25} />} disabled={!draft.trim()} onClick={send}>
            Send
          </Button>
        </div>
      </footer>
    </div>
  );
}
