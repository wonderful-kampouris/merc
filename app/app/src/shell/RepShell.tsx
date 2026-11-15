import { Button, Card, Elevation, Icon, Layout, Page } from "@wonderful/ui-base";
import { CalendarCheckIcon, CheckSquareIcon, DotsThreeOutlineIcon, MicrophoneIcon, StorefrontIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { screenTitleKey, useI18n } from "../lib/i18n";
import { screensFor, type Screen } from "../lib/routes";

const PRIMARY: Record<string, typeof CalendarCheckIcon> = {
  today: CalendarCheckIcon,
  customers: StorefrontIcon,
  record: MicrophoneIcon,
  approvals: CheckSquareIcon,
};

/** Mobile-first rep shell: screen content with a bottom tab bar (4 primary screens + More). */
export default function RepShell(props: { screen: Screen; navigate: (route: string) => void; children: ReactNode }) {
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const screens = screensFor("rep");
  const primary = screens.filter((s) => s.key in PRIMARY);
  const more = screens.filter((s) => !(s.key in PRIMARY));
  const go = (route: string) => {
    setMoreOpen(false);
    props.navigate(route);
  };
  const inMore = !(props.screen.key in PRIMARY);

  return (
    <div className="merc-rep">
      <main className="merc-rep__main">
        {moreOpen ? (
          <Page width="small">
            <Page.Header title={t("nav.more")} />
            <Page.Section>
              <Layout.Stack gap="sm">
                {more.map((s) => (
                  <Elevation key={s.key} level="sm" clickable asChild>
                    <Card as="button" onClick={() => go(s.route)}>
                      <Card.Meta title={t(screenTitleKey("rep", s.key))} description={s.route} />
                    </Card>
                  </Elevation>
                ))}
              </Layout.Stack>
            </Page.Section>
          </Page>
        ) : (
          props.children
        )}
      </main>
      <nav className="merc-tabbar" aria-label={t("nav.main")}>
        {primary.map((s) => {
          const active = !moreOpen && props.screen.key === s.key;
          return (
            <Button
              key={s.key}
              variant="tertiary"
              size="small"
              active={active}
              aria-current={active ? "page" : undefined}
              className="merc-tab"
              prefix={<Icon icon={PRIMARY[s.key]!} />}
              onClick={() => go(s.route)}
            >
              {t(screenTitleKey("rep", s.key))}
            </Button>
          );
        })}
        <Button
          variant="tertiary"
          size="small"
          active={moreOpen || inMore}
          className="merc-tab"
          prefix={<Icon icon={DotsThreeOutlineIcon} />}
          onClick={() => setMoreOpen((o) => !o)}
        >
          {t("nav.more")}
        </Button>
      </nav>
    </div>
  );
}
