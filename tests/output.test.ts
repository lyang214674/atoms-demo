import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHtml, extractJson } from "../worker/util.ts";
import { staticChecks } from "../worker/prompts.ts";
import { injectStorageShim } from "../shared/storageShim.ts";

const doc = "<!doctype html>\n<html><head><title>t</title></head><body><script>localStorage.setItem('a','1')</script></body></html>";

test("extractHtml: strips fences, leading prose and reasoning blocks", () => {
  assert.equal(extractHtml("```html\n" + doc + "\n```"), doc);
  assert.equal(extractHtml("Here is your app:\n" + doc + "\nHope it helps"), doc);
  assert.equal(extractHtml("<think>planning…</think>" + doc), doc);
  assert.equal(extractHtml("```html\n" + doc), doc, "unterminated fence still yields the document");
});

test("extractJson: tolerant of fences, prose and reasoning blocks", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"verdict":"pass","checks":[]} done'), { verdict: "pass", checks: [] });
  assert.deepEqual(extractJson("<think>hmm</think>{\"x\":true}"), { x: true });
  assert.equal(extractJson("no json here"), null);
});

test("staticChecks: flags missing pieces and disallowed external scripts", () => {
  const good = staticChecks(doc);
  assert.ok(good.every((c) => c.ok), JSON.stringify(good));

  const bad = staticChecks('<html><body><script src="https://cdn.evil.com/x.js"></script></body></html>');
  const byName = Object.fromEntries(bad.map((c) => [c.name, c]));
  assert.equal(byName["以 <!doctype html> 开头"].ok, false);
  assert.equal(byName["使用 localStorage 持久化"].ok, false);
  assert.equal(byName["无未允许的外部脚本"].ok, false);
  assert.match(byName["无未允许的外部脚本"].note ?? "", /cdn\.evil\.com/);

  const tailwind = staticChecks('<!doctype html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><script>localStorage</script></body></html>');
  assert.equal(Object.fromEntries(tailwind.map((c) => [c.name, c.ok]))["无未允许的外部脚本"], true);
});

test("storage shim: injected once at the top of <head>, with escaped initial data", () => {
  const out = injectStorageShim(doc, { k: "</script><script>alert(1)</script>" });
  assert.equal(out.indexOf("data-atoms-shim"), out.indexOf("<head>") + "<head>".length + "<script ".length);
  assert.ok(!out.includes("</script><script>alert(1)"), "initial data must not break out of the shim script");
  assert.equal(injectStorageShim(out), out, "idempotent");
  assert.ok(injectStorageShim("<html><body></body></html>").includes("<head><script data-atoms-shim"), "adds a head when missing");
});
