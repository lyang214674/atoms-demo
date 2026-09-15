import type { Plan } from "../shared/types";

export const PLANNER_SYSTEM = `You are the Planner agent of a small AI product team that builds single-page web apps.
Turn the user's idea into a concise, buildable plan for ONE self-contained HTML file.
Reply with ONLY a JSON object, no prose, using exactly this shape:
{
  "app_name": "short name",
  "summary": "one sentence describing what the app does",
  "features": ["3-6 concrete features the first version must have"],
  "sections": ["UI sections / screens, top to bottom"],
  "data_model": ["what is stored in localStorage and its shape"],
  "style": "one line on visual style (colors, mood, layout)"
}
Rules: keep scope small enough to implement in one file; prefer features that create real interaction (input, state change, persistence in localStorage). Write the values in the same language the user wrote in.`;

export const BUILDER_SYSTEM = `You are the Builder agent. You write production-quality, self-contained single-file web apps.
Output ONLY a complete HTML document starting with <!doctype html> and ending with </html>. No markdown fences, no explanation.
Hard rules:
- Everything inline: <style> and <script> inside the file. You MAY use Tailwind via <script src="https://cdn.tailwindcss.com"></script> and Google Fonts. No other external scripts, no frameworks, no modules, no imports.
- Vanilla JavaScript only. Wrap logic in an IIFE or DOMContentLoaded. Never reference undefined globals.
- Persist user data with localStorage under a namespaced key. Load it on start.
- Must be fully interactive and functional: every button and input in the plan works. No placeholder "TODO" text, no lorem ipsum.
- Responsive layout that works at 375px and 1280px widths. Include an empty state when there is no data.
- Handle errors gracefully; never leave the page blank.
- The <title> must be the app name.
Size budget (strict): the whole file must stay under 20,000 characters. Use Tailwind utility classes instead of custom CSS wherever possible, write compact JavaScript, and do NOT add code comments or explanatory HTML comments. Finish the document — an unfinished file is a failure.`;

export const REVIEWER_SYSTEM = `You are the Reviewer agent. You check a generated single-file HTML app against its plan.
Reply with ONLY a JSON object:
{
  "verdict": "pass" | "warn",
  "checks": [{"name": "short check", "ok": true|false, "note": "optional"}],
  "notes": "one or two sentences for the user"
}
Check at least: every planned feature is present; localStorage persistence exists; no external script other than Tailwind CDN / Google Fonts; no obvious JS errors (undefined ids, unclosed tags); empty state exists; layout is responsive. Be strict but concise. Write notes in the user's language.`;

export function plannerUser(idea: string, previous?: { plan: Plan | null; message: string }) {
  if (!previous) return `User idea:\n${idea}`;
  return `The user already has an app built from this plan:\n${JSON.stringify(previous.plan, null, 2)}\n\nThe user now asks for this change:\n${idea}\n\nReturn the UPDATED full plan (same JSON shape) reflecting the change. Keep unchanged parts stable.`;
}

export function builderUser(plan: Plan, change?: { previousHtml: string; message: string }) {
  const planText = `Plan:\n${JSON.stringify(plan, null, 2)}`;
  if (!change) return `${planText}\n\nBuild the complete app now.`;
  return `${planText}\n\nThis is the current version of the app:\n\n${change.previousHtml}\n\nApply this change request from the user: "${change.message}"\nReturn the COMPLETE updated HTML document (not a diff). Preserve existing behavior and stored data keys unless the change requires otherwise.`;
}

export function reviewerUser(plan: Plan, html: string) {
  return `Plan:\n${JSON.stringify(plan, null, 2)}\n\nGenerated HTML:\n${html}`;
}

/** Cheap static checks that run even if the reviewer model is skipped. */
export function staticChecks(html: string) {
  const checks: { name: string; ok: boolean; note?: string }[] = [];
  checks.push({ name: "以 <!doctype html> 开头", ok: /^<!doctype html/i.test(html.trim()) });
  checks.push({ name: "包含 </html> 结尾", ok: /<\/html>\s*$/i.test(html.trim()) });
  checks.push({ name: "包含 <script>", ok: /<script[\s>]/i.test(html) });
  checks.push({ name: "使用 localStorage 持久化", ok: /localStorage/.test(html) });
  const externals = [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const bad = externals.filter((u) => !/cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u));
  checks.push({ name: "无未允许的外部脚本", ok: bad.length === 0, note: bad.length ? bad.join(", ") : undefined });
  return checks;
}
