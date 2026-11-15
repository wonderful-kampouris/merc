import { Button, Layout } from "@wonderful/ui-base";
import type { ReactNode } from "react";
import { screenTitleKey, useI18n } from "../lib/i18n";
import { screensFor, type Screen } from "../lib/routes";

/** Management shell: side navigation on desktop, a scrolling row above the screen on phones. */
export default function MgmtShell(props: { screen: Screen; navigate: (route: string) => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="merc-mgmt">
      <nav className="merc-mgmt__nav" aria-label={t("nav.main")}>
        <Layout.Stack gap="xs">
          {screensFor("management").map((s) => (
            <Button
              key={s.key}
              variant="tertiary"
              size="small"
              active={props.screen.key === s.key}
              aria-current={props.screen.key === s.key ? "page" : undefined}
              className="merc-mgmt__link"
              onClick={() => props.navigate(s.route)}
            >
              {t(screenTitleKey("management", s.key))}
            </Button>
          ))}
        </Layout.Stack>
      </nav>
      <div className="merc-mgmt__main">{props.children}</div>
    </div>
  );
}
