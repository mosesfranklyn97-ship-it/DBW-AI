import { LOGICAL_TYPES, type DbColumn, type DbSchema, type DbTable, type Dialect, type LogicalType } from "@/lib/types";

export interface ParseWarning {
  kind: "skipped-statement" | "skipped-clause" | "assumed" | "fixed";
  message: string;
}

export interface ParseResult {
  schema: DbSchema | null;
  tables: number;
  columns: number;
  warnings: ParseWarning[];
}

const MAX_INPUT = 2_000_000;
const MAX_TABLES = 60;

/* ------------------------------------------------------------------ *
 * Lexical layer
 *
 * Comments and string literals have to be understood before anything else,
 * because both can contain the very tokens the rest of the parser looks for —
 * a `--` inside a default value, or a `;` inside a CHECK constraint.
 * ------------------------------------------------------------------ */

const QUOTES = { "'": "'", '"': '"', "`": "`" } as const;
type QuoteChar = keyof typeof QUOTES;

/**
 * Blanks out comment bodies with spaces, preserving every offset so downstream
 * index scanning stays aligned with the original text.
 *
 * String literals are deliberately left alone. They are the only source of enum
 * values, default text and `CHECK (x IN (...))` enums, and the splitters below
 * are already quote-aware, so keeping them costs nothing. Identifier quoting is
 * kept for the same reason: masking the backticks in `` `patients` `` would
 * erase the table name.
 */
function maskComments(sql: string): string {
  const out = sql.split("");
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    // Line comments: -- and # (MySQL). A `--` only opens a comment when the
    // SQL standard's "followed by whitespace" rule is met, so `a--b` stays an
    // expression rather than silently losing its tail.
    if (char === "-" && next === "-" && (sql[i + 2] === undefined || /\s/.test(sql[i + 2]))) {
      while (i < sql.length && sql[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (char === "#") {
      while (i < sql.length && sql[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      for (; i < stop; i += 1) out[i] = out[i] === "\n" ? "\n" : " ";
      continue;
    }

    // A quoted run is stepped over whole so that a `--` or `/*` sequence living
    // inside a string is never mistaken for a comment.
    if (QUOTES[char as QuoteChar]) {
      const close = QUOTES[char as QuoteChar];
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "\\" && close !== "`") {
          j += 2;
          continue;
        }
        if (sql[j] === close) {
          if (sql[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      i = Math.min(j + 1, sql.length);
      continue;
    }

    i += 1;
  }

  return out.join("");
}

/** Splits on `separator` at nesting depth zero, ignoring anything inside quotes. */
function splitTopLevel(text: string, separator = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let quote: string | null = null;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      current += char;
      if (char === "\\") {
        current += text[i + 1] ?? "";
        i += 1;
      } else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Splits a statement list on `;` at paren depth zero. */
function splitStatements(text: string): string[] {
  const parts = splitTopLevel(text, ";");
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Index of the first paren depth-0 occurrence of `needle`, or -1. */
function indexAtDepthZero(text: string, needle: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && text.startsWith(needle, i)) return i;
  }
  return -1;
}

/** The balanced `(...)` group starting at `open`, with its parens. */
function takeParens(text: string, open: number): string | null {
  if (text[open] !== "(") return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

function unquoteIdent(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "`" && last === "`") || (first === '"' && last === '"') || (first === "[" && last === "]")) {
      return value.slice(1, -1).replace(/``/g, "`").replace(/""/g, '"');
    }
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * Type mapping
 * ------------------------------------------------------------------ */

const TYPE_ALIASES: Record<string, LogicalType> = {
  int: "int",
  integer: "int",
  int4: "int",
  mediumint: "int",
  smallint: "int",
  int2: "int",
  tinyint: "int",
  year: "int",
  bigint: "bigint",
  int8: "bigint",
  serial: "id",
  bigserial: "id",
  smallserial: "id",
  decimal: "decimal",
  numeric: "decimal",
  dec: "decimal",
  money: "money",
  float: "decimal",
  "double precision": "decimal",
  "double": "decimal",
  real: "decimal",
  bool: "bool",
  boolean: "bool",
  bit: "bool",
  date: "date",
  datetime: "datetime",
  timestamp: "datetime",
  timestamptz: "datetime",
  "timestamp with time zone": "datetime",
  "timestamp without time zone": "datetime",
  time: "time",
  "time with time zone": "time",
  "time without time zone": "time",
  json: "json",
  jsonb: "json",
  uuid: "uuid",
  char: "string",
  character: "string",
  varchar: "string",
  "character varying": "string",
  nvarchar: "string",
  nchar: "string",
  text: "text",
  tinytext: "text",
  mediumtext: "text",
  longtext: "text",
  "character large object": "text",
  clob: "text",
  blob: "text",
  binary: "text",
  varbinary: "text",
};

/** Postgres spells these two-word types; MySQL is single-word. */
const MULTIWORD_TYPES = [
  "character varying",
  "character large object",
  "double precision",
  "timestamp with time zone",
  "timestamp without time zone",
  "time with time zone",
  "time without time zone",
];

function isAutoIncrement(tail: string): boolean {
  return /\b(auto_increment|auto_incr|autoincrement|identity\s*\(|generated\s+(always|by\s+default)\s+as\s+identity)\b/i.test(
    tail,
  );
}

function extractLength(args: string | null): number | undefined {
  if (!args) return undefined;
  const match = /\(\s*(\d+)\s*(?:,\s*\d+\s*)?\)/.exec(args);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractEnumValues(args: string | null): string[] {
  if (!args) return [];
  return [...args.matchAll(/'((?:[^']|'')*)'/g)]
    .map((match) => match[1].replace(/''/g, "'"))
    .filter((value) => value.length > 0);
}

interface MappedType {
  type: LogicalType;
  length?: number;
  enumValues?: string[];
}

function mapType(declared: string, args: string | null, enumTypes: Map<string, string[]>): MappedType {
  const raw = declared.trim().toLowerCase().replace(/\s+/g, " ");

  // A Postgres enum arrives as its own type name, so the value list has to come
  // from the CREATE TYPE statement that defined it. Both the qualified form and
  // the bare form are tried, because the column and the type may disagree on
  // whether the schema prefix is written out.
  const referenced = enumTypes.get(raw) ?? enumTypes.get(raw.split(".").pop()?.trim() ?? "");
  if (referenced) return { type: "enum", enumValues: referenced };

  const enumArgs = extractEnumValues(args);
  if (enumArgs.length > 0) return { type: "enum", enumValues: enumArgs };

  if (raw === "set") return { type: "enum", enumValues: extractEnumValues(args) };

  // `tinyint(1)` is MySQL's boolean, and it is how boolean columns almost always
  // appear in a phpMyAdmin dump. The width is the only signal that it is meant
  // to be a flag rather than a genuine single-digit number.
  if (raw === "tinyint" && extractLength(args) === 1) return { type: "bool" };

  const alias = TYPE_ALIASES[raw];
  if (alias) {
    const mapped: MappedType = { type: alias };
    if (alias === "string") {
      const length = extractLength(args);
      if (length) mapped.length = length;
    }
    if (alias === "id") {
      // A serial primary key is an autoincrement, not a plain integer.
      mapped.type = "id";
    }
    return mapped;
  }

  // Unknown types degrade to a length-capped string rather than being dropped,
  // so an import never silently loses a column.
  const length = extractLength(args);
  return { type: "string", ...(length ? { length } : {}) };
}

/* ------------------------------------------------------------------ *
 * Statement parsing
 * ------------------------------------------------------------------ */

interface CreateTable {
  /** Name with any `schema.` qualifier removed. */
  name: string;
  /** The parenthesised column list, parentheses included. Null when absent. */
  body: string | null;
  /** Everything after the column list: ENGINE=, WITH (), AS SELECT, … */
  trailing: string;
}

function lastIdentPart(qualified: string): string {
  const parts = qualified.split(".");
  return unquoteIdent(parts[parts.length - 1] ?? qualified);
}

/**
 * Reads a `CREATE TABLE` statement by offset rather than by one greedy regex.
 *
 * A single regex has to guess where the name ends and the column list begins,
 * and a greedy `\(([\s\S]*)\)` swallows any trailing `AS SELECT`. Splitting the
 * statement into name, body and trailing regions first keeps the `AS SELECT`
 * test scoped to the region it can legitimately appear in.
 */
function readCreateTable(statement: string): CreateTable | null {
  const prefix = CREATE_TABLE_PREFIX.exec(statement);
  if (!prefix) return null;

  let cursor = prefix[0].length;
  const rest = statement.slice(cursor);

  const qualified = new RegExp(String.raw`^\s*${HEAD_WITH_QUALIFIER}`).exec(rest);
  if (!qualified) return null;
  cursor += qualified[0].length;
  const name = lastIdentPart(qualified[1]);

  // Skip any schema qualifier the regex above consumed but the caller should
  // not see, then look for the column list.
  const open = statement.indexOf("(", cursor);
  const asSelect = indexAtDepthZero(statement.slice(cursor), "as select");

  if (open === -1 || (asSelect !== -1 && cursor + asSelect < open)) {
    return { name, body: null, trailing: statement.slice(cursor) };
  }

  const parens = takeParens(statement, open);
  if (!parens) return { name, body: null, trailing: statement.slice(cursor) };

  // The inner text only: the wrapping pair belongs to the statement, and
  // `splitTopLevel` has to see the columns at depth zero.
  return { name, body: parens.slice(1, -1), trailing: statement.slice(open + parens.length) };
}

interface ColumnDraft {
  name: string;
  type: LogicalType;
  length?: number;
  enumValues?: string[];
  nullable: boolean;
  unique: boolean;
  primaryKey: boolean;
  defaultNow: boolean;
  autoIncrement: boolean;
  references?: { table: string; column: string; onDelete?: "cascade" | "set null" | "restrict" };
  note?: string;
}

const HEAD = String.raw`(?:\x60[^\x60]+\x60|"[^"]+"|\[[^\]]+\]|[A-Za-z_][\w$]*)`;
/** Postgres writes `public.users`; the schema qualifier is not part of the name. */
const HEAD_WITH_QUALIFIER = String.raw`((?:[A-Za-z_][\w$]*\s*\.\s*)*${HEAD})`;
// Leading control characters are tolerated: a dump exported through a terminal
// capture routinely starts with a stray NUL or escape byte.
const CREATE_TABLE_PREFIX = /^[\s -]*create\s+(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?/i;
const CREATE_TYPE = new RegExp(
  String.raw`^\s*create\s+type\s+${HEAD_WITH_QUALIFIER}\s+as\s+enum\s*\(([\s\S]*)\)\s*;?\s*$`,
  "i",
);
const CREATE_INDEX = /^\s*create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?/i;

function readOnDelete(tail: string): "cascade" | "set null" | "restrict" | undefined {
  const match = /on\s+delete\s+(cascade|set\s+null|restrict|no\s+action)/i.exec(tail);
  if (!match) return undefined;
  const value = match[1].toLowerCase().replace(/\s+/g, " ");
  if (value === "cascade") return "cascade";
  if (value === "set null") return "set null";
  if (value === "restrict") return "restrict";
  return undefined;
}

function parseColumn(part: string, enumTypes: Map<string, string[]>): ColumnDraft | null {
  const head = new RegExp(String.raw`^\s*(${HEAD})\s*([\s\S]*)$`).exec(part);
  if (!head) return null;

  const name = unquoteIdent(head[1]);
  if (!name) return null;
  let rest = head[2].trim();
  if (!rest) return null;

  // The type is the longest known multi-word form first, then a single word
  // with any `(...)` argument glued on.
  const multiword = MULTIWORD_TYPES.find((candidate) => rest.toLowerCase().startsWith(candidate));
  let declared: string;
  let args: string | null = null;

  if (multiword) {
    declared = multiword;
    rest = rest.slice(multiword.length).trim();
  } else {
    // A custom type may be schema-qualified: `status public.appointment_status`.
    // Reading the whole dotted run is what lets the enum lookup below find it.
    const typeMatch = /^((?:[A-Za-z_][\w$]*|"[^"]+")\s*\.\s*)*[A-Za-z_][\w$]*\s*(\([\s\S]*?\))?/.exec(rest);
    if (!typeMatch) return null;
    declared = typeMatch[0].replace(/\s*\(\s*[\s\S]*$/, "").replace(/\s+/g, " ").trim();
    args = typeMatch[2] ?? null;
    rest = rest.slice(typeMatch[0].length).trim();
  }

  const mapped = mapType(declared, args, enumTypes);
  const tail = ` ${rest} `;
  const autoIncrement = isAutoIncrement(tail);

  const draft: ColumnDraft = {
    name,
    type: autoIncrement ? "id" : mapped.type,
    ...(mapped.length ? { length: mapped.length } : {}),
    ...(mapped.enumValues?.length ? { enumValues: mapped.enumValues } : {}),
    nullable: !/\bnot\s+null\b/i.test(tail),
    unique: /\bunique\b/i.test(tail) || /\bprimary\s+key\b/i.test(tail),
    primaryKey: /\bprimary\s+key\b/i.test(tail),
    defaultNow: /\bdefault\s+(current_timestamp|now\s*\(\s*\)|getdate\s*\(\s*\))/i.test(tail),
    autoIncrement,
  };

  const inlineFk = new RegExp(String.raw`\breferences\s+${HEAD_WITH_QUALIFIER}\s*(\(([^)]*)\))?`, "i").exec(tail);
  if (inlineFk) {
    draft.references = {
      table: lastIdentPart(inlineFk[1]),
      column: (inlineFk[3] ?? "id").split(",")[0].trim() || "id",
      ...(readOnDelete(tail) ? { onDelete: readOnDelete(tail) } : {}),
    };
  }

  // A CHECK constraint carrying an IN (...) list is the SQLite spelling of an
  // enum, and a very common one in exported schemas.
  if (draft.type === "string" || draft.type === "text") {
    const check = /\bcheck\s*\(([\s\S]*)\)/i.exec(tail);
    if (check) {
      const values = extractEnumValues(check[1]);
      if (values.length > 1) {
        draft.type = "enum";
        draft.enumValues = values;
      }
    }
  }

  if (/\bunique\b/i.test(tail) && /\bkey\b/i.test(rest)) {
    draft.note = "unique key";
  }

  return draft;
}

function parseTableBody(
  body: string,
  enumTypes: Map<string, string[]>,
  warnings: ParseWarning[],
  tableName: string,
): ColumnDraft[] {
  const drafts: ColumnDraft[] = [];

  for (const rawPart of splitTopLevel(body)) {
    // Only a real CONSTRAINT clause loses a name. `CONSTRAINT <name> <rest>` and
    // a bare `CONSTRAINT <rest>` are both legal and the name is optional, so the
    // name is only consumed when the token after CONSTRAINT is not itself a
    // constraint keyword — otherwise `CONSTRAINT PRIMARY KEY (id)` loses its
    // PRIMARY. A plain column definition is left completely untouched.
    let part = rawPart;
    if (/^\s*constraint\s+(?:if\s+not\s+exists\s+)?/i.test(part)) {
      part = part.replace(/^\s*constraint\s+(?:if\s+not\s+exists\s+)?/i, "");
      const leadingName = /^(?:`[^`]+`|"[^"]+"|[A-Za-z_][\w$]*)\s+/.exec(part);
      if (leadingName && !/^(primary|foreign|unique|check|constraint|key|index)\b/i.test(leadingName[0])) {
        part = part.slice(leadingName[0].length);
      }
    }

    if (/^primary\s+key\s*\(/i.test(part) || /^unique\s*(?:key|index)?\s*(?:`[^`]+`|"[^"]+"|[\w$]+)?\s*\(/i.test(part)) {
      const open = part.indexOf("(");
      const group = open === -1 ? null : takeParens(part, open);
      const isPrimary = /^primary/i.test(part);
      for (const key of splitTopLevel((group ?? "").slice(1, -1))) {
        const column = drafts.find((draft) => draft.name.toLowerCase() === unquoteIdent(key).toLowerCase());
        if (!column) continue;
        if (isPrimary) {
          column.primaryKey = true;
          column.unique = true;
        } else {
          column.unique = true;
        }
      }
      continue;
    }

    const fk = /^foreign\s+key\s*\(([\s\S]*?)\)\s*references\s+([\s\S]*)$/i.exec(part);
    if (fk) {
      const localColumns = splitTopLevel(fk[1]).map(unquoteIdent);
      const target = new RegExp(String.raw`^${HEAD_WITH_QUALIFIER}\s*(?:\(([\s\S]*?)\))?`, "i").exec(fk[2].trim());
      if (target) {
        const remoteColumns = (target[2] ?? "id")
          .split(",")
          .map((value) => unquoteIdent(value).trim() || "id");
        const onDelete = readOnDelete(fk[2]);
        const remoteTable = lastIdentPart(target[1]);

        localColumns.forEach((local, index) => {
          const column = drafts.find((draft) => draft.name.toLowerCase() === local.toLowerCase());
          if (!column) return;
          if (localColumns.length > 1) {
            warnings.push({
              kind: "assumed",
              message: `${tableName}: composite foreign key (${localColumns.join(", ")}) was linked on its first column only.`,
            });
          }
          column.references = {
            table: remoteTable,
            column: remoteColumns[index] ?? remoteColumns[0] ?? "id",
            ...(onDelete ? { onDelete } : {}),
          };
        });
        continue;
      }
      warnings.push({ kind: "skipped-clause", message: `${tableName}: could not read "${part.slice(0, 60)}".` });
      continue;
    }

    if (/^(check|fulltext|spatial|index|key|period|exclude)\b/i.test(part)) {
      warnings.push({ kind: "skipped-clause", message: `${tableName}: dropped a ${part.split(/\s/)[0]} constraint.` });
      continue;
    }

    const column = parseColumn(part, enumTypes);
    if (column) {
      drafts.push(column);
    } else {
      warnings.push({ kind: "skipped-clause", message: `${tableName}: could not read "${part.slice(0, 60)}".` });
    }
  }

  return drafts;
}

function draftsToTable(drafts: ColumnDraft[], name: string, description?: string): DbTable | null {
  if (drafts.length === 0) return null;

  const declaredPk = drafts.filter((draft) => draft.primaryKey);
  // A composite key has no faithful representation here — the generators emit a
  // single-column PK — so the first declared column carries it and the rest are
  // reported by the caller.
  const primary = declaredPk[0];
  for (const draft of drafts) draft.primaryKey = draft === primary;

  const columns: DbColumn[] = drafts.map((draft) => {
    const column: DbColumn = {
      name: draft.name,
      type: draft.type,
      ...(draft.length ? { length: draft.length } : {}),
      ...(draft.enumValues?.length ? { enumValues: draft.enumValues } : {}),
      ...(draft.primaryKey ? { primaryKey: true } : {}),
      ...(draft.unique && !draft.primaryKey ? { unique: true } : {}),
      ...(draft.defaultNow ? { defaultNow: true } : {}),
      ...(draft.type === "id" && draft.autoIncrement ? {} : { nullable: draft.nullable && !draft.primaryKey }),
      ...(draft.references
        ? {
            references: {
              table: draft.references.table,
              column: draft.references.column,
              ...(draft.references.onDelete ? { onDelete: draft.references.onDelete } : {}),
            },
          }
        : {}),
      ...(draft.note ? { note: draft.note } : {}),
    };
    return column;
  });

  return { name, ...(description ? { description } : {}), columns };
}

function guessDialect(sql: string): Dialect {
  if (/\bengine\s*=\s*\w+/i.test(sql) || /\bunsigned\b/i.test(sql) || /\bauto_increment\b/i.test(sql)) return "mysql";
  if (/\brow\s+level\s+security\b/i.test(sql) || /\bgen_random_uuid\s*\(\s*\)/i.test(sql) || /\bpolicy\b/i.test(sql)) {
    return "supabase";
  }
  if (/\bjsonb\b|\bserial\b|\btimestamptz\b|\buuid\b/i.test(sql)) return "postgres";
  return "sqlite";
}

function titleCase(value: string): string {
  return value
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Reads a `CREATE TABLE` script into the same `DbSchema` shape the AI and the
 * keyword engine produce, so an imported database can use every preview,
 * export and refinement feature a generated one can.
 */
export function parseSqlToSchema(
  input: string,
  options: { dialect?: Dialect; name?: string; maxTables?: number } = {},
): ParseResult {
  const warnings: ParseWarning[] = [];
  const maxTables = options.maxTables ?? MAX_TABLES;

  if (!input || !input.trim()) {
    return { schema: null, tables: 0, columns: 0, warnings };
  }
  if (input.length > MAX_INPUT) {
    warnings.push({
      kind: "skipped-statement",
      message: `Input was ${input.length.toLocaleString()} characters; only the first ${MAX_INPUT.toLocaleString()} were read.`,
    });
  }
  const source = input.slice(0, MAX_INPUT);

  const masked = maskComments(source);
  const statements = splitStatements(masked);
  const enumTypes = new Map<string, string[]>();

  // CREATE TYPE has to be read first: a column may reference the enum by name
  // in a statement that appears later in the file.
  for (const statement of statements) {
    const typeMatch = CREATE_TYPE.exec(statement);
    if (!typeMatch) continue;
    const values = extractEnumValues(typeMatch[2]);
    if (values.length > 0) enumTypes.set(lastIdentPart(typeMatch[1]).toLowerCase(), values);
  }

  const dialect = options.dialect ?? guessDialect(source);
  const tables: DbTable[] = [];
  const seen = new Set<string>();

  for (const statement of statements) {
    if (/^\s*create\s+type\b/i.test(statement)) continue;
    if (CREATE_INDEX.test(statement)) {
      warnings.push({ kind: "skipped-clause", message: "Index definitions are not imported; keys and uniqueness are." });
      continue;
    }
    if (/^\s*(insert|update|delete|select|set|begin|commit|use|alter|drop|grant|create\s+(?:view|index|function|trigger|schema|database|user|role|extension|sequence))\b/i.test(statement)) {
      continue;
    }

    const read = readCreateTable(statement);
    if (!read) continue;

    const tableName = read.name;
    if (seen.has(tableName.toLowerCase())) {
      warnings.push({ kind: "skipped-statement", message: `Duplicate definition of "${tableName}" ignored.` });
      continue;
    }
    if (tables.length >= maxTables) {
      warnings.push({ kind: "skipped-statement", message: `Stopped after ${maxTables} tables.` });
      break;
    }

    if (read.body === null) {
      warnings.push({
        kind: "skipped-statement",
        message: `"${tableName}" is a CREATE TABLE ... AS SELECT, which has no column list.`,
      });
      continue;
    }
    // Scoped to the trailing region on purpose: a DEFAULT string is free to
    // contain the words "as select" without making the table a CTAS.
    if (/\bas\s+select\b/i.test(read.trailing)) {
      warnings.push({
        kind: "skipped-statement",
        message: `"${tableName}" is a CREATE TABLE ... AS SELECT, which has no column list.`,
      });
      continue;
    }

    const drafts = parseTableBody(read.body, enumTypes, warnings, tableName);
    const table = draftsToTable(drafts, tableName);
    if (!table) {
      warnings.push({ kind: "skipped-statement", message: `"${tableName}" had no readable columns.` });
      continue;
    }

    const composite = drafts.filter((draft) => draft.primaryKey).length;
    if (composite > 1) {
      warnings.push({
        kind: "assumed",
        message: `"${tableName}" had a composite primary key; only the first column is exported as the key.`,
      });
    }

    seen.add(tableName.toLowerCase());
    tables.push(table);
  }

  if (tables.length === 0) {
    return { schema: null, tables: 0, columns: 0, warnings };
  }

  // A foreign key pointing at a table that is not in the file would generate DDL
  // that fails on import, so the link is dropped and reported.
  const known = new Set(tables.map((table) => table.name.toLowerCase()));
  for (const table of tables) {
    for (const column of table.columns) {
      if (column.references && !known.has(column.references.table.toLowerCase())) {
        warnings.push({
          kind: "fixed",
          message: `${table.name}.${column.name} pointed at missing table "${column.references.table}"; the link was removed.`,
        });
        delete column.references;
      }
    }
  }

  const foreignKeys = tables.reduce(
    (total, table) => total + table.columns.filter((column) => column.references).length,
    0,
  );
  const columns = tables.reduce((total, table) => total + table.columns.length, 0);

  // A dump with forty indexes would otherwise report the same notice forty
  // times, which buries the one warning that actually matters.
  const deduped = dedupeWarnings(warnings);
  const notices = deduped.filter((warning) => !/index definitions/i.test(warning.message));

  const schema: DbSchema = {
    name: options.name ?? titleCase(`${tables[0].name} database`),
    description: `Imported from an existing SQL script — ${tables.length} table${tables.length === 1 ? "" : "s"}, ${columns} columns, ${foreignKeys} foreign key${foreignKeys === 1 ? "" : "s"}.`,
    dialect,
    tables,
    source: "engine",
    notes: notices.length > 0 ? notices.map((warning) => warning.message) : undefined,
  };

  return { schema, tables: tables.length, columns, warnings: notices };
}

function dedupeWarnings(warnings: ParseWarning[]): ParseWarning[] {
  const seen = new Set<string>();
  const out: ParseWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.kind}:${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(warning);
  }
  return out;
}

/** Type guard re-exported so the UI can offer the same vocabulary the engine uses. */
export const PARSEABLE_TYPES = LOGICAL_TYPES;
