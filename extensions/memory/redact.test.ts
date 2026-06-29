import { describe, expect, it } from "bun:test";
import { redact, redactMessages } from "./redact";

// Assemble token fixtures from parts so no contiguous real-looking secret appears in
// source (which trips GitHub push-protection); redact() still gets the full string.
const tok = (...parts: string[]) => parts.join("");

// A long fake value used wherever a credential value is needed.
const V = "abcdef0123456789ABCDEFghijklmnop";
const HEX40 = "0123456789abcdef0123456789abcdef01234567";

// Real-world secret formats (from the adversarial review). Each `text` embeds a fake
// secret `value`; redaction MUST remove that value.
const CASES: Array<{ name: string; value: string; text: string }> = [
	{ name: "bare API_KEY=", value: V, text: `API_KEY=${V}` },
	{ name: "prefixed MY_API_KEY=", value: V, text: `MY_API_KEY=${V}` },
	{ name: "AWS_SECRET_ACCESS_KEY=", value: V, text: `AWS_SECRET_ACCESS_KEY=${V}` },
	{ name: "STRIPE_SECRET_KEY=", value: V, text: `STRIPE_SECRET_KEY=${V}` },
	{ name: "DATABASE_PASSWORD=", value: "Sup3rS3cretPass", text: "DATABASE_PASSWORD=Sup3rS3cretPass" },
	{ name: "DJANGO_SECRET_KEY=", value: "django-insecure-xyz123abc456", text: "DJANGO_SECRET_KEY=django-insecure-xyz123abc456" },
	{ name: "GITHUB_TOKEN=", value: V, text: `GITHUB_TOKEN=${V}` },
	{ name: "quoted JSON api_key", value: V, text: `"api_key": "${V}"` },
	{ name: "yaml client_secret", value: V, text: `client_secret: ${V}` },
	{ name: "Azure AccountKey=", value: tok(V, "=="), text: `DefaultEndpointsProtocol=https;AccountKey=${tok(V, "==")};EndpointSuffix=core.windows.net` },
	{ name: "postgres url password", value: "s3cretpw", text: "postgres://app:s3cretpw@db.host:5432/mydb" },
	{ name: "mongodb+srv url password", value: "p@ss-no", text: "mongodb+srv://user:p@ss-no@cluster0.mongodb.net" },
	{ name: "redis url password", value: "redispw123", text: "redis://default:redispw123@redis.host:6379" },
	{ name: "AWS access key id", value: tok("AKIA", "IOSFODNN7EXAMPLE"), text: `aws id ${tok("AKIA", "IOSFODNN7EXAMPLE")}` },
	{ name: "AWS temp ASIA id", value: tok("ASIA", "IOSFODNN7EXAMPLE"), text: `temp ${tok("ASIA", "IOSFODNN7EXAMPLE")}` },
	{ name: "AWS 40-char secret (standalone)", value: tok("wJalrXUtnFEMI", "K7MDENGbPxRfiCYEX", "AMPLEKEYabcd"), text: `key: ${tok("wJalrXUtnFEMI", "K7MDENGbPxRfiCYEX", "AMPLEKEYabcd")}` },
	{ name: "Stripe sk_live_", value: tok("sk_", "live_", "51H8xQ2eZvKYlo2C0abcdefghij"), text: `stripe ${tok("sk_", "live_", "51H8xQ2eZvKYlo2C0abcdefghij")}` },
	{ name: "OpenAI sk-proj-", value: tok("sk-", "proj-", "AbCdEf0123456789ghijklmnop"), text: `openai ${tok("sk-", "proj-", "AbCdEf0123456789ghijklmnop")}` },
	{ name: "Anthropic sk-ant-", value: tok("sk-", "ant-", "api03-", "abcdef0123456789ABCDEF"), text: `claude ${tok("sk-", "ant-", "api03-", "abcdef0123456789ABCDEF")}` },
	{ name: "Slack xoxb-", value: tok("xox", "b-1234567890-abcdefghijklmno"), text: `slack ${tok("xox", "b-1234567890-abcdefghijklmno")}` },
	{ name: "Slack xapp-", value: tok("x", "app-1-A012-345-abcdefghij"), text: `slack ${tok("x", "app-1-A012-345-abcdefghij")}` },
	{ name: "GitHub ghp_", value: tok("ghp", "_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"), text: `gh ${tok("ghp", "_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")}` },
	{ name: "github_pat_", value: tok("github", "_pat_11ABCDEFG0abcdefghij_klmnopqrstuvwxyz"), text: `pat ${tok("github", "_pat_11ABCDEFG0abcdefghij_klmnopqrstuvwxyz")}` },
	{ name: "npm token", value: tok("npm", "_abcdefghijklmnopqrstuvwxyz0123456789"), text: `npm ${tok("npm", "_abcdefghijklmnopqrstuvwxyz0123456789")}` },
	{ name: "Google API key", value: tok("AIza", "SyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"), text: `g ${tok("AIza", "SyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")}` },
	{ name: "Google OAuth ya29.", value: tok("ya29", ".A0ARrdaM-abcdefghijklmnopqrstuvwxyz"), text: `oauth ${tok("ya29", ".A0ARrdaM-abcdefghijklmnopqrstuvwxyz")}` },
	{ name: "Google client secret GOCSPX-", value: tok("GOCSPX-", "abcdefghijklmnopqrstuvwx"), text: `cs ${tok("GOCSPX-", "abcdefghijklmnopqrstuvwx")}` },
	{ name: "high-entropy hex blob", value: HEX40, text: `digest ${HEX40}` },
	{ name: "PEM private key", value: "MIIBOQIBAAJ", text: `${tok("-----BEGIN RSA ", "PRIVATE KEY-----")}\nMIIBOQIBAAJ\n${tok("-----END RSA ", "PRIVATE KEY-----")}` },
];

describe("redact — real-world secret formats", () => {
	for (const c of CASES) {
		it(`redacts: ${c.name}`, () => {
			const out = redact(c.text);
			expect(out).not.toContain(c.value);
		});
	}
});

describe("redact — false positives (do not mangle ordinary prose)", () => {
	it("leaves plain prose untouched", () => {
		for (const prose of [
			"Always run bun test, never npm. The worker pool is daemon/worker-pool.ts.",
			"We restart the daemon with systemctl --user restart agent-toolkit.",
			"The PR adds a token bucket rate limiter to the API gateway.",
			"Open the file at src/components/Header.tsx and update the layout.",
		]) {
			expect(redact(prose)).toBe(prose);
		}
	});
});

describe("redactMessages", () => {
	it("redacts message content only, preserving role + other fields", () => {
		const msgs = [{ role: "user", content: `key API_KEY=${V} here`, extra: 1 }];
		const out = redactMessages(msgs);
		expect(out[0]?.content).not.toContain(V);
		expect(out[0]?.content).toContain("[REDACTED]");
		expect(out[0]?.role).toBe("user");
		expect((out[0] as { extra?: number }).extra).toBe(1);
	});
});
