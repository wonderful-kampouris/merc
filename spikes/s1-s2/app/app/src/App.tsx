import "./style.css";
import { useEffect, useRef, useState } from "react";
import { useWonderful } from "@wonderful/app-sdk";
import { Button, Card, Layout, Page, Text } from "@wonderful/ui-base";
import AppBoundary from "./AppBoundary";

/**
 * WP-SPK-01 spike (S1 + S2).
 * S1: does a Wonderful App render usably in a phone browser?
 * S2: can the Chat SDK browser-voice widget run inside the App?
 *
 * The Client SDK key below is a PUBLISHABLE key (docs: "safe to place in browser
 * code"); it is bound to agent merc-spike-voice and the allowed origins only.
 */
const SDK_KEY = "wpk_live__0gia30DGTNwmv3D7Wwp8xYSMMEZDKnx";
const AGENT_ID = "3b6867f7-7cf7-4337-a7e2-2a10ce05c5f0";
const BASE_URL = "https://default.api.greece-hackathon.sb.wonderful.ai";

type MicState = "unknown" | "granted" | "denied" | "prompt" | "unsupported" | string;

function useEnvironment() {
	const { context } = useWonderful();
	const [mic, setMic] = useState<MicState>("unknown");
	useEffect(() => {
		const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
		if (!perms?.query) {
			setMic("unsupported");
			return;
		}
		perms
			.query({ name: "microphone" as PermissionName })
			.then((status) => {
				setMic(status.state);
				status.onchange = () => setMic(status.state);
			})
			.catch(() => setMic("unsupported"));
	}, []);
	return {
		external: !!context.functionBaseUrl,
		userName: context.userName || "(anonymous)",
		userId: context.userId || "(none)",
		origin: window.location.origin,
		secure: window.isSecureContext,
		viewport: `${window.innerWidth}x${window.innerHeight}`,
		ua: navigator.userAgent,
		mic,
	};
}

// Loaded from the official Chat SDK CDN (docs: developer_platform/chat-sdk/vanilla).
// The npm package path needs an authenticated @wonderful registry at build time.
const CDN_SRC = "https://cdn.wonderful.ai/chat-sdk/latest/chat-sdk.min.js";
type ChatHandle = {
	setState: (u: { open: boolean }) => void;
	getState: () => { open: boolean };
	connection?: { status?: string; error?: unknown };
	dispose?: () => void;
};
type WonderfulGlobal = {
	createChat: (cfg: Record<string, unknown>, host?: HTMLElement) => ChatHandle;
	preload: (cfg: Record<string, unknown>) => Promise<unknown>;
};
function loadSdk(): Promise<WonderfulGlobal> {
	const w = window as unknown as { wonderful?: WonderfulGlobal };
	if (w.wonderful) return Promise.resolve(w.wonderful);
	return new Promise((resolve, reject) => {
		const el = document.createElement("script");
		el.src = CDN_SRC;
		el.onload = () => (w.wonderful ? resolve(w.wonderful) : reject(new Error("no wonderful global")));
		el.onerror = () => reject(new Error("CDN script failed to load"));
		document.head.appendChild(el);
	});
}

function VoiceWidget() {
	const hostRef = useRef<HTMLDivElement>(null);
	const chatRef = useRef<ChatHandle | null>(null);
	const [status, setStatus] = useState("loading SDK");
	useEffect(() => {
		let timer = 0;
		let cancelled = false;
		const config = {
			key: SDK_KEY,
			agentId: AGENT_ID,
			baseUrl: BASE_URL,
			modalities: ["voice"],
			title: "Merc voice test",
		};
		loadSdk()
			.then(async (sdk) => {
				if (cancelled || !hostRef.current) return;
				await sdk.preload(config).catch((e: unknown) => setStatus(`preload failed: ${String((e as Error)?.message ?? e)}`));
				const chat = sdk.createChat(config, hostRef.current);
				chatRef.current = chat;
				(window as unknown as Record<string, unknown>).__mercSpikeChat = chat;
				timer = window.setInterval(() => {
					const c = chat.connection;
					const err = c?.error ? ` (${String((c.error as Error)?.message ?? c.error)})` : "";
					setStatus(`${c?.status ?? "mounted"}${err}`);
				}, 1000);
			})
			.catch((e: unknown) => setStatus(`SDK load failed: ${String((e as Error)?.message ?? e)}`));
		return () => {
			cancelled = true;
			window.clearInterval(timer);
			chatRef.current?.dispose?.();
		};
	}, []);
	return (
		<Layout.Stack gap="sm">
			<Text variant="body-sm" color="secondary">
				Chat SDK connection: {status}
			</Text>
			<Button variant="primary" onClick={() => chatRef.current?.setState({ open: true })}>
				Open voice buddy
			</Button>
			<div ref={hostRef} />
		</Layout.Stack>
	);
}

export default function App() {
	const env = useEnvironment();
	const [probe, setProbe] = useState("not run");
	const testMic = async () => {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			stream.getTracks().forEach((t) => t.stop());
			setProbe("getUserMedia OK - microphone available");
		} catch (e) {
			setProbe(`getUserMedia failed: ${(e as Error).name} ${(e as Error).message}`);
		}
	};
	return (
		<div style={{ padding: 16 }}>
			<Page>
				<Page.Header title="Merc spike S1/S2" />
				<Page.Section>
					<AppBoundary>
						<Layout.Stack gap="lg">
							<Card>
								<Card.Header title="Hello from Merc" />
								<Card.Content>
									<Layout.Stack gap="xs">
										<Text variant="body-sm">Mode: {env.external ? "external share link" : "internal (signed-in)"}</Text>
										<Text variant="body-sm">User: {env.userName} / {env.userId}</Text>
										<Text variant="body-sm">Origin: {env.origin} (secure: {String(env.secure)})</Text>
										<Text variant="body-sm">Viewport: {env.viewport}</Text>
										<Text variant="body-sm">Mic permission: {env.mic}</Text>
										<Text variant="body-sm" color="secondary">UA: {env.ua}</Text>
									</Layout.Stack>
								</Card.Content>
								<Card.Footer>
									<Layout.Stack gap="xs">
										<Button variant="secondary" onClick={testMic}>Test microphone</Button>
										<Text variant="body-sm">Mic probe: {probe}</Text>
									</Layout.Stack>
								</Card.Footer>
							</Card>
							<Card>
								<Card.Header title="Talk to the buddy (voice)" />
								<Card.Content>
									<VoiceWidget />
								</Card.Content>
							</Card>
						</Layout.Stack>
					</AppBoundary>
				</Page.Section>
			</Page>
		</div>
	);
}
