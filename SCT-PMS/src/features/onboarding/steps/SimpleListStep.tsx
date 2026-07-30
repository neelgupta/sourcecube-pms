import { useEffect, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button, Input } from "@/components/common";
import { ApiError } from "@/lib/api";

interface Item {
  id: string;
  label: string;
}

interface Props {
  title: string;
  description: string;
  placeholder: string;
  suggestions?: string[];
  list: () => Promise<Item[]>;
  create: (label: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  onSaved: () => void;
}

export function SimpleListStep({ title, description, placeholder, suggestions, list, create, remove, onSaved }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    list()
      .then(setItems)
      .finally(() => setLoading(false));
  }, [list]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const label = value.trim();
    if (!label) return;
    setError(null);
    try {
      await create(label);
      setValue("");
      const refreshed = await list();
      setItems(refreshed);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add");
    }
  }

  async function handleRemove(id: string) {
    try {
      await remove(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove");
    }
  }

  async function addSuggestion(label: string) {
    if (items.some((i) => i.label === label)) return;
    setError(null);
    try {
      await create(label);
      const refreshed = await list();
      setItems(refreshed);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add");
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
      <p className="text-sm text-ink-500">{description}</p>

      {error && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
          {error}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="flex-1" />
        <Button type="submit" disabled={!value.trim()}>
          Add
        </Button>
      </form>

      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions
            .filter((s) => !items.some((i) => i.label === s))
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addSuggestion(s)}
                className="rounded-full border border-ink-200 px-3 py-1 text-xs font-medium text-ink-600 transition-colors hover:border-brand-500 hover:text-brand-600"
              >
                + {s}
              </button>
            ))}
        </div>
      )}

      <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">
        {loading && <p className="px-3.5 py-3 text-sm text-ink-500">Loading…</p>}
        {!loading && items.length === 0 && <p className="px-3.5 py-3 text-sm text-ink-500">Nothing added yet.</p>}
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
            <span className="font-medium text-ink-900">{item.label}</span>
            <button
              onClick={() => handleRemove(item.id)}
              className="rounded p-1 text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
              title="Remove"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
