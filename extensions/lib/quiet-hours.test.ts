import { describe, expect, it } from "bun:test";
import { parseHoursWindow } from "../heartbeat/schedule-gate";
import { quietHoursDelivery } from "./quiet-hours";

// 23:00–07:00 overnight window; local-time constructor keeps assertions tz-independent.
const window = parseHoursWindow("23:00-07:00");
const at = (h: number, m = 0) => new Date(2026, 5, 24, h, m, 0);

describe("quietHoursDelivery", () => {
	it("delivers everything when no window is configured", () => {
		expect(quietHoursDelivery("info", undefined, at(2))).toBe("deliver");
		expect(quietHoursDelivery("escalate", undefined, at(2))).toBe("deliver");
	});

	it("holds routine notices inside the window", () => {
		expect(quietHoursDelivery("info", window, at(2))).toBe("hold"); // 02:00 → inside
		expect(quietHoursDelivery("info", window, at(23, 30))).toBe("hold"); // late evening → inside
	});

	it("delivers routine notices outside the window", () => {
		expect(quietHoursDelivery("info", window, at(9))).toBe("deliver"); // 09:00 → outside
		expect(quietHoursDelivery("info", window, at(7))).toBe("deliver"); // 07:00 → window end is exclusive
	});

	it("lets escalations break through even inside the window", () => {
		expect(quietHoursDelivery("escalate", window, at(2))).toBe("deliver");
		expect(quietHoursDelivery("escalate", window, at(3, 30))).toBe("deliver");
	});
});
