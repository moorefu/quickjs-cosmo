import Point, { answer, sum } from "./fixtures/math.js";
import settings from "./fixtures/settings.json" with { type: "json" };
import { equal, assert, finish } from "./assert.js";

equal(answer, 42);
equal(sum([10, 20, 12]), 42);
equal(new Point(3, 4).length, 5);
equal(settings.engine, "QuickJS");
assert(settings.portable);
equal(settings.answer, answer);
const dynamic = await import("./fixtures/math.js");
equal(dynamic.answer, answer);
equal(dynamic.default, Point);
equal((await Promise.resolve({ value: 42 })).value, 42);
assert(import.meta.url.endsWith("/modules.js"));
finish("modules");
