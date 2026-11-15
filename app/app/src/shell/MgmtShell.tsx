import { Button, Icon, Layout } from "@wonderful/ui-base";
import {
  BinocularsIcon, ChartLineUpIcon, CheckSquareIcon, CircleIcon, FunnelIcon, GearSixIcon, MapTrifoldIcon, MegaphoneIcon,
  RobotIcon, ShieldCheckIcon, TargetIcon, UploadSimpleIcon, UserGearIcon, UsersThreeIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { screenTitleKey, useI18n } from "../lib/i18n";
import { screensFor, type Screen } from "../lib/routes";

/** One icon per management screen key (contracts/app.json); unknown keys get a dot. */
const NAV_ICON: Record<string, typeof CircleIcon> = {
  dashboard: ChartLineUpIcon,
  team: UsersThreeIcon,
  approvals: CheckSquareIcon,
  pipeline: FunnelIcon,
  targets: TargetIcon,
  competition: BinocularsIcon,
  campaigns: MegaphoneIcon,
  territories: MapTrifoldIcon,
  users: UserGearIcon,
  import: UploadSimpleIcon,
  ai_log: RobotIcon,
  gdpr: ShieldCheckIcon,
  settings: GearSixIcon,
};

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
              prefix={<Icon icon={NAV_ICON[s.key] ?? CircleIcon} />}
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
