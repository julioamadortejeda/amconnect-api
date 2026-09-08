/**
 * Comprueba que los prompts de la base salgan de las migraciones.
 *
 * Por que existe: el 5 de septiembre de 2026 aparecieron ~1,330 caracteres en
 * tres prompts de ingesta de la base local que ninguna migracion escribio.
 * Llevaban semanas ahi, nadie los puso a proposito, y se encontraron de
 * casualidad. Esto los habria gritado el mismo dia.
 *
 * Como: crea un esquema sombra en la MISMA base —no una base nueva, porque 20
 * migraciones dependen de objetos de la plataforma Supabase (esquema auth,
 * roles, vault) que una base vacia no tiene— y le replica, en orden, cada
 * statement de cada migracion que toque `system_prompts`. Ninguna migracion
 * califica la tabla como `public.system_prompts`, asi que basta con apuntar el
 * `search_path` a la sombra para que caigan ahi. Al final compara y borra.
 *
 * Dos comparaciones, con peso distinto:
 *   BASE vs MIGRACIONES  -> deriva. Es un error: hay texto sin versionar.
 *   ARCHIVO vs BASE      -> informativo. Un prompt adelantado en
 *                           dev_prompts.ts es el flujo normal: se itera en el
 *                           archivo y se promueve con migracion cuando queda.
 *
 * Uso:  deno task prompts:check     (o directo con deno run -A)
 */

import { DEV_PROMPTS } from "../supabase/functions/amconnect-api/prompts/dev_prompts.ts";

const DB = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url).pathname;
const SHADOW = "prompt_shadow";

const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const gray = (s: string) => `\x1b[90m${s}\x1b[0m`;
const amber = (s: string) => `\x1b[33m${s}\x1b[0m`;

async function psql(sql: string, args: string[] = []): Promise<string> {
  const cmd = new Deno.Command("psql", {
    args: [DB, "-v", "ON_ERROR_STOP=1", "-q", ...args, "-c", sql],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  if (code !== 0) throw new Error(new TextDecoder().decode(stderr).trim());
  return new TextDecoder().decode(stdout);
}

/**
 * Parte un archivo SQL en statements.
 *
 * Hace falta un tokenizador y no un `split(";")` porque los prompts van dentro
 * de bloques `$tag$...$tag$` y su texto trae puntos y coma, comillas y guiones
 * dobles que no delimitan nada.
 */
function statements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let tag: string | null = null;

  while (i < sql.length) {
    if (tag) {
      if (sql.startsWith(tag, i)) { buf += tag; i += tag.length; tag = null; continue; }
      buf += sql[i++];
      continue;
    }
    // Comentario de linea
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    // Comentario de bloque
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    // Cadena entre comillas simples ('' escapa)
    if (sql[i] === "'") {
      buf += sql[i++];
      while (i < sql.length) {
        buf += sql[i];
        if (sql[i] === "'" && sql[i + 1] !== "'") { i++; break; }
        if (sql[i] === "'" && sql[i + 1] === "'") { buf += sql[++i]; }
        i++;
      }
      continue;
    }
    // Apertura de dollar quote: $tag$ o $$
    const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
    if (m) { tag = m[0]; buf += tag; i += tag.length; continue; }

    if (sql[i] === ";") { out.push(buf.trim()); buf = ""; i++; continue; }
    buf += sql[i++];
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => s.length > 0);
}

async function main() {
  // 1 · Sombra limpia
  await psql(`drop schema if exists ${SHADOW} cascade; create schema ${SHADOW};`);

  // 2 · Replicar, en orden, todo lo que toque system_prompts
  const files = [...Deno.readDirSync(MIGRATIONS_DIR)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();

  let applied = 0;
  let touched = 0;
  for (const file of files) {
    const sql = Deno.readTextFileSync(MIGRATIONS_DIR + file);
    const relevant = statements(sql).filter((s) => s.includes("system_prompts"));
    if (relevant.length === 0) continue;
    touched++;
    for (const st of relevant) {
      try {
        // `extensions` va en el path porque uuid_generate_v4() vive ahi en
        // Supabase, y el `create table` de system_prompts la usa como default.
        await psql(`set search_path to ${SHADOW}, public, extensions; ${st};`);
        applied++;
      } catch (e) {
        console.error(red(`\n✗ ${file}`));
        console.error(gray((e as Error).message));
        await psql(`drop schema if exists ${SHADOW} cascade;`);
        Deno.exit(2);
      }
    }
  }
  console.log(gray(`Replicados ${applied} statements de ${touched} migraciones.\n`));

  // 3 · Comparar base contra sombra
  const rawRows = await psql(
    `select coalesce(s.code, p.code) as code,
            case when s.code is null then 'SOBRA_EN_BASE'
                 when p.code is null then 'FALTA_EN_BASE'
                 when s.prompt is distinct from p.prompt then 'DIFIERE'
                 else 'ok' end as estado,
            coalesce(length(p.prompt), 0) as len_base,
            coalesce(length(s.prompt), 0) as len_mig
       from ${SHADOW}.system_prompts s
       full outer join public.system_prompts p on p.code = s.code
      order by 1`,
    ["-t", "-A", "-F", "|"],
  );

  const rows = rawRows.trim().split("\n").filter(Boolean)
    .map((l) => { const [code, estado, base, mig] = l.split("|"); return { code, estado, base: +base, mig: +mig }; });

  const bad = rows.filter((f) => f.estado !== "ok");

  console.log("BASE vs MIGRACIONES");
  if (bad.length === 0) {
    console.log(green(`  ✓ los ${rows.length} prompts salen de las migraciones\n`));
  } else {
    for (const f of bad) {
      console.log(red(`  ✗ ${f.code}`) + gray(`  base:${f.base}  migraciones:${f.mig}  → ${f.estado}`));
    }
    console.log(gray("\n  Hay texto en la base que ninguna migracion escribio, o al reves.\n"));
  }

  // 4 · Comparar archivo contra base (informativo)
  console.log("DEV_PROMPTS vs BASE" + gray("  (un archivo adelantado es normal: falta promoverlo)"));
  let differences = 0;
  for (const f of rows.filter((x) => x.estado !== "FALTA_EN_BASE")) {
    const fromFile = DEV_PROMPTS[f.code];
    if (fromFile === undefined) { console.log(amber(`  · ${f.code}`) + gray("  no esta en dev_prompts.ts")); differences++; continue; }
    const base = (await psql(`select prompt from public.system_prompts where code = '${f.code}'`, ["-t", "-A"])).replace(/\n$/, "");
    if (fromFile !== base) {
      const direction = fromFile.length > base.length ? "archivo adelantado" : "archivo atrasado";
      console.log(amber(`  · ${f.code}`) + gray(`  archivo:${fromFile.length}  base:${base.length}  → ${direction}`));
      differences++;
    }
  }
  if (differences === 0) console.log(green("  ✓ identicos"));

  await psql(`drop schema if exists ${SHADOW} cascade;`);
  Deno.exit(bad.length > 0 ? 1 : 0);
}

await main();
