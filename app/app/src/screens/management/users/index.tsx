import { UserPlusIcon } from "@phosphor-icons/react";
import { Alert, Avatar, AvatarFallback, Badge, Button, Card, Icon, InputText, Layout, Page, Select, Text, Toggle } from "@wonderful/ui-base";
import { useState } from "react";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { Empty, LoadView, RichRow } from "../settings/KitView";
import { errorText, objArr, useLoad, withMockSeed } from "../settings/kit";
import { personOption } from "../../../shell/RepAvatar";
import messages from "./i18n";
import {
  emptyUserForm, formFromUser, managerOptions, nameOf, parseUsers, ROLES, seedTerritories, toUpsert, validateUser,
  type RoleCode, type User, type UserForm,
} from "./model";

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

const ROLE_COLOR: Record<RoleCode, "blue" | "purple" | "teal"> = { rep: "teal", manager: "blue", admin: "purple" };

export default function Users({ client }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const list = useLoad(async () => {
    const users = withMockSeed(client.mock, parseUsers(objArr((await client.call("users-list", {})).items)), "app_user", parseUsers);
    return client.mock ? seedTerritories(users) : users;
  }, [client]);
  const [form, setForm] = useState<UserForm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Page width="medium">
      <Page.Header
        title={t("screen.management.users")}
        description={t("subtitle")}
        actions={<Button variant="primary" prefix={<Icon icon={UserPlusIcon} />} onClick={() => setForm(emptyUserForm())}>{t("invite")}</Button>}
      />
      {notice ? (
        <Page.Section>
          <Alert variant="success" title={notice} isClosable onClose={() => setNotice(null)} />
        </Page.Section>
      ) : null}
      <LoadView state={list} onRetry={list.reload} retryLabel={t("retry")} errorTitle={t("common.error")}>
        {(users) => (
          <>
            {form ? (
              <Page.Section>
                <UserEditor
                  form={form}
                  users={users}
                  onChange={setForm}
                  onCancel={() => setForm(null)}
                  save={async (f) => {
                    const r = await client.call("user-upsert", toUpsert(f));
                    setForm(null);
                    setNotice(r.invited ? t("invited", { email: f.email.trim().toLowerCase() }) : t("saved"));
                    list.reload();
                  }}
                />
              </Page.Section>
            ) : null}
            <Page.Section>
              {users.length === 0 ? (
                <Empty title={t("empty")} description={t("emptyHint")} action={{ label: t("invite"), onClick: () => setForm(emptyUserForm()) }} />
              ) : (
                <Card>
                  <Card.Header title={t("list")} description={t("count", { n: users.length })} />
                  <Card.List>
                    {users.map((u) => (
                      <UserRow key={u.id} user={u} users={users} onEdit={(f) => setForm(f)} />
                    ))}
                  </Card.List>
                </Card>
              )}
            </Page.Section>
          </>
        )}
      </LoadView>
    </Page>
  );
}

function UserRow(p: { user: User; users: User[]; onEdit: (f: UserForm) => void }) {
  const { t } = useScreenI18n(messages);
  const u = p.user;
  const editable = formFromUser(u);
  const boss = nameOf(p.users, u.manager_id);
  const details = [u.email, boss ? t("reportsTo", { name: boss }) : null, u.territory_ids?.length ? t("territoriesN", { n: u.territory_ids.length }) : null].filter(Boolean);
  return (
    <RichRow
      avatar={<Avatar><AvatarFallback>{initials(u.full_name)}</AvatarFallback></Avatar>}
      title={
        <Layout.Row gap="xs" wrap>
          <Text variant="md" weight="medium">{u.full_name}</Text>
          <Badge size="small" color={ROLE_COLOR[u.role_code]} text={t(`role.${u.role_code}`)} />
          {u.status === "left" ? <Badge size="small" color="muted" text={t("left")} /> : null}
        </Layout.Row>
      }
      description={details.join(" · ")}
      actions={editable ? <Button size="small" variant="tertiary" onClick={() => p.onEdit(editable)}>{t("edit")}</Button> : null}
    />
  );
}

function UserEditor(p: { form: UserForm; users: User[]; onChange: (f: UserForm) => void; onCancel: () => void; save: (f: UserForm) => Promise<void> }) {
  const { t } = useScreenI18n(messages);
  const f = p.form;
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = validateUser(f);
  const show = (k: (typeof problems)[number]) => tried && problems.includes(k);
  const set = (patch: Partial<UserForm>) => p.onChange({ ...f, ...patch });
  const submit = async () => {
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setError(null);
    try {
      await p.save(f);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const managers = managerOptions(p.users, f.user_id);
  return (
    <Card withHeaderDivider>
      <Card.Header title={f.user_id ? t("formEdit") : t("formNew")} />
      <Card.Content>
        <Layout.Stack gap="md">
          <InputText label={t("full_name")} value={f.full_name} isError={show("full_name")} hint={show("full_name") ? t("problem.full_name") : undefined} onChange={(e) => set({ full_name: e.target.value })} />
          <InputText type="email" label={t("email")} value={f.email} isError={show("email")} hint={show("email") ? t("problem.email") : undefined} onChange={(e) => set({ email: e.target.value })} />
          <InputText type="tel" label={t("phone")} value={f.phone} isError={show("phone")} hint={show("phone") ? t("problem.phone") : undefined} onChange={(e) => set({ phone: e.target.value })} />
          <Layout.Grid idealColumns={2} gap="sm">
            <Layout.Stack gap="xs">
              <Text variant="sm" color="secondary">{t("role")}</Text>
              <Select<RoleCode> options={ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))} value={f.role_code} onChange={(v) => set({ role_code: v })} />
            </Layout.Stack>
            <Layout.Stack gap="xs">
              <Text variant="sm" color="secondary">{t("manager")}</Text>
              <Select<string>
                options={[{ value: "", label: t("none") }, ...managers.map((m) => ({ value: m.id, label: m.full_name }))]}
                renderOption={personOption} renderValue={personOption}
                value={f.manager_id ?? ""}
                status={show("manager") ? "error" : undefined}
                onChange={(v) => set({ manager_id: v || null })}
              />
              {show("manager") ? <Text variant="sm" color="danger">{t("problem.manager")}</Text> : null}
            </Layout.Stack>
          </Layout.Grid>
          {f.user_id ? (
            <Toggle isChecked={f.status === "active"} onChange={(on) => set({ status: on ? "active" : "left" })}>{t("active")}</Toggle>
          ) : null}
          {error ? <Alert variant="error" size="compact" title={t("common.error")} description={error} /> : null}
        </Layout.Stack>
      </Card.Content>
      <Card.Footer>
        <Layout.Row gap="sm">
          <Button variant="tertiary" onClick={p.onCancel}>{t("cancel")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>{f.user_id ? t("save") : t("sendInvite")}</Button>
        </Layout.Row>
      </Card.Footer>
    </Card>
  );
}
