import { equal, assert, finish } from "./assert.js";

assert(typeof Intl === "object", "Intl requires --experimental");
equal(new Intl.NumberFormat("en-US").format(1234567.5), "1,234,567.5");
equal(new Intl.PluralRules("en-US").select(1), "one");
equal(new Intl.PluralRules("en-US").select(2), "other");
equal(new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric" }).format(new Date("2026-01-01T00:00:00Z")), "2026");
assert(typeof Temporal === "object", "Temporal requires --experimental");
equal(Temporal.PlainDate.from("2024-02-28").add({ days: 1 }).toString(), "2024-02-29");
equal(Temporal.PlainDate.from("2024-02-29").add({ days: 1 }).toString(), "2024-03-01");
equal(Temporal.Duration.from("PT1H30M").total({ unit: "minutes" }), 90);
equal(Temporal.Instant.from("2026-01-01T00:00:00Z").epochMilliseconds, 1767225600000);
finish("experimental");
