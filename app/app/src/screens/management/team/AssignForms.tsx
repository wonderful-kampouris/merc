import { Button, Card, InputText, Layout, Notice, Select, Text } from "@wonderful/ui-base";
import { useState } from "react";
import type { AccountRef, UserRef } from "../../../contracts";
import type { MercClient } from "../../../lib/client";
import {
  taskAssignRequest,
  tomorrow,
  validateTask,
  validateVisit,
  visitAssignRequest,
  type TaskForm,
  type VisitForm,
} from "./logic";

type T = (key: string, vars?: Record<string, string | number>) => string;
type Outcome = { ok: true; text: string } | { ok: false; text: string } | null;

const errText = (t: T, e: unknown) => t("err_save", { msg: e instanceof Error ? e.message : String(e) });

/** Assign a visit to the selected rep (fn:visit-assign, REQ-PLN-004). */
export function AssignVisit({ rep, accounts, client, t, today }: { rep: UserRef; accounts: readonly AccountRef[]; client: MercClient; t: T; today: string }) {
  const [form, setForm] = useState<VisitForm>({ account_id: accounts[0]?.id ?? null, date: tomorrow(), purpose: "" });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const problem = validateVisit(form, today);

  const submit = async () => {
    setTouched(true);
    if (problem) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await client.call("visit-assign", visitAssignRequest(rep.id, form));
      const account = accounts.find((a) => a.id === form.account_id)?.name ?? res.visit.account.name;
      setOutcome({ ok: true, text: t("visit_ok", { account, date: form.date, name: rep.full_name }) });
      setForm((f) => ({ ...f, purpose: "" }));
      setTouched(false);
    } catch (e) {
      setOutcome({ ok: false, text: errText(t, e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Card.Header title={t("assign_visit")} />
      <Card.Content>
        <Layout.Stack gap="sm">
          <Layout.Stack gap="xs">
            <Text variant="sm" color="secondary">{t("account")}</Text>
            <Select
              aria-label={t("account")}
              placeholder={t("account_placeholder")}
              options={accounts.map((a) => ({ value: a.id, label: a.city ? `${a.name} · ${a.city}` : a.name }))}
              value={form.account_id ?? undefined}
              onChange={(v) => setForm((f) => ({ ...f, account_id: String(v) }))}
              isSearchable
              status={touched && problem === "account_required" ? "error" : undefined}
            />
          </Layout.Stack>
          <InputText
            label={t("date")}
            type="date"
            min={today}
            value={form.date}
            isError={touched && (problem === "date_required" || problem === "date_past")}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
          <InputText label={t("purpose")} value={form.purpose} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} />
          {touched && problem ? <Text variant="sm" color="danger">{t(`err_${problem}`)}</Text> : null}
          {outcome ? <Notice variant={outcome.ok ? "info" : "warning"} size="compact" description={outcome.text} /> : null}
        </Layout.Stack>
      </Card.Content>
      <Card.Footer>
        <Button variant="primary" className="w-full" loading={busy} onClick={() => void submit()}>
          {t("submit_visit", { name: rep.full_name })}
        </Button>
      </Card.Footer>
    </Card>
  );
}

const NONE = "__none__";

/** Assign a task to the selected rep (fn:task-assign, REQ-PLN-004). */
export function AssignTask({ rep, accounts, client, t }: { rep: UserRef; accounts: readonly AccountRef[]; client: MercClient; t: T }) {
  const [form, setForm] = useState<TaskForm>({ title: "", due: "", account_id: null });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const problem = validateTask(form);

  const submit = async () => {
    setTouched(true);
    if (problem) return;
    setBusy(true);
    setOutcome(null);
    try {
      await client.call("task-assign", taskAssignRequest(rep.id, form));
      setOutcome({ ok: true, text: t("task_ok", { name: rep.full_name }) });
      setForm({ title: "", due: "", account_id: null });
      setTouched(false);
    } catch (e) {
      setOutcome({ ok: false, text: errText(t, e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Card.Header title={t("assign_task")} />
      <Card.Content>
        <Layout.Stack gap="sm">
          <InputText
            label={t("task_title")}
            placeholder={t("task_placeholder")}
            value={form.title}
            maxLength={200}
            isError={touched && (problem === "title_required" || problem === "title_too_long")}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <InputText label={t("due")} type="date" value={form.due} isError={touched && problem === "due_invalid"} onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))} />
          <Layout.Stack gap="xs">
            <Text variant="sm" color="secondary">{t("account")}</Text>
            <Select
              aria-label={t("account")}
              options={[{ value: NONE, label: t("account_none") }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
              value={form.account_id ?? NONE}
              onChange={(v) => setForm((f) => ({ ...f, account_id: v === NONE ? null : String(v) }))}
            />
          </Layout.Stack>
          {touched && problem ? <Text variant="sm" color="danger">{t(`err_${problem}`)}</Text> : null}
          {outcome ? <Notice variant={outcome.ok ? "info" : "warning"} size="compact" description={outcome.text} /> : null}
        </Layout.Stack>
      </Card.Content>
      <Card.Footer>
        <Button variant="primary" className="w-full" loading={busy} onClick={() => void submit()}>
          {t("submit_task", { name: rep.full_name })}
        </Button>
      </Card.Footer>
    </Card>
  );
}
