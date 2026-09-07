/**
 * Deciding what each column of an unknown export means.
 *
 * Two passes, because a header alone is not enough. `Start` may hold
 * `2026-08-21 09:00` in one file and `09:00` in another, and those are
 * different columns with the same name: the first places an entry on its own,
 * the second needs a date column beside it. So the header picks a FAMILY and
 * the values decide the exact role inside it.
 */
import type { ImportColumn, ImportColumnRole, ImportDateOrder } from "@starter/shared";
import { classifyTemporal, type TemporalKind } from "./values.js";

/** A role, or one of the two families whose role the values settle. */
type Family = ImportColumnRole | "startish" | "endish";

/**
 * Normalized header text: accents folded, parenthetical units dropped,
 * punctuation flattened to spaces.
 *
 * Folding the accents is what lets one pattern match `Durée` and `Duree`, and
 * keeps `Tätigkeit` from normalizing into two meaningless words.
 */
const normalizeHeader = (header: string): string =>
  header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Header patterns, in priority order — the first match wins, so the specific
 * two-word headers must come before the one-word ones they contain.
 *
 * The non-English aliases are here because the file that most needs importing
 * is the one exported by a tool set to the user's own language, and because
 * the same files are the ones written with semicolons and comma decimals: a
 * parser that handles those separators but not the headers above them would
 * refuse exactly the files it was built for.
 */
const HEADER_RULES: ReadonlyArray<readonly [RegExp, Family]> = [
  [/^(start|begin|from)\s+(date|day|time)$/, "startish"],
  [/^(end|finish|stop|to|until)\s+(date|day|time)$/, "endish"],
  [/^(start|started|begin|beginning|from|in)$/, "startish"],
  [/^(end|ended|finish|finished|stop|until|out)$/, "endish"],
  [/^(date|day|work\s?date|entry\s?date|spent\s?date|logged\s?date)$/, "startish"],
  [/(duration|time\s?spent|elapsed|hours|hrs|^time$)/, "duration"],
  [
    /^(description|desc|notes?|comments?|memo|details?|title|subject|summary|what|entry|activity\s?description)$/,
    "description",
  ],
  [/^(client|customer|company|account)(\s?name)?$/, "client"],
  [/^project(\s?name)?$/, "project"],
  [/^(task|sub\s?task|issue|ticket|work\s?item|activity)(\s?name)?$/, "task"],
  [/^(tags?|labels?|categor(y|ies))$/, "tags"],
  [/billable/, "billable"],
  [/(hourly|rate)/, "rate"],

  // ── the same roles, in the other languages these files come in ─────
  [/^(start|beginn|anfang|inicio|inicio\s?fecha|debut|inizio)\s?(datum|zeit|uhrzeit|hora|heure|ora)?$/, "startish"],
  [/^(ende?|schluss|fin|fine|termino)\s?(datum|zeit|uhrzeit|hora|heure|ora)?$/, "endish"],
  [/^(datum|tag|fecha|dia|date\s?du\s?jour|jour|data|giorno)$/, "startish"],
  [/^(dauer|zeitaufwand|stunden|duree|duracion|durata|horas|heures|ore)$/, "duration"],
  [
    /^(beschreibung|bemerkung|notiz(en)?|taetigkeit|tatigkeit|descripcion|description|descrizione|note|comentario|commentaire)$/,
    "description",
  ],
  [/^(kunde|kunden|auftraggeber|cliente|kundin)$/, "client"],
  [/^(projekt|proyecto|projet|progetto)$/, "project"],
  [/^(aufgabe|tarea|tache|compito)$/, "task"],
  [/^(schlagworte|schlagworter|etiketten|etiquetas|etiquettes|categoria|kategorie)$/, "tags"],
  [/(abrechenbar|fakturierbar|facturable|facturable|fatturabile)/, "billable"],
  [/(stundensatz|tarifa|taux|tariffa)/, "rate"],
];

const familyOf = (header: string): Family => {
  const text = normalizeHeader(header);
  if (!text) return "ignored";
  for (const [pattern, family] of HEADER_RULES) {
    if (pattern.test(text)) return family;
  }
  return "ignored";
};

/** The kind most of a column's values are. Empty cells do not vote. */
const columnKind = (
  rows: readonly string[][],
  index: number,
  order: ImportDateOrder,
): TemporalKind => {
  const tally: Record<TemporalKind, number> = {
    instant: 0,
    date: 0,
    time: 0,
    unknown: 0,
  };
  let seen = 0;
  for (const row of rows) {
    const value = (row[index] ?? "").trim();
    if (!value) continue;
    tally[classifyTemporal(value, order)] += 1;
    seen += 1;
    if (seen >= 50) break;
  }
  if (seen === 0) return "unknown";
  return (Object.keys(tally) as TemporalKind[]).reduce((best, kind) =>
    tally[kind] > tally[best] ? kind : best,
  );
};

const firstSample = (
  rows: readonly string[][],
  index: number,
): string | null => {
  for (const row of rows) {
    const value = (row[index] ?? "").trim();
    if (value) return value;
  }
  return null;
};

export type DetectedColumns = {
  columns: ImportColumn[];
  /** Column index per role — the only thing the row parser reads. */
  byRole: Partial<Record<ImportColumnRole, number>>;
};

/**
 * Map every column of the file to a role, honouring caller overrides.
 *
 * An override is absolute: a column the user pointed at a role keeps it even
 * if detection disagrees, and it claims that role ahead of any detected
 * column, since the user has seen the data and the heuristic has not.
 */
export function detectColumns(
  header: readonly string[],
  rows: readonly string[][],
  order: ImportDateOrder,
  overrides: ReadonlyMap<number, ImportColumnRole> = new Map(),
): DetectedColumns {
  const columns: ImportColumn[] = header.map((text, index) => ({
    index,
    header: text,
    role: "ignored",
    overridden: overrides.has(index),
    sample: firstSample(rows, index),
  }));

  const byRole: Partial<Record<ImportColumnRole, number>> = {};
  /** Roles are exclusive: the first column to claim one keeps it. */
  const claim = (index: number, role: ImportColumnRole): void => {
    if (role === "ignored") return;
    if (byRole[role] !== undefined) return;
    byRole[role] = index;
    const column = columns[index];
    if (column) column.role = role;
  };

  for (const [index, role] of overrides) {
    if (index < header.length) claim(index, role);
  }

  for (let index = 0; index < header.length; index += 1) {
    if (overrides.has(index)) continue;
    const family = familyOf(header[index] ?? "");
    if (family === "ignored") continue;

    if (family === "startish" || family === "endish") {
      const kind = columnKind(rows, index, order);
      const role =
        family === "startish"
          ? kind === "instant"
            ? "start"
            : kind === "time"
              ? "startTime"
              : "date"
          : kind === "instant"
            ? "end"
            : kind === "time"
              ? "endTime"
              : "endDate";
      claim(index, role);
      continue;
    }

    claim(index, family);
  }

  return { columns, byRole };
}

/** Every cell of the columns that could carry a date, for order detection. */
export function dateCandidateValues(
  header: readonly string[],
  rows: readonly string[][],
): string[] {
  const indexes: number[] = [];
  header.forEach((text, index) => {
    const family = familyOf(text);
    if (family === "startish" || family === "endish") indexes.push(index);
  });

  const values: string[] = [];
  for (const row of rows) {
    for (const index of indexes) {
      const value = (row[index] ?? "").trim();
      if (value) values.push(value);
    }
    if (values.length > 500) break;
  }
  return values;
}
