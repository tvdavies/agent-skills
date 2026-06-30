import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	type ProvisionConfig,
	renderEnvFile,
	renderInstallInstructions,
	renderLauncher,
	renderSystemdUnit,
} from "./provision";

const cfg: ProvisionConfig = {
	instance: "agent-toolkit",
	repoDir: "/home/tom/agent-toolkit",
	daemonEntry: "/home/tom/agent-toolkit/bin/toolkit-daemon.ts",
	runtime: "node --experimental-transform-types --no-warnings",
	stateDir: "/home/tom/.local/state/agent-toolkit",
	sessionDir: "/home/tom/.local/state/agent-toolkit/sessions",
	brainRoot: "/home/tom/.local/share/agent-toolkit/brain",
	envFile: "/home/tom/.config/agent-toolkit/serve.env",
	model: "anthropic/claude-opus-4-8",
	user: "tom",
	nodeBinDir: "/home/tom/.nvm/v24/bin",
	piBin: "/home/tom/.nvm/v24/bin/pi",
	brainBin: "/home/tom/agent-toolkit/bin/brain",
};

describe("renderEnvFile", () => {
	it("exports toolkit paths and leaves secrets commented", () => {
		const out = renderEnvFile(cfg);
		expect(out).toContain("export AGENT_TOOLKIT_STATE_DIR=/home/tom/.local/state/agent-toolkit");
		expect(out).toContain("export AGENT_TOOLKIT_BRAIN_ROOT=/home/tom/.local/share/agent-toolkit/brain");
		expect(out).toContain("export AGENT_TOOLKIT_MODEL=anthropic/claude-opus-4-8");
		expect(out).toContain("export PATH=/home/tom/.nvm/v24/bin:$PATH");
		expect(out).toContain("export AGENT_TOOLKIT_PI_BIN=/home/tom/.nvm/v24/bin/pi");
		expect(out).toContain("export AGENT_TOOLKIT_BRAIN_BIN=/home/tom/agent-toolkit/bin/brain");
		expect(out).toContain("# export SLACK_APP_TOKEN=");
	});

	it("adds the user bin dir to PATH so the service finds tadu", () => {
		const out = renderEnvFile({ ...cfg, userBinDir: "/home/tom/.local/bin" });
		expect(out).toContain("export PATH=/home/tom/.nvm/v24/bin:/home/tom/.local/bin:$PATH");
	});

	it("puts bun on PATH and exports AGENT_TOOLKIT_BUN_BIN (the self-update validate gate)", () => {
		const out = renderEnvFile({ ...cfg, bunBin: "/home/tom/.bun/bin/bun" });
		expect(out).toContain("/home/tom/.bun/bin:$PATH");
		expect(out).toContain("export AGENT_TOOLKIT_BUN_BIN=/home/tom/.bun/bin/bun");
	});

	it("shell-quotes exported paths with spaces and metacharacters", () => {
		const weird = {
			...cfg,
			stateDir: "/tmp/agent toolkit/$state;rm",
			brainRoot: "/tmp/brain root/it's-private",
			sessionDir: "/tmp/sessions & traces",
			brainBin: "/tmp/agent toolkit/bin/brain",
			nodeBinDir: "/tmp/node bin",
			bunBin: "/tmp/bun bin/bun",
			userBinDir: "/tmp/user bin",
		};
		const out = renderEnvFile(weird);
		const r = spawnSync(
			"bash",
			[
				"-c",
				`${out}\nprintf '%s\\0' "$AGENT_TOOLKIT_STATE_DIR" "$AGENT_TOOLKIT_BRAIN_ROOT" "$AGENT_TOOLKIT_SESSION_DIR" "$AGENT_TOOLKIT_BRAIN_BIN" "$PATH"`,
			],
			{ encoding: "utf8", env: { PATH: "/usr/bin" } },
		);
		expect(r.status).toBe(0);
		const [state, brainRoot, sessionDir, brainBin, path] = r.stdout.split("\0");
		expect(state).toBe(weird.stateDir);
		expect(brainRoot).toBe(weird.brainRoot);
		expect(sessionDir).toBe(weird.sessionDir);
		expect(brainBin).toBe(weird.brainBin);
		expect(path).toBe("/tmp/node bin:/tmp/user bin:/tmp/bun bin:/usr/bin");
	});
});

describe("renderLauncher", () => {
	it("guards env-file permissions and execs the daemon", () => {
		const out = renderLauncher(cfg);
		expect(out).toContain("#!/usr/bin/env bash");
		expect(out).toContain("set -euo pipefail");
		expect(out).toContain("refusing to start");
		expect(out).toContain('source "$ENV_FILE"');
		expect(out).toContain("exec node --experimental-transform-types --no-warnings /home/tom/agent-toolkit/bin/toolkit-daemon.ts");
		expect(out).not.toContain("toolkit-preflight"); // omitted when no preflightEntry
	});

	it("runs the self-update preflight before the daemon when configured", () => {
		const out = renderLauncher({ ...cfg, preflightEntry: "/home/tom/agent-toolkit/bin/toolkit-preflight.ts" });
		// Preflight runs first (best-effort), then the daemon execs.
		const pre = out.indexOf("toolkit-preflight.ts");
		const exec = out.indexOf("exec node");
		expect(pre).toBeGreaterThan(-1);
		expect(pre).toBeLessThan(exec);
		expect(out).toContain("/home/tom/agent-toolkit/bin/toolkit-preflight.ts || true");
	});
});

describe("renderSystemdUnit", () => {
	it("is a Restart=always simple service for the daemon", () => {
		const out = renderSystemdUnit(cfg, "/home/tom/.config/agent-toolkit/launch.sh");
		expect(out).toContain("Description=Agent Toolkit daemon (agent-toolkit)");
		expect(out).toContain("Type=simple");
		expect(out).toContain("Restart=always");
		expect(out).toContain("ExecStart=/home/tom/.config/agent-toolkit/launch.sh");
		expect(out).toContain("WorkingDirectory=/home/tom/agent-toolkit");
		expect(out).toContain("WantedBy=default.target");
		expect(out).toContain("NoNewPrivileges=yes");
	});

	it("quotes systemd paths with spaces and escapes percent specifiers", () => {
		const out = renderSystemdUnit({ ...cfg, repoDir: "/home/tom/agent toolkit/%repo" }, "/home/tom/agent toolkit/launch.sh");
		expect(out).toContain('ExecStart="/home/tom/agent toolkit/launch.sh"');
		expect(out).toContain('WorkingDirectory="/home/tom/agent toolkit/%%repo"');
		expect(out).toContain("WantedBy=default.target");
		expect(out).toContain("NoNewPrivileges=yes");
	});
});

describe("renderInstallInstructions", () => {
	it("lists the manual, deferred install steps", () => {
		const out = renderInstallInstructions(cfg, {
			unit: "/tmp/agent-toolkit.service",
			launcher: "/home/tom/.config/agent-toolkit/launch.sh",
			envFile: "/home/tom/.config/agent-toolkit/serve.env",
		});
		expect(out).toContain("systemctl --user enable --now agent-toolkit.service");
		expect(out).toContain("loginctl enable-linger tom");
		expect(out).toContain("install -m 600 /dev/null");
	});
});
