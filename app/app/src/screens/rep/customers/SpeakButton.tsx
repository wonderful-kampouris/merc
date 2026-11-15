import { Button, Icon } from "@wonderful/ui-base";
import { SpeakerHighIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Lang } from "../../../lib/i18n";

interface Synth {
  speak(u: unknown): void;
  cancel(): void;
}
const getSynth = (): Synth | undefined => (globalThis as { speechSynthesis?: Synth }).speechSynthesis;
type UtteranceCtor = new (text: string) => { lang: string; onend: (() => void) | null; onerror: (() => void) | null };
const getUtterance = (): UtteranceCtor | undefined => (globalThis as { SpeechSynthesisUtterance?: UtteranceCtor }).SpeechSynthesisUtterance;

/** Reads the spoken summary aloud with the device's own speech synthesis; hidden where there is none. */
export default function SpeakButton(props: { text: string; lang: Lang; listen: string; stop: string }) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => getSynth()?.cancel(), []);
  const synth = getSynth();
  const Utterance = getUtterance();
  if (!synth || !Utterance || !props.text.trim()) return null;
  const toggle = () => {
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const u = new Utterance(props.text);
    u.lang = props.lang === "el" ? "el-GR" : "en-GB";
    u.onend = u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  };
  return (
    <Button size="small" variant="secondary" prefix={<Icon icon={speaking ? StopIcon : SpeakerHighIcon} />} onClick={toggle}>
      {speaking ? props.stop : props.listen}
    </Button>
  );
}
