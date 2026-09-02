/**
 * Shared confirmation dialog (QA 2026-08-31: five window.confirm() calls were
 * untranslated browser chrome). One Polaris modal, fully localized, used by
 * every destructive action in the admin.
 */
import { Modal, Text } from "@shopify/polaris";
import { useLocale } from "../lib/i18n";

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      primaryAction={{
        content: confirmLabel,
        destructive,
        onAction: onConfirm,
      }}
      secondaryActions={[{ content: t("common.cancel"), onAction: onCancel }]}
    >
      <Modal.Section>
        <Text as="p">{message}</Text>
      </Modal.Section>
    </Modal>
  );
}
