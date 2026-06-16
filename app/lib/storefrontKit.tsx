import { useMemo, useState } from "react";
import {
  Modal,
  TextField,
  BlockStack,
  InlineStack,
  Tag,
  Button,
  Box,
  Checkbox,
  Text,
} from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";

export type PickerCollection = { id: string; title: string; count: number };

/**
 * Searchable collection picker in a modal, so a store with hundreds of
 * collections never blows out the page layout. Selected items show as
 * removable tags under the trigger button.
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
    <BlockStack gap="200">
      <InlineStack>
        <Button icon={SearchIcon} onClick={() => setOpen(true)}>
          {selected.length > 0 ? `${label} (${selected.length})` : label}
        </Button>
      </InlineStack>

      {selected.length > 0 && (
        <InlineStack gap="100">
          {selected.map((id) => (
            <Tag key={id} onRemove={() => toggle(id)}>
              {byId[id]?.title ?? id}
            </Tag>
          ))}
        </InlineStack>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Select collections"
        primaryAction={{ content: "Done", onAction: () => setOpen(false) }}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label="Search collections"
              labelHidden
              value={query}
              onChange={setQuery}
              autoComplete="off"
              placeholder="Search collections…"
              prefix={<span />}
            />
            <Box maxWidth="100%">
              <BlockStack gap="100">
                {filtered.length === 0 ? (
                  <Text as="p" tone="subdued">
                    No collections match “{query}”.
                  </Text>
                ) : (
                  filtered.map((c) => (
                    <Checkbox
                      key={c.id}
                      label={`${c.title} (${c.count})`}
                      checked={selected.includes(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                  ))
                )}
              </BlockStack>
            </Box>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </BlockStack>
  );
}
