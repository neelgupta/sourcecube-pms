import { useState } from "react";
import { Check, CheckCheck, MessageSquare, Pencil, Pin, Smile, Trash2 } from "lucide-react";
import { MemberAvatar } from "@/components/common";
import { cn } from "@/lib/cn";
import type { ChatMessage, ChatUser } from "@/types/tenant";

const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "✅"];
const URL_TEST = /^(?:https?:\/\/|www\.)/i;

interface EditMention {
  userId: string;
  name: string;
}

function editValueFromWire(body: string, users: ChatUser[]) {
  const mentions: EditMention[] = [];
  const text = body.replace(/@\[([a-zA-Z0-9_-]+):([^\]]*)\]/g, (_token, userId: string, fallbackName: string) => {
    const name = users.find((user) => user.id === userId)?.name ?? fallbackName;
    mentions.push({ userId, name });
    return `@${name}`;
  });
  return { text, mentions };
}

function editValueToWire(text: string, mentions: EditMention[]) {
  let result = text;
  for (const mention of mentions) {
    const display = `@${mention.name}`;
    const index = result.indexOf(display);
    if (index >= 0) result = `${result.slice(0, index)}@[${mention.userId}:${mention.name}]${result.slice(index + display.length)}`;
  }
  return result;
}

/** Splits on both "@[userId:Name]" mention tokens and bare URLs, rendering mentions as
 *  pills and URLs as clickable links while leaving the rest as plain text. */
function renderBody(body: string, users: ChatUser[]) {
  const mentionParts = body.split(/(@\[[a-zA-Z0-9_-]+:[^\]]*\])/g);
  return mentionParts.map((part, index) => {
    const mentionMatch = part.match(/^@\[([a-zA-Z0-9_-]+):([^\]]*)\]$/);
    if (mentionMatch) {
      const [, userId, name] = mentionMatch;
      const known = users.find((user) => user.id === userId);
      return <span key={index} className="rounded bg-brand-50 px-1 font-medium text-brand-700">@{known?.name ?? name}</span>;
    }
    const urlParts = part.split(/(\s+)/).filter(Boolean);
    return (
      <span key={index}>
        {urlParts.map((segment, segIndex) => {
          if (URL_TEST.test(segment)) {
            const href = segment.startsWith("www.") ? `https://${segment}` : segment;
            return (
              <a key={segIndex} href={href} target="_blank" rel="noreferrer" className="break-all text-brand-600 underline hover:text-brand-700">
                {segment}
              </a>
            );
          }
          return <span key={segIndex}>{segment}</span>;
        })}
      </span>
    );
  });
}

export function MessageBubble({
  message,
  users,
  currentUserId,
  canManage,
  isRead = false,
  onReact,
  onUnreact,
  onDelete,
  onEdit,
  onPin,
  onOpenThread,
  showThreadAction = true,
}: {
  message: ChatMessage;
  users: ChatUser[];
  currentUserId: string;
  canManage: boolean;
  isRead?: boolean;
  onReact: (emoji: string) => void;
  onUnreact: (emoji: string) => void;
  onDelete: () => void;
  onEdit?: (body: string) => Promise<void>;
  onPin?: () => void;
  onOpenThread?: () => void;
  showThreadAction?: boolean;
}) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const initialEditValue = editValueFromWire(message.body ?? "", users);
  const [draft, setDraft] = useState(initialEditValue.text);
  const [editMentions, setEditMentions] = useState<EditMention[]>(initialEditValue.mentions);
  const [saving, setSaving] = useState(false);
  const isMine = message.authorId === currentUserId;
  const canDelete = isMine || canManage;
  const canEdit = isMine && Boolean(onEdit);

  async function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed || !onEdit || saving) return;
    const body = editValueToWire(trimmed, editMentions);
    setSaving(true);
    try {
      await onEdit(body);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function startEdit() {
    const value = editValueFromWire(message.body ?? "", users);
    setDraft(value.text);
    setEditMentions(value.mentions);
    setIsEditing(true);
  }

  const reactionGroups = new Map<string, { count: number; mine: boolean }>();
  for (const reaction of message.reactions) {
    const entry = reactionGroups.get(reaction.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (reaction.userId === currentUserId) entry.mine = true;
    reactionGroups.set(reaction.emoji, entry);
  }

  if (message.isSystem) {
    return (
      <div className="flex justify-center px-4 py-1.5">
        <p className="rounded-full bg-surface-subtle px-3 py-1 text-xs text-ink-400">{message.body}</p>
      </div>
    );
  }

  if (message.isDeleted) {
    return (
      <div className={cn("flex px-4 py-1", isMine ? "justify-end" : "justify-start")}>
        <p className="rounded-2xl bg-surface-subtle px-3 py-2 text-xs italic text-ink-400">Message deleted</p>
      </div>
    );
  }

  return (
    <div className={cn("group flex items-end gap-2 px-4 py-1", isMine ? "flex-row-reverse" : "flex-row")}>
      {!isMine && <MemberAvatar id={message.authorId} name={message.author.name} size="sm" className="mb-4 shrink-0 ring-0" />}

      <div className={cn("flex min-w-0 flex-col", isEditing ? "w-[85%] max-w-md" : "max-w-[70%]", isMine ? "items-end" : "items-start")}>
        {!isMine && <span className="mb-0.5 px-1 text-xs font-semibold text-ink-500">{message.author.name}</span>}

        <div
          className={cn(
            "relative rounded-2xl px-3.5 py-2 shadow-sm",
            isMine ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md border border-ink-200 bg-white text-ink-800",
            message.isPinned && "ring-2 ring-warning-400",
            isEditing && "w-full",
          )}
        >
          {message.isAnnouncement && (
            <span className="mb-1 inline-block rounded bg-warning-100 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700">Announcement</span>
          )}
          {isEditing ? (
            <div className="w-full min-w-0">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); saveEdit(); }
                  if (event.key === "Escape") setIsEditing(false);
                }}
                rows={3}
                autoFocus
                className={cn(
                  "min-h-20 max-h-48 w-full resize-y overflow-y-auto rounded-lg border px-3 py-2 text-sm leading-5 outline-none focus:ring-2",
                  isMine ? "border-white/40 bg-brand-700 text-white placeholder:text-brand-100 focus:border-white/60 focus:ring-white/15" : "border-ink-200 bg-white text-ink-900 focus:border-brand-500 focus:ring-brand-500/15",
                )}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2"><span className={cn("text-[10px]", isMine ? "text-brand-100" : "text-ink-400")}>Enter to save · Shift+Enter for a new line</span><div className="flex shrink-0 items-center gap-2">
                <button onClick={() => setIsEditing(false)} className={cn("rounded-md px-2 py-1 text-xs font-medium", isMine ? "text-brand-100 hover:bg-white/10 hover:text-white" : "text-ink-500 hover:bg-ink-100 hover:text-ink-700")}>Cancel</button>
                <button onClick={saveEdit} disabled={saving || !draft.trim()} className={cn("rounded-md px-2.5 py-1 text-xs font-semibold", isMine ? "bg-white/15 text-white hover:bg-white/25" : "bg-brand-600 text-white hover:bg-brand-700", "disabled:opacity-50")}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div></div>
            </div>
          ) : (
            message.body && (
              <p className={cn("whitespace-pre-wrap break-words text-sm", isMine && "[&_a]:text-white [&_a]:underline")}>
                {renderBody(message.body, users)}
              </p>
            )
          )}
          {!isEditing && <div className={cn("mt-1 flex items-center gap-1", isMine ? "justify-end text-brand-100" : "justify-end text-ink-400")}> 
            {message.isPinned && <Pin size={10} className={isMine ? "text-white" : "text-warning-500"} />}
            {message.editedAt && <span className="text-[10px] italic">edited</span>}
            <span className="text-[10px]">{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            {isMine && (
              isRead ? <CheckCheck size={13} className="text-sky-300" aria-label="Read" /> : <Check size={13} aria-label="Sent" />
            )}
          </div>}
        </div>

        {reactionGroups.size > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {Array.from(reactionGroups.entries()).map(([emoji, { count, mine }]) => (
              <button
                key={emoji}
                onClick={() => (mine ? onUnreact(emoji) : onReact(emoji))}
                className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", mine ? "border-brand-300 bg-brand-50 text-brand-700" : "border-ink-200 bg-white text-ink-600 hover:border-brand-200")}
              >
                <span>{emoji}</span><span>{count}</span>
              </button>
            ))}
          </div>
        )}

        {showThreadAction && message._count.replies > 0 && (
          <button onClick={onOpenThread} className="mt-1 flex items-center gap-1 px-1 text-xs font-medium text-brand-600 hover:underline">
            <MessageSquare size={12} /> {message._count.replies} {message._count.replies === 1 ? "reply" : "replies"}
          </button>
        )}
      </div>

      <div className={cn("relative mb-4 flex shrink-0 items-center gap-0.5 self-center transition-opacity", isEditing ? "opacity-0" : "opacity-0 group-hover:opacity-100")}>
        <button onClick={() => setShowEmojiPicker((v) => !v)} title="React" className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
          <Smile size={14} />
        </button>
        {showThreadAction && onOpenThread && (
          <button onClick={onOpenThread} title="Reply in thread" className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <MessageSquare size={14} />
          </button>
        )}
        {canEdit && (
          <button onClick={startEdit} title="Edit message" className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <Pencil size={14} />
          </button>
        )}
        {canManage && onPin && (
          <button onClick={onPin} title={message.isPinned ? "Unpin" : "Pin"} className="rounded-full p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <Pin size={14} />
          </button>
        )}
        {canDelete && (
          <button onClick={onDelete} title="Delete" className="rounded-full p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600">
            <Trash2 size={14} />
          </button>
        )}
        {showEmojiPicker && (
          <div className={cn("absolute top-8 z-20 flex gap-1 rounded-lg border border-ink-200 bg-white p-1.5 shadow-popover", isMine ? "right-0" : "left-0")}>
            {QUICK_EMOJI.map((emoji) => (
              <button key={emoji} onClick={() => { onReact(emoji); setShowEmojiPicker(false); }} className="rounded p-1 text-base hover:bg-ink-100">{emoji}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
