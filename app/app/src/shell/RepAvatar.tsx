import { Avatar, AvatarFallback, Layout, Text } from "@wonderful/ui-base";
import type { ReactNode } from "react";

/** Up to two initials of a person's name ("Nikos Pappas" -> "NP"). */
export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Initials avatar for a salesperson (app_user has no photo). */
export default function RepAvatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <Avatar className={small ? "size-6 text-xs" : undefined}>
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * `renderOption` / `renderValue` for a Select whose options are people: avatar + name. Options with an empty value
 * ("All", "None") stay plain text.
 */
export const personOption = (o: { value: string; label: string }): ReactNode =>
  o.value ? (
    <Layout.Row gap="xs">
      <RepAvatar name={o.label} small />
      <Text variant="sm">{o.label}</Text>
    </Layout.Row>
  ) : (
    o.label
  );
