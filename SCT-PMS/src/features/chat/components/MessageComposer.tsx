import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/common";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { ChatMessage, TeamMemberSummary } from "@/types/tenant";

/** Only id/name/email are ever read here (search + @-mention insertion), so this accepts the
 *  narrower TeamMemberSummary rather than the full ChatUser (which additionally carries roles)
 *  — callers with either shape (e.g. channel members, which are TeamMemberSummary) can pass
 *  their list straight through without an unnecessary roles fetch or manual cast. */
type MentionCandidate = TeamMemberSummary | { id: "__everyone"; name: "everyone"; email: "Notify everyone in this chat"; isEveryone: true };

interface ResolvedMention {
  userId: string;
  name: string;
  start: number;
  end: number;
}

function displayToken(name: string) {
  return `@${name}`;
}

function toWireFormat(text: string, mentions: ResolvedMention[]) {
  const valid = mentions
    .filter((mention) => mention.userId !== "__everyone" && text.slice(mention.start, mention.end) === displayToken(mention.name))
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
  allowEveryone = false,
  placeholder = "Write a message...",
  replyTo,
  onCancelReply,
}: {
  users: TeamMemberSummary[];
  onSend: (input: { body?: string; replyToMessageId?: string }) => Promise<void>;
  disabled?: boolean;
  allowEveryone?: boolean;
  placeholder?: string;
  /** The message currently being replied to, if any — shown as a dismissible quote preview
   *  above the input. Distinct from the sidebar thread panel's composer, which never sets this. */
  replyTo?: ChatMessage | null;
  onCancelReply?: () => void;
}) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<ResolvedMention[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<{ query: string; start: number } | null>(null);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    textarea.style.overflowY = "hidden";
  }, [text]);

  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const normalizedMentionQuery = mentionQuery?.query.trim().toLowerCase() ?? "";
  const everyoneCandidate: MentionCandidate = { id: "__everyone", name: "everyone", email: "Notify everyone in this chat", isEveryone: true };
  const mentionCandidates: MentionCandidate[] = mentionQuery
    ? [
        ...(allowEveryone && "everyone".includes(normalizedMentionQuery) ? [everyoneCandidate] : []),
        ...users
          .filter((user) => user.name.toLowerCase().includes(normalizedMentionQuery) || user.email.toLowerCase().includes(normalizedMentionQuery))
          .slice(0, allowEveryone ? 5 : 6),
      ]
    : [];

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setText(value);
    setMentions((current) => current.filter((mention) => value.slice(mention.start, mention.end) === displayToken(mention.name)));
    const caret = event.target.selectionStart ?? value.length;
    const uptoCaret = value.slice(0, caret);
    const match = uptoCaret.match(/@([a-zA-Z0-9._ ]{0,30})$/);
    setMentionQuery(match ? { query: match[1], start: caret - match[0].length } : null);
    setMentionHighlight(0);
  }

  function pickMention(user: MentionCandidate) {
    if (!mentionQuery || !textareaRef.current) return;
    const caret = textareaRef.current.selectionStart ?? text.length;
    const before = text.slice(0, mentionQuery.start);
    const after = text.slice(caret);
    const token = displayToken(user.name);
    const nextText = `${before}${token} ${after}`;
    const nextCaret = before.length + token.length + 1;
    setText(nextText);
    if (!("isEveryone" in user)) {
      setMentions((current) => [...current, { userId: user.id, name: user.name, start: before.length, end: before.length + token.length }]);
    }
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
      await onSend({ body, replyToMessageId: replyTo?.id });
      setText("");
      setMentions([]);
      onCancelReply?.();
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.overflowY = "hidden";
        textareaRef.current.focus();
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Message could not be sent");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="relative border-t border-ink-200 bg-white p-3">
      {mentionQuery && mentionCandidates.length > 0 && (
        <div className="absolute bottom-full left-3 z-20 mb-1 max-h-72 w-72 overflow-y-auto rounded-xl border border-ink-200 bg-white py-1 shadow-popover">
          {mentionCandidates.map((user, index) => (
            <button
              key={user.id}
              onClick={() => pickMention(user)}
              onMouseEnter={() => setMentionHighlight(index)}
              className={cn("flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm", index === mentionHighlight ? "bg-brand-50" : "hover:bg-brand-50")}
            >
              <span className="shrink-0 font-medium text-brand-700">@{user.name}</span>
              <span className="min-w-0 truncate text-xs text-ink-400">{user.email}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="mb-2 text-xs text-danger-600">{error}</p>}
      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-ink-200 bg-surface-subtle px-3 py-2">
          <div className="min-w-0 flex-1 border-l-2 border-brand-500 pl-2">
            <p className="text-xs font-semibold text-brand-700">Replying to {replyTo.author.name}</p>
            <p className="truncate text-xs text-ink-500">{replyTo.isDeleted ? "Message deleted" : replyTo.body || "Attachment"}</p>
          </div>
          <button onClick={onCancelReply} title="Cancel reply" className="shrink-0 rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <X size={14} />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={(event) => {
            if (mentionQuery && mentionCandidates.length > 0) {
              if (event.key === "ArrowDown") { event.preventDefault(); setMentionHighlight((current) => (current + 1) % mentionCandidates.length); return; }
              if (event.key === "ArrowUp") { event.preventDefault(); setMentionHighlight((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
              if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); pickMention(mentionCandidates[Math.min(mentionHighlight, mentionCandidates.length - 1)]); return; }
              if (event.key === "Escape") { event.preventDefault(); setMentionQuery(null); return; }
            }
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
            if (event.key === "Escape" && replyTo) onCancelReply?.();
          }}
          disabled={disabled || sending}
          placeholder={replyTo ? "Write a reply..." : placeholder}
          rows={1}
          className={cn(
            "min-h-10 max-h-40 flex-1 resize-none overflow-hidden rounded-lg border border-ink-200 px-3 py-2 text-sm leading-5 outline-none transition-[height] duration-100 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 disabled:bg-ink-50",
          )}
        />
        <Button onClick={submit} disabled={disabled || sending || !text.trim()} leftIcon={<Send size={15} />}>Send</Button>
      </div>
    </div>
  );
}