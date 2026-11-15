import { Alert, Button } from "@wonderful/ui-base";
import { useScreenI18n } from "../../../../lib/i18n";
import { getErrorDetail, getErrorKey } from "./errorKey";
import kitMessages from "./kitMessages";

/** A failed load: friendly message, the contract error code, and a retry. */
export default function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useScreenI18n(kitMessages);
  return (
    <Alert
      variant="error"
      title={`${t("kit.loadError")}. ${t(getErrorKey(error))}`}
      description={getErrorDetail(error)}
      action={
        <Button size="small" onClick={onRetry}>
          {t("kit.retry")}
        </Button>
      }
    />
  );
}
