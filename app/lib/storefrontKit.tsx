import { useMemo, useState } from "react";
import { Modal, flag, val } from "../components/wc";

export type PickerCollection = { id: string; title: string; count: number };

/**
 * Searchable collection picker in a modal, so a store with hundreds of
 * collections never blows out the page layout. Selected items show as
 * removable chips under the trigger button. Polaris web components.
 */
export function CollectionPicker({
  collections,
  selected,
  onChange,
  label = "Select collections",
}: {
  collections: PickerCollection[];
  selected: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const byId = useMemo(
    () => Object.fromEntries(collections.map((c) => [c.id, c])),
    [collections],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) => c.title.toLowerCase().includes(q));
  }, [collections, query]);

  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );

  return (
    <s-stack direction="block" gap="small">
      <s-stack direction="inline">
        <s-button icon="search" onClick={() => setOpen(true)}>
          {selected.length > 0 ? `${label} (${selected.length})` : label}
        </s-button>
      </s-stack>

      {selected.length > 0 && (
        <s-stack direction="inline" gap="small-200">
          {selected.map((id) => (
            <s-chip key={id} removable onRemove={() => toggle(id)}>
              {byId[id]?.title ?? id}
            </s-chip>
          ))}
        </s-stack>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        heading="Select collections"
        primaryAction={
          <s-button variant="primary" onClick={() => setOpen(false)}>
            Done
          </s-button>
        }
      >
        <s-stack direction="block" gap="base">
          <s-search-field
            label="Search collections"
            labelAccessibilityVisibility="exclusive"
            value={query}
            placeholder="Search collections…"
            onInput={(e) => setQuery(val(e))}
          />
          <s-stack direction="block" gap="small-200">
            {filtered.length === 0 ? (
              <s-paragraph color="subdued">No collections match “{query}”.</s-paragraph>
            ) : (
              filtered.map((c) => (
                <s-checkbox
                  key={c.id}
                  label={`${c.title} (${c.count})`}
                  checked={flag(selected.includes(c.id))}
                  onChange={() => toggle(c.id)}
                />
              ))
            )}
          </s-stack>
        </s-stack>
      </Modal>
    </s-stack>
  );
}
