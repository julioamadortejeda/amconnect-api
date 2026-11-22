// Uso: deno run --allow-read scripts/eval/tool_selection/compare.ts results/a.json results/b.json
import { compareMarkdown, type ResultsFile } from "./lib.ts";

const [a, b] = Deno.args;
if (!a || !b) {
  console.error("Usage: compare.ts <results-a.json> <results-b.json>");
  Deno.exit(1);
}
const load = async (p: string) => JSON.parse(await Deno.readTextFile(p)) as ResultsFile;
console.log(compareMarkdown(await load(a), await load(b)));
