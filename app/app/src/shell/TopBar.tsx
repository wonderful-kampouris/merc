import { Badge, Button, Layout, Text, ToggleGroup } from "@wonderful/ui-base";
import { useI18n, type Lang } from "../lib/i18n";
import type { Role, Shell } from "../lib/routes";

export interface TopBarProps {
  lang: Lang;
  onLang: (l: Lang) => void;
  shells: readonly Shell[];
  shell: Shell;
  onShell: (s: Shell) => void;
  mock: boolean;
  onMock: (on: boolean) => void;
  role: Role;
  onRole?: (r: Role) => void;
  userName?: string;
}

export default function TopBar(p: TopBarProps) {
  const { t } = useI18n();
  return (
    <header className="merc-topbar">
      <Layout.Row split gap="sm" wrap>
        <Layout.Row gap="sm">
          <Text variant="heading-3">{t("app.title")}</Text>
          <Badge text={t(`role.${p.role}`)} size="small" color="muted" />
          {p.mock ? <Badge text={t("badge.mock")} size="small" color="purple" /> : null}
        </Layout.Row>
        <Layout.Row gap="sm" wrap>
          {p.shells.length > 1 ? (
            <ToggleGroup size="small" value={p.shell} onChange={(v) => p.onShell(v as Shell)} aria-label={t("top.shell")}>
              {p.shells.map((s) => (
                <ToggleGroup.Item key={s} value={s} text={t(`shell.${s}`)} />
              ))}
            </ToggleGroup>
          ) : null}
          {p.mock && p.onRole ? (
            <ToggleGroup size="small" value={p.role} onChange={(v) => p.onRole!(v as Role)} aria-label={t("top.role")}>
              {(["rep", "manager", "admin"] as const).map((r) => (
                <ToggleGroup.Item key={r} value={r} text={t(`role.${r}`)} />
              ))}
            </ToggleGroup>
          ) : null}
          <ToggleGroup size="small" value={p.lang} onChange={(v) => p.onLang(v as Lang)} aria-label={t("top.language")}>
            <ToggleGroup.Item value="el" text="ΕΛ" aria-label="Ελληνικά" />
            <ToggleGroup.Item value="en" text="EN" aria-label="English" />
          </ToggleGroup>
          <Button size="small" variant="tertiary" active={p.mock} onClick={() => p.onMock(!p.mock)}>
            {t("top.mock")}
          </Button>
        </Layout.Row>
      </Layout.Row>
    </header>
  );
}
