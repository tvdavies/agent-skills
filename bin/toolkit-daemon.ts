#!/usr/bin/env -S node --experimental-transform-types --no-warnings
/**
 * toolkit-daemon — the resident-agent babysitter.
 *
 * Default: run the daemon (spawn and supervise `pi --mode rpc`, drain the
 * trigger inbox, write daemon-status.json).
 *
 * Provisioning (install is deferred — this never runs systemctl/loginctl/cron):
 *   --print-units            print the env file, launcher, systemd unit, and the
 *                            manual install steps, then exit
 *   --write-units [dir]      write those artefacts to <dir> (default
 *                            ~/.config/<instance>) and print the install steps
 *
 * Config via env: AGENT_TOOLKIT_INSTANCE, AGENT_TOOLKIT_STATE_DIR,
 * AGENT_TOOLKIT_SESSION_DIR, AGENT_TOOLKIT_BRAIN_ROOT, AGENT_TOOLKIT_MODEL,
 * AGENT_TOOLKIT_PI_BIN.
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { recordDecision, stateDir } from "../extensions/lib/decisions.ts";
import { brainRoot } from "../extensions/lib/paths.ts";
import { FileInbox } from "../daemon/inbox.ts";
import {
	type ProvisionConfig,
	renderEnvFile,
	renderInstallInstructions,
	renderLauncher,
	renderSystemdUnit,
} from "../daemon/provision.ts";
import { RpcClient } from "../daemon/rpc-client.ts";
import { Supervisor } from "../daemon/supervisor.ts";

const repoDir = join(import.meta.dirname, "..");
const instance = process.env.AGENT_TOOLKIT_INSTANCE ?? "agent-toolkit";
const state = stateDir();
const sessionDir = process.env.AGENT_TOOLKIT_SESSION_DIR ?? join(state, "sessions");
const piBin = process.env.AGENT_TOOLKIT_PI_BIN ?? "pi";
const model = process.env.AGENT_TOOLKIT_MODEL;

function provisionConfig(): ProvisionConfig {
	return {
		instance,
		repoDir,
		daemonEntry: join(repoDir, "bin", "toolkit-daemon.ts"),
		runtime: `${process.execPath} --experimental-transform-types --no-warnings`,
		stateDir: state,
		sessionDir,
		brainRoot: brainRoot(),
		envFile: join(homedir(), ".config", instance, "serve.env"),
		model,
		user: process.env.USER,
	};
}

function printUnits(): void {
	const cfg = provisionConfig();
	const launcherPath = join(homedir(), ".config", instance, "launch.sh");
	const unitPath = join(homedir(), ".config", instance, `${instance}.service`);
	console.log(`# === env file (${cfg.envFile}) ===\n${renderEnvFile(cfg)}`);
	console.log(`# === launcher (${launcherPath}) ===\n${renderLauncher(cfg)}`);
	console.log(`# === systemd unit (${unitPath}) ===\n${renderSystemdUnit(cfg, launcherPath)}`);
	console.log(
		renderInstallInstructions(cfg, {
			unit: unitPath,
			launcher: launcherPath,
			envFile: cfg.envFile,
		}),
	);
}

function writeUnits(targetDir: string): void {
	const cfg = provisionConfig();
	mkdirSync(targetDir, { recursive: true });
	const launcherPath = join(targetDir, "launch.sh");
	const unitPath = join(targetDir, `${instance}.service`);
	writeFileSync(launcherPath, renderLauncher(cfg), "utf8");
	chmodSync(launcherPath, 0o755);
	writeFileSync(unitPath, renderSystemdUnit(cfg, launcherPath), "utf8");
	if (!existsSync(cfg.envFile)) {
		mkdirSync(join(homedir(), ".config", instance), { recursive: true });
		writeFileSync(cfg.envFile, renderEnvFile(cfg), "utf8");
		chmodSync(cfg.envFile, 0o600);
	}
	console.log(`Wrote launcher and unit to ${targetDir} (nothing installed or started).`);
	console.log(
		renderInstallInstructions(cfg, {
			unit: unitPath,
			launcher: launcherPath,
			envFile: cfg.envFile,
		}),
	);
}

function runDaemon(): void {
	const inbox = new FileInbox(join(state, "inbox.jsonl"));
	const statusPath = join(state, "daemon-status.json");
	const piArgs = ["--mode", "rpc", "--continue", "--yolo", "--session-dir", sessionDir];
	if (model) piArgs.push("--model", model);

	const supervisor = new Supervisor({
		instance,
		statusPath,
		inbox,
		createClient: () =>
			new RpcClient({
				command: piBin,
				args: piArgs,
				cwd: repoDir,
				logger: (message) => console.error(message),
			}),
		onForward: (trigger) =>
			recordDecision({
				kind: "trigger",
				summary: `Forwarded trigger: ${trigger.text.slice(0, 100)}`,
				source: trigger.source,
				detail: trigger.taduTask ? { taduTask: trigger.taduTask } : undefined,
			}),
	});

	supervisor.start();
	console.error(`[toolkit-daemon] started (instance=${instance}, state=${state})`);

	const shutdown = async () => {
		console.error("[toolkit-daemon] shutting down…");
		await supervisor.stop();
		process.exit(0);
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

function main(): void {
	const arg = process.argv[2];
	switch (arg) {
		case "--print-units":
			printUnits();
			return;
		case "--write-units":
			writeUnits(process.argv[3] ?? join(homedir(), ".config", instance));
			return;
		case "--help":
		case "-h":
			console.log(
				"Usage: toolkit-daemon [--print-units | --write-units [dir]]\n\nWith no arguments, runs the daemon. Provisioning flags render install artefacts; installation is deferred (run the printed steps yourself).",
			);
			return;
		default:
			runDaemon();
	}
}

main();
