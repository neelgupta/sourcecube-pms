import { useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/common";
import { ApiError } from "@/lib/api";
import type { ChatUser } from "@/types/tenant";

interface MentionCandidate extends ChatUser {}

/** A resolved mention: displayText is what the user sees in the textarea ("@Jatin"),
 *  while the wire format sent to the backend is "@[userId:Name]" (see
 *  server/src/lib/chat.ts extractMentionIds) so mentions resolve unambiguously even when
 *  two users share a display name. We track the display-text range so edits/deletes near a
 *  mention invalidate it instead of leaving a dangling reference. */
interface ResolvedMention {
  userId: string;
  name: string;
  start: number;
  end: number;
}

function displayToken(name: string) {
  return `@${name}`;
}

/** Converts the plain display text back to wire format by replacing each still-valid
 *  mention range with its "@[userId:Name]" token. Ranges are applied right-to-left so
 *  earlier offsets stay valid as the string grows. */
function toWireFormat(text: string, mentions: ResolvedMention[]) {
  const valid = mentions
    .filter((m) => text.slice(m.start, m.end) === displayToken(m.name))
    .sort((a, b) => b.start - a.start);
  let result = text;
  for (const mention of valid) {
    result = result.slice(0, mention.start) + `@[${mention.userId}:${mention.name}]` + result.slice(mention.end);
  }
  return result;
}

export function MessageComposer({
  users,
  onSend,
  disabled,
  placeholder = "Write a message...",
}: {
  users: ChatUser[];
  onSend: (input: { body?: string }) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<ResolvedMention[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<{ query: string; start: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentionCandidates: MentionCandidate[] = mentionQuery
    ? users.filter((user) => user.name.toLowerCase().includes(mentionQuery.query.toLowerCase())).slice(0, 6)
    : [];

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setText(value);
    setMentions((current) => current.filter((m) => value.slice(m.start, m.end) === displayToken(m.name)));
    const caret = event.target.selectionStart ?? value.length;
    const uptoCaret = value.slice(0, caret);
    const match = uptoCaret.match(/@([a-zA-Z0-9._ ]{0,30})$/);
    if (match) {
      setMentionQuery({ query: match[1], start: caret - match[0].length });
    } else {
      setMentionQuery(null);
    }
  }

  function pickMention(user: ChatUser) {
    if (!mentionQuery || !textareaRef.current) return;
    const caret = textareaRef.current.selectionStart ?? text.length;
    const before = text.slice(0, mentionQuery.start);
    const after = text.slice(caret);
    const token = displayToken(user.name);
    const nextText = `${before}${token} ${after}`;
    const nextCaret = before.length + token.length + 1;
    setText(nextText);
    setMentions((current) => [...current, { userId: user.id, name: user.name, start: before.length, end: before.length + token.length }]);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || sending || disabled) return;
    const body = toWireFormat(text, mentions).trim();
    setSending(true);
    setError(null);
    try {
      await onSend({ body });
      setText("");
      setMentions([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Message could not be sent");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="relative border-t border-ink-200 bg-white p-3">
      {mentionQuery && mentionCandidates.length > 0 && (
        <div className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-popover">
          {mentionCandidates.map((user) => (
            <button key={user.id} onClick={() => pickMention(user)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50">
              <span className="font-medium text-ink-900">{user.name}</span>
              <span className="truncate text-xs text-ink-400">{user.email}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="mb-2 text-xs text-danger-600">{error}</p>}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
          disabled={disabled || sending}
          placeholder={placeholder}
          rows={1}
          className="min-h-10 flex-1 resize-none rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
        />
        <Button onClick={submit} disabled={disabled || sending || !text.trim()} leftIcon={<Send size={15} />}>Send</Button>
      </div>
    </div>
  );
}
