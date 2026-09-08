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
const MIGRACIONES = new URL("../supabase/migrations/", import.meta.url).pathname;
const SOMBRA = "prompt_shadow";

const rojo = (s: string) => `\x1b[31m${s}\x1b[0m`;
const verde = (s: string) => `\x1b[32m${s}\x1b[0m`;
const gris = (s: string) => `\x1b[90m${s}\x1b[0m`;
const ambar = (s: string) => `\x1b[33m${s}\x1b[0m`;

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
      const fin = sql.indexOf("\n", i);
      i = fin === -1 ? sql.length : fin;
      continue;
    }
    // Comentario de bloque
    if (sql.startsWith("/*", i)) {
      const fin = sql.indexOf("*/", i + 2);
      i = fin === -1 ? sql.length : fin + 2;
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
  await psql(`drop schema if exists ${SOMBRA} cascade; create schema ${SOMBRA};`);

  // 2 · Replicar, en orden, todo lo que toque system_prompts
  const archivos = [...Deno.readDirSync(MIGRACIONES)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();

  let aplicados = 0;
  let tocan = 0;
  for (const archivo of archivos) {
    const sql = Deno.readTextFileSync(MIGRACIONES + archivo);
    const relevantes = statements(sql).filter((s) => s.includes("system_prompts"));
    if (relevantes.length === 0) continue;
    tocan++;
    for (const st of relevantes) {
      try {
        // `extensions` va en el path porque uuid_generate_v4() vive ahi en
        // Supabase, y el `create table` de system_prompts la usa como default.
        await psql(`set search_path to ${SOMBRA}, public, extensions; ${st};`);
        aplicados++;
      } catch (e) {
        console.error(rojo(`\n✗ ${archivo}`));
        console.error(gris((e as Error).message));
        await psql(`drop schema if exists ${SOMBRA} cascade;`);
        Deno.exit(2);
      }
    }
  }
  console.log(gris(`Replicados ${aplicados} statements de ${tocan} migraciones.\n`));

  // 3 · Comparar base contra sombra
  const crudo = await psql(
    `select coalesce(s.code, p.code) as code,
            case when s.code is null then 'SOBRA_EN_BASE'
                 when p.code is null then 'FALTA_EN_BASE'
                 when s.prompt is distinct from p.prompt then 'DIFIERE'
                 else 'ok' end as estado,
            coalesce(length(p.prompt), 0) as len_base,
            coalesce(length(s.prompt), 0) as len_mig
       from ${SOMBRA}.system_prompts s
       full outer join public.system_prompts p on p.code = s.code
      order by 1`,
    ["-t", "-A", "-F", "|"],
  );

  const filas = crudo.trim().split("\n").filter(Boolean)
    .map((l) => { const [code, estado, base, mig] = l.split("|"); return { code, estado, base: +base, mig: +mig }; });

  const malas = filas.filter((f) => f.estado !== "ok");

  console.log("BASE vs MIGRACIONES");
  if (malas.length === 0) {
    console.log(verde(`  ✓ los ${filas.length} prompts salen de las migraciones\n`));
  } else {
    for (const f of malas) {
      console.log(rojo(`  ✗ ${f.code}`) + gris(`  base:${f.base}  migraciones:${f.mig}  → ${f.estado}`));
    }
    console.log(gris("\n  Hay texto en la base que ninguna migracion escribio, o al reves.\n"));
  }

  // 4 · Comparar archivo contra base (informativo)
  console.log("DEV_PROMPTS vs BASE" + gris("  (un archivo adelantado es normal: falta promoverlo)"));
  let distintos = 0;
  for (const f of filas.filter((x) => x.estado !== "FALTA_EN_BASE")) {
    const archivo = DEV_PROMPTS[f.code];
    if (archivo === undefined) { console.log(ambar(`  · ${f.code}`) + gris("  no esta en dev_prompts.ts")); distintos++; continue; }
    const base = (await psql(`select prompt from public.system_prompts where code = '${f.code}'`, ["-t", "-A"])).replace(/\n$/, "");
    if (archivo !== base) {
      const quien = archivo.length > base.length ? "archivo adelantado" : "archivo atrasado";
      console.log(ambar(`  · ${f.code}`) + gris(`  archivo:${archivo.length}  base:${base.length}  → ${quien}`));
      distintos++;
    }
  }
  if (distintos === 0) console.log(verde("  ✓ identicos"));

  await psql(`drop schema if exists ${SOMBRA} cascade;`);
  Deno.exit(malas.length > 0 ? 1 : 0);
}

await main();
