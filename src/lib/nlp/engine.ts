import {
  col,
  DOMAIN_BLUEPRINTS,
  ENTITY_BLUEPRINTS,
  STOP_WORDS,
  type DomainBlueprint,
} from "@/lib/nlp/dictionary";
import {
  FuzzyIndex,
  findExclusions,
  isHardExclusion,
  normalizeUtterance,
} from "@/lib/nlp/robustness";
import type { DbColumn, DbSchema, DbTable, Dialect, LogicalType } from "@/lib/types";
import { LOGICAL_TYPES } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Inflection                                                          */
/* ------------------------------------------------------------------ */

const IRREGULAR_PLURALS: Record<string, string> = {
  person: "people",
  child: "children",
  man: "men",
  woman: "women",
  staff: "staff",
  equipment: "equipment",
  attendance: "attendance",
  payroll: "payroll",
  inventory: "inventories",
  analysis: "analyses",
  datum: "data",
};

const UNCOUNTABLE = new Set(["staff", "equipment", "attendance", "payroll", "data", "media", "news"]);

export function pluralize(word: string): string {
  const lower = word.toLowerCase();
  if (UNCOUNTABLE.has(lower)) return lower;
  if (IRREGULAR_PLURALS[lower]) return IRREGULAR_PLURALS[lower];
  if (Object.values(IRREGULAR_PLURALS).includes(lower)) return lower;
  // already plural (teachers, categories, classes) — don't double pluralise
  if (/(s|es)$/.test(lower) && singularize(lower) !== lower) return lower;
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${lower}es`;
  if (/[^aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  if (/(f)$/.test(lower)) return `${lower.slice(0, -1)}ves`;
  if (lower.endsWith("s")) return lower;
  return `${lower}s`;
}

export function singularize(word: string): string {
  const lower = word.toLowerCase();
  if (UNCOUNTABLE.has(lower)) return lower;
  const irregular = Object.entries(IRREGULAR_PLURALS).find(([, plural]) => plural === lower);
  if (irregular) return irregular[0];
  if (lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("sses") || lower.endsWith("shes") || lower.endsWith("ches") || lower.endsWith("xes")) {
    return lower.slice(0, -2);
  }
  if (lower.endsWith("s") && !lower.endsWith("ss")) return lower.slice(0, -1);
  return lower;
}

export function snake(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function tableNameFor(raw: string): string {
  const parts = snake(raw).split("_").filter(Boolean);
  if (parts.length === 0) return "";
  const last = parts.pop() as string;
  return [...parts, pluralize(last)].join("_");
}

export function foreignKeyName(tableName: string): string {
  const parts = tableName.split("_");
  const last = parts.pop() as string;
  return [...parts, singularize(last), "id"].join("_");
}

export function titleize(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Prompt analysis                                                     */
/* ------------------------------------------------------------------ */

export interface PromptAnalysis {
  domain: DomainBlueprint;
  domainScore: number;
  entities: string[];
  relations: { child: string; parent: string; column?: string }[];
  /** Tables the user explicitly ruled out ("...without payments"). */
  excluded: string[];
}

const KNOWN_TABLES = Object.keys(ENTITY_BLUEPRINTS);

/**
 * Colloquial vocabulary. The AI path handles phrasing we never thought of; this
 * table is what keeps the offline path useful for the everyday word people
 * actually reach for instead of the word in the dictionary.
 */
const SYNONYMS: Record<string, string> = {
  // people
  admins: "users",
  admin: "users",
  administrators: "users",
  accounts_users: "users",
  clients: "customers",
  client: "customers",
  buyers: "customers",
  buyer: "customers",
  shoppers: "customers",
  shoppers_guests: "customers",
  sellers: "users",
  vendors: "suppliers",
  staffs: "employees",
  staff: "employees",
  workers: "employees",
  worker: "employees",
  team: "employees",
  crews: "employees",
  pupils: "students",
  pupils_people: "students",
  learners: "students",
  understudies: "students",
  lecturers: "teachers",
  instructors: "teachers",
  tutors: "teachers",
  professors: "teachers",
  physicians: "doctors",
  docs: "doctors",
  patients_person: "patients",
  attendees: "customers",
  subscribers: "customers",
  members_people: "members",
  fans: "customers",
  donors: "members",
  worshippers: "members",
  passengers_travelers: "passengers",
  // commerce
  items: "products",
  item: "products",
  goods: "products",
  wares: "products",
  stocks: "products",
  merchandise: "products",
  services_offered: "services",
  offerings: "donations",
  tithes: "donations",
  courses: "subjects",
  classes: "subjects",
  consultations: "appointments",
  visits: "appointments",
  sessions_booked: "sessions",
  bills: "invoices",
  billing: "invoices",
  receipts: "payments",
  pays: "payments",
  sales_made: "sales",
  carts: "orders",
  baskets: "orders",
  purchases: "orders",
  // logistics / property
  riders: "drivers",
  couriers: "drivers",
  cars: "vehicles",
  trucks: "vehicles",
  autos: "vehicles",
  bikes: "vehicles",
  houses: "properties",
  apartments: "properties",
  lands: "properties",
  rentals: "properties",
  seats: "rooms",
  halls: "rooms",
  beds: "wards",
  beds_wards: "wards",
  // content
  articles: "posts",
  blogs: "posts",
  writeups: "posts",
  news: "posts",
  feedbacks: "reviews",
  ratings: "reviews",
  comments: "reviews",
  // files
  galleries: "files",
  images: "files",
  photos: "files",
  documents: "files",
  docs_files: "files",
  uploads: "files",
  // records
  exams: "grades",
  results: "grades",
  scores: "grades",
  marks: "grades",
  reportcards: "grades",
  salaries: "payroll",
  wages: "payroll",
  payslips: "payroll",
  leaves: "attendance",
  // food
  menus: "menu_items",
  dishes: "menu_items",
  foods: "menu_items",
  recipes: "menu_items",
  // events
  meetups: "events",
  webinars: "events",
  // generic
  notes: "records",
  history: "activity_log",
  activities: "activity_log",
  things: "records",
  entries: "records",
  transactions_money: "transactions",
  shipments_delivery: "shipments",
  menu: "menu_items",
  category: "categories",
  tag: "tags",
};

/** Every table name the dictionary knows, plus its singular form. */
const TABLE_VOCABULARY: string[] = (() => {
  const out: string[] = [];
  for (const name of KNOWN_TABLES) {
    out.push(name, singularize(name));
  }
  for (const target of Object.values(SYNONYMS)) {
    out.push(target, singularize(target));
  }
  return out.filter((term) => term.length > 2 && !STOP_WORDS.has(term));
})();

const TABLE_INDEX = new FuzzyIndex(TABLE_VOCABULARY);

function canonicalTable(word: string): string | null {
  const cleaned = snake(word);
  if (!cleaned) return null;
  if (STOP_WORDS.has(cleaned) || STOP_WORDS.has(singularize(cleaned))) return null;
  const plural = tableNameFor(cleaned);
  if (ENTITY_BLUEPRINTS[plural]) return plural;
  if (ENTITY_BLUEPRINTS[cleaned]) return cleaned;
  if (SYNONYMS[plural]) return SYNONYMS[plural];
  if (SYNONYMS[cleaned]) return SYNONYMS[cleaned];

  // Misspelling or an unknown word that is close to a known table. Only
  // attempted for longer words, so short ones are never guessed at.
  if (cleaned.length < 5) return null;
  const direct = TABLE_INDEX.lookup(cleaned, 1);
  if (direct && ENTITY_BLUEPRINTS[direct]) return direct;
  const viaPlural = TABLE_INDEX.lookup(plural, 1);
  if (viaPlural && ENTITY_BLUEPRINTS[viaPlural]) return viaPlural;
  return null;
}

/**
 * Resolves a free-form word to a table, inventing a new table when nothing in
 * the dictionary is close enough. Used for lists the dictionary has never seen.
 */
function resolveOrInvent(word: string): string | null {
  const known = canonicalTable(word);
  if (known) return known;
  const singular = singularize(snake(word));
  if (singular.length < 3) return null;
  if (STOP_WORDS.has(singular)) return null;
  return tableNameFor(singular);
}

const LIST_TRIGGER =
  /\b(?:with|including|include|includes|containing|contains|having|has|needs?|tables?|track|tracks|store|stores|keep|keeps|record|records|manage|manages)\b/g;
const CHUNK_NOISE = new Set([
  "a",
  "an",
  "the",
  "my",
  "our",
  "their",
  "some",
  "each",
  "every",
  "all",
  "also",
  "plus",
  "for",
  "of",
  "in",
  "on",
  "to",
  "and",
  "about",
  "info",
  "information",
  "details",
  "record",
  "records",
  "table",
  "tables",
  "row",
  "rows",
  "field",
  "fields",
  "data",
  "stuff",
]);

/** Pull entity names out of an enumeration even when the dictionary doesn't know them. */
function extractListedEntities(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(LIST_TRIGGER)) {
    const start = (match.index ?? 0) + match[0].length;
    const segment = text.slice(start).split(/[.;!?]/)[0];
    if (!segment) continue;
    for (const chunk of segment.split(/,|\band\b|\bplus\b|&|\/|\balso\b/)) {
      const words = chunk
        .trim()
        .split(/\s+/)
        .filter((word) => word && !CHUNK_NOISE.has(word));
      const last = words[words.length - 1];
      if (!last || last.length < 3 || !/^[a-z_]+$/.test(last)) continue;
      if (STOP_WORDS.has(last) || STOP_WORDS.has(singularize(last))) continue;
      const name = resolveOrInvent(last);
      if (name && !found.includes(name)) found.push(name);
    }
  }
  return found;
}

/** Domain keyword index, so a misspelt domain word still selects the blueprint. */
const DOMAIN_TERMS: string[] = (() => {
  const out: string[] = [];
  for (const domain of DOMAIN_BLUEPRINTS) {
    for (const keyword of domain.keywords) {
      for (const word of keyword.split(/\s+/)) {
        if (word.length > 3) out.push(word);
      }
    }
  }
  return [...new Set(out)];
})();

const DOMAIN_INDEX = new FuzzyIndex(DOMAIN_TERMS);

function escapeRegExp(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function scoreDomain(domain: DomainBlueprint, text: string, tokens: string[]): number {
  let score = 0;
  for (const keyword of domain.keywords) {
    const pattern = new RegExp(`\\b${escapeRegExp(keyword)}(?:s|es)?\\b`);
    if (pattern.test(text)) {
      score += keyword.includes(" ") ? 4 : 2;
      continue;
    }
    // No literal hit: fall back to fuzzy-matching each token of a multi-word
    // keyword, and to fuzzy single tokens, so "restarant" still finds the
    // restaurant blueprint.
    if (keyword.includes(" ")) {
      const parts = keyword.split(/\s+/);
      const matched = parts.filter((part) =>
        tokens.some((token) => part.length > 4 && DOMAIN_INDEX.lookup(token, 1) === part),
      ).length;
      if (matched === parts.length) score += 3;
      else if (matched > 0) score += 1;
    }
  }
  return score;
}

/**
 * Quantifiers and schema-ish words that must never become a table. "each order"
 * is a relation, not an "eaches" table.
 */
const NON_ENTITY_WORDS = new Set([
  "each",
  "every",
  "all",
  "both",
  "any",
  "some",
  "many",
  "multiple",
  "several",
  "few",
  "one",
  "two",
  "three",
  "system",
  "systems",
  "app",
  "apps",
  "application",
  "applications",
  "platform",
  "website",
  "site",
  "sites",
  "tool",
  "tools",
  "software",
  "program",
  "database",
  "databases",
  "db",
  "project",
  "projects",
  "table",
  "tables",
  "column",
  "columns",
  "field",
  "fields",
  "row",
  "rows",
  "thing",
  "things",
  "stuff",
  "way",
  "ways",
  "kind",
  "sort",
  "type",
  "types",
  "list",
  "lists",
  "info",
  "information",
  "detail",
  "details",
  "thing",
]);

function isNonEntity(word: string): boolean {
  const bare = word.replace(/[^a-z0-9_]/g, "");
  if (!bare) return true;
  if (NON_ENTITY_WORDS.has(bare)) return true;
  return STOP_WORDS.has(bare) || STOP_WORDS.has(singularize(bare));
}

/**
 * Last resort for bare enumerations of nouns the dictionary has never seen:
 * "a system for widgets and sprockets". Only consulted when nothing else
 * matched, so it can't override a real domain or a known table.
 */
function extractCoordinatedNouns(text: string): string[] {
  if (!/\band\b|,/.test(text)) return [];
  const found: string[] = [];
  for (const chunk of text.split(/,|\band\b/)) {
    const tokens = chunk
      .trim()
      .split(/\s+/)
      .filter((word) => word && !CHUNK_NOISE.has(word) && /^[a-z][a-z0-9_]*$/.test(word));
    if (tokens.length === 0) continue;
    const last = tokens[tokens.length - 1];
    if (last.length < 3 || isNonEntity(last)) continue;
    // Skip a chunk that is only a verb-ish tail, e.g. "...to track".
    if (VERBISH.has(last) || VERBISH.has(tokens[tokens.length - 2] ?? "")) continue;
    const name = resolveOrInvent(last);
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

/** Words that look like nouns positionally but are instructions. */
const VERBISH = new Set([
  "track",
  "tracks",
  "store",
  "stores",
  "keep",
  "keeps",
  "record",
  "records",
  "save",
  "saves",
  "manage",
  "manages",
  "handle",
  "handles",
  "show",
  "shows",
  "list",
  "add",
  "adds",
  "get",
  "gets",
  "see",
  "know",
  "want",
  "need",
  "let",
  "build",
  "create",
  "generate",
]);

export function analyzePrompt(prompt: string): PromptAnalysis {
  const text = normalizeUtterance(prompt);
  const tokens = text.match(/[a-z][a-z0-9_]*/g) ?? [];

  // 1. What the user explicitly does NOT want. Computed first so everything
  //    downstream can be filtered, and so "without payments" can never re-add
  //    payments via the domain blueprint.
  const excluded = new Set<string>();
  for (const span of findExclusions(text)) {
    if (!isHardExclusion(span.text)) continue;
    const spanTokens = span.text.match(/[a-z][a-z0-9_]*/g) ?? [];
    for (let i = 0; i < spanTokens.length - 1; i += 1) {
      const bigram = canonicalTable(`${spanTokens[i]}_${spanTokens[i + 1]}`);
      if (bigram) excluded.add(bigram);
    }
    for (const token of spanTokens) {
      const resolved = canonicalTable(token);
      if (resolved) excluded.add(resolved);
    }
  }

  // 2. domain scoring (word-boundary matching so "barbershop" never matches "bar")
  let best: { domain: DomainBlueprint; score: number } = {
    domain: DOMAIN_BLUEPRINTS[DOMAIN_BLUEPRINTS.length - 1],
    score: 0,
  };
  for (const domain of DOMAIN_BLUEPRINTS) {
    const score = scoreDomain(domain, text, tokens);
    if (score > best.score) best = { domain, score };
  }

  // 3. explicit entities (bigrams first, then single tokens)
  const entities: string[] = [];
  const push = (value: string | null) => {
    if (value && !excluded.has(value) && !entities.includes(value)) entities.push(value);
  };

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const bigram = `${tokens[i]}_${tokens[i + 1]}`;
    const canonical = canonicalTable(bigram);
    if (canonical) push(canonical);
  }
  for (const token of tokens) {
    if (token.length < 3) continue;
    push(canonicalTable(token));
  }

  // entities the dictionary doesn't know yet: "...with barbers, haircuts and payments"
  for (const listed of extractListedEntities(text)) {
    push(listed);
  }

  // Nothing recognised at all: treat a bare "X and Y" list as the schema.
  if (entities.length === 0) {
    for (const noun of extractCoordinatedNouns(text)) {
      push(noun);
    }
  }

  // 4. relations
  const relations: PromptAnalysis["relations"] = [];
  const addRelation = (childRaw: string, parentRaw: string, column?: string) => {
    if (isNonEntity(childRaw) || isNonEntity(parentRaw)) return;
    const child = canonicalTable(childRaw) ?? tableNameFor(childRaw);
    const parent = canonicalTable(parentRaw) ?? tableNameFor(parentRaw);
    if (!child || !parent || child === parent) return;
    if (excluded.has(child) || excluded.has(parent)) return;
    if (STOP_WORDS.has(singularize(child)) || STOP_WORDS.has(singularize(parent))) return;
    if (relations.some((rel) => rel.child === child && rel.parent === parent)) return;
    relations.push({ child, parent, column });
  };

  const explicitFk = /([a-z_]+)\.([a-z_]+)\s*(?:->|=>|references?|refs?)\s*([a-z_]+)(?:\.([a-z_]+))?/g;
  for (const match of text.matchAll(explicitFk)) {
    addRelation(match[1], match[3], match[2]);
  }

  const linkPhrases =
    /([a-z_]+)\s+(?:links?\s+to|linked\s+to|belongs?\s+to|relates?\s+to|related\s+to|connects?\s+to|connected\s+to|is\s+part\s+of|part\s+of|under|under\s+each|for\s+each|per|needs?\s+a|has\s+a|tied\s+to|attached\s+to|points?\s+to|references?)\s+([a-z_]+)/g;
  for (const match of text.matchAll(linkPhrases)) {
    addRelation(match[1], match[2]);
  }

  const hasMany = /(?:each\s+)?([a-z_]+)\s+(?:has|have|can\s+have|gets?|makes?|places?|books?|takes?)\s+(?:many|multiple|several|some|\d+)\s+([a-z_]+)/g;
  for (const match of text.matchAll(hasMany)) {
    addRelation(match[2], match[1]);
  }

  // "track orders for customers", "record payments against invoices"
  const tracking =
    /(?:track|record|log|store|keep|save|capture)\s+([a-z_]+)\s+(?:for|against|against|per|on|to|from|about)\s+([a-z_]+)/g;
  for (const match of text.matchAll(tracking)) {
    addRelation(match[1], match[2]);
  }

  return { domain: best.domain, domainScore: best.score, entities, relations, excluded: [...excluded] };
}

/* ------------------------------------------------------------------ */
/* Table construction                                                  */
/* ------------------------------------------------------------------ */

function idColumn(): DbColumn {
  return { name: "id", type: "id", primaryKey: true };
}

function genericColumns(tableName: string): string[] {
  const singular = singularize(tableName);
  if (/(er|or|ist|ian|ant|ard)$/.test(singular) || /(person|people|staff|worker|member|owner)/.test(singular)) {
    return [
      "full_name:string(120)",
      "phone:phone(25)",
      "email:email(160)?",
      "status:enum(active|inactive)",
      "created_at:datetime=now",
    ];
  }
  if (/(cut|service|package|plan|treatment|course|session|repair|wash|class)$/.test(singular)) {
    return [
      "name:string(120)",
      "description:text?",
      "price:money",
      "duration_minutes:int",
      "is_active:bool",
      "created_at:datetime=now",
    ];
  }
  if (/(payment|transaction|invoice|bill|fee|expense|donation|salary)/.test(singular)) {
    return [
      "reference:string(50)!",
      "amount:money",
      "status:enum(pending|completed|failed)",
      "description:string(200)?",
      "created_at:datetime=now",
    ];
  }
  if (/(log|history|event|activity)/.test(singular)) {
    return ["action:string(120)", "details:text?", "created_at:datetime=now"];
  }
  if (/(image|photo|file|document|attachment)/.test(singular)) {
    return ["file_name:string(180)", "file_url:url", "size_bytes:bigint", "uploaded_at:datetime=now"];
  }
  if (/(schedule|shift|session|slot|booking|reservation)/.test(singular)) {
    return [
      "title:string(150)",
      "starts_at:datetime",
      "ends_at:datetime?",
      "status:enum(pending|confirmed|cancelled)",
      "created_at:datetime=now",
    ];
  }
  return [
    "name:string(150)",
    "description:text?",
    "status:enum(active|inactive)",
    "created_at:datetime=now",
  ];
}

function buildTable(tableName: string, present: Set<string>): DbTable {
  const blueprint = ENTITY_BLUEPRINTS[tableName];
  const specs = blueprint ? blueprint.columns : genericColumns(tableName);
  const columns: DbColumn[] = [idColumn()];

  for (const spec of specs) {
    const column = col(spec);
    if (column.references) {
      // keep foreign keys only when the parent table is part of the schema
      if (!present.has(column.references.table)) continue;
      if (column.references.table === tableName && column.name === "parent_id") {
        column.nullable = true;
      }
    }
    if (columns.some((existing) => existing.name === column.name)) continue;
    columns.push(column);
  }

  if (!columns.some((column) => column.name === "created_at")) {
    columns.push(col("created_at:datetime=now"));
  }

  return {
    name: tableName,
    description: blueprint?.description ?? `${titleize(tableName)} records`,
    columns,
  };
}

function addRelationColumn(table: DbTable, parent: string, columnName?: string) {
  const name = columnName ?? foreignKeyName(parent);
  const existing = table.columns.find((column) => column.name === name);
  if (existing) {
    existing.type = "fk";
    existing.references = { table: parent, column: "id", onDelete: "cascade" };
    return;
  }
  const insertAt = Math.min(1, table.columns.length);
  table.columns.splice(insertAt + 1, 0, {
    name,
    type: "fk",
    references: { table: parent, column: "id", onDelete: "cascade" },
  });
}

function topoSort(tables: DbTable[]): DbTable[] {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const visited = new Set<string>();
  const temp = new Set<string>();
  const out: DbTable[] = [];

  const visit = (table: DbTable) => {
    if (visited.has(table.name) || temp.has(table.name)) return;
    temp.add(table.name);
    for (const column of table.columns) {
      const target = column.references?.table;
      if (target && target !== table.name) {
        const parent = byName.get(target);
        if (parent) visit(parent);
      }
    }
    temp.delete(table.name);
    visited.add(table.name);
    out.push(table);
  };

  tables.forEach(visit);
  return out;
}

const TRANSACTIONAL = /(payment|order|booking|appointment|sale|invoice|job|transaction|ticket|request|delivery|visit|session|rental|repair|service_record)/;
const ACTOR = /(customer|client|user|member|patient|guest|student|buyer|passenger)/;
const LOOKUP = /(categor|type|status|setting|tag|role)/;

function createsCycle(tables: DbTable[], child: string, parent: string): boolean {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const stack = [parent];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === child) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    const table = byName.get(current);
    if (!table) continue;
    for (const column of table.columns) {
      if (column.references?.table) stack.push(column.references.table);
    }
  }
  return false;
}

/**
 * Tables invented on the fly (barbers, haircuts, wash_jobs…) arrive without
 * relationships. A real architect would connect them, so we do too.
 */
export function autoLinkTables(tables: DbTable[]): DbTable[] {
  const names = tables.map((table) => table.name);
  const actor = names.find((name) => ACTOR.test(singularize(name)));
  const anchors = names.filter(
    (name) => TRANSACTIONAL.test(singularize(name)) && !/payment|invoice|transaction/.test(singularize(name)),
  );
  const resources = names.filter(
    (name) => !TRANSACTIONAL.test(singularize(name)) && !ACTOR.test(singularize(name)) && !LOOKUP.test(name),
  );

  for (const table of tables) {
    const hasForeignKey = table.columns.some((column) => column.references);
    if (hasForeignKey || !TRANSACTIONAL.test(singularize(table.name))) continue;

    const targets: string[] = [];
    if (/payment|invoice|transaction/.test(singularize(table.name))) {
      const anchor = anchors.find((name) => name !== table.name);
      if (anchor) targets.push(anchor);
    }
    if (actor && actor !== table.name) targets.push(actor);
    const resource = resources.find((name) => name !== table.name);
    if (resource && targets.length < 2) targets.push(resource);

    for (const target of targets.slice(0, 2)) {
      if (target === table.name) continue;
      if (createsCycle(tables, table.name, target)) continue;
      addRelationColumn(table, target);
    }
  }

  return tables;
}

export function pruneDanglingKeys(tables: DbTable[]): DbTable[] {
  const names = new Set(tables.map((table) => table.name));
  return tables.map((table) => ({
    ...table,
    columns: table.columns.filter((column) => !column.references || names.has(column.references.table)),
  }));
}

export interface BuildOptions {
  prompt: string;
  dialect: Dialect;
  maxTables?: number;
}

export function buildSchemaFromPrompt({ prompt, dialect, maxTables = 50 }: BuildOptions): DbSchema {
  const analysis = analyzePrompt(prompt);
  const notes: string[] = [];
  const excluded = new Set(analysis.excluded);

  const ordered: string[] = [];
  const pushTable = (name: string) => {
    // A table the user said they don't want must not come back via the
    // domain blueprint or via auto-linking.
    if (!name || excluded.has(name)) return;
    if (!ordered.includes(name)) ordered.push(name);
  };

  analysis.entities.forEach(pushTable);

  /**
   * Only pull in a whole domain blueprint when it is actually warranted.
   * Naming one table that happens to appear in a domain's keyword list is not
   * enough — "customers and orders" matched the CRM blueprint and used to drag
   * in companies, contacts, leads, deals and tasks. Require either that the
   * user named nothing (so the domain is the only signal) or that something
   * they *did* name genuinely belongs to this domain.
   */
  const domainRelevant =
    analysis.domain.core.some((name) => analysis.entities.includes(name)) ||
    analysis.domain.tables.some((name) => analysis.entities.includes(name));

  if (analysis.domainScore > 0 && (ordered.length === 0 || domainRelevant)) {
    analysis.domain.tables.forEach(pushTable);
    if (analysis.domainScore > 0) {
      notes.push(`Detected a ${analysis.domain.label} style system.`);
    }
  } else if (ordered.length === 0) {
    // No domain and no entities: fall back to the default blueprint.
    analysis.domain.tables.forEach(pushTable);
  }

  for (const relation of analysis.relations) {
    pushTable(relation.parent);
    pushTable(relation.child);
  }

  if (excluded.size > 0) {
    notes.push(`Left out as requested: ${[...excluded].map(titleize).join(", ")}.`);
  }

  // Priority: explicit entities > domain core > everything else
  const priority = (name: string) => {
    const explicitIndex = analysis.entities.indexOf(name);
    if (explicitIndex >= 0) return explicitIndex;
    const coreIndex = analysis.domain.core.indexOf(name);
    if (coreIndex >= 0) return 100 + coreIndex;
    return 500 + ordered.indexOf(name);
  };

  let selected = [...ordered].sort((a, b) => priority(a) - priority(b));

  // Excluding everything would otherwise emit a schema with zero tables. Keep
  // the domain's core rather than handing back something unusable.
  if (selected.length === 0) {
    const fallback = analysis.domain.core.find((name) => !excluded.has(name));
    if (fallback) {
      selected = [fallback];
      notes.push("Everything you listed was excluded, so this starts from a single core table.");
    } else {
      selected = ["records"];
      notes.push("Nothing recognisable was found, so this starts from a single generic table.");
    }
  }

  if (selected.length > maxTables) {
    notes.push(
      `Trimmed to ${maxTables} tables for your current plan (${selected.length - maxTables} suggested tables hidden).`,
    );
    selected = selected.slice(0, maxTables);
  }

  const present = new Set(selected);
  let tables = selected.map((name) => buildTable(name, present));

  const byName = new Map(tables.map((table) => [table.name, table]));
  for (const relation of analysis.relations) {
    const child = byName.get(relation.child);
    if (!child || !present.has(relation.parent)) continue;
    addRelationColumn(child, relation.parent, relation.column);
  }

  tables = topoSort(pruneDanglingKeys(autoLinkTables(tables)));

  const name = deriveName(prompt, analysis.domain.label);

  return {
    name,
    description: prompt.trim().slice(0, 400),
    dialect,
    tables,
    source: "engine",
    notes,
  };
}

export function deriveName(prompt: string, fallback = "Custom"): string {
  const analysis = analyzePrompt(prompt);
  if (analysis.domainScore > 0) return `${analysis.domain.label} DB`;

  const lower = prompt.toLowerCase();
  const subject = lower.match(
    /\b(?:for|my|our|a|an|the)\s+([a-z]+(?:\s+[a-z]+)?)\s+(?:system|app|application|business|platform|database|db|shop|service|with)\b/,
  );
  if (subject) {
    const candidate = subject[1]
      .split(/\s+/)
      .filter((word) => !STOP_WORDS.has(word) && word.length > 2)
      .join(" ");
    if (candidate) return `${titleize(candidate)} DB`;
  }

  if (analysis.entities.length > 0) {
    return `${titleize(analysis.entities.slice(0, 2).map((entity) => entity.replace(/_/g, " ")).join(" & "))} DB`;
  }
  return `${fallback} DB`;
}

/* ------------------------------------------------------------------ */
/* Normalisation (also used to sanitise AI output)                     */
/* ------------------------------------------------------------------ */

const MAX_VARCHAR_LENGTH = 4096;
const MAX_ENUM_VALUES = 32;
const MAX_ENUM_VALUE_LENGTH = 64;

/**
 * Enum members are emitted as SQL string literals, so they are stripped of
 * quotes and newlines here rather than escaped at every interpolation site.
 */
function safeEnumValues(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const text = String(entry)
      .replace(/[\r\n]+/g, " ")
      .replace(/'/g, "")
      .trim()
      .slice(0, MAX_ENUM_VALUE_LENGTH);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_ENUM_VALUES) break;
  }
  return out.length > 0 ? out : undefined;
}

/** An unbounded or fractional length produces DDL the target engine rejects. */
function safeLength(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_VARCHAR_LENGTH);
}

export function normalizeSchema(raw: unknown, dialect: Dialect, fallbackName = "Generated DB"): DbSchema | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const rawTables = Array.isArray(input.tables) ? input.tables : null;
  if (!rawTables || rawTables.length === 0) return null;

  const tables: DbTable[] = [];
  for (const rawTable of rawTables) {
    if (!rawTable || typeof rawTable !== "object") continue;
    const tableInput = rawTable as Record<string, unknown>;
    const tableName = tableNameFor(String(tableInput.name ?? ""));
    if (!tableName) continue;
    const rawColumns = Array.isArray(tableInput.columns) ? tableInput.columns : [];
    const columns: DbColumn[] = [];

    for (const rawColumn of rawColumns) {
      if (!rawColumn || typeof rawColumn !== "object") continue;
      const columnInput = rawColumn as Record<string, unknown>;
      const columnName = snake(String(columnInput.name ?? ""));
      if (!columnName) continue;
      if (columns.some((existing) => existing.name === columnName)) continue;

      const rawType = String(columnInput.type ?? "string").toLowerCase();
      let type: LogicalType = LOGICAL_TYPES.includes(rawType as LogicalType)
        ? (rawType as LogicalType)
        : coerceType(rawType);

      const references = normalizeRef(columnInput.references);
      if (references) type = "fk";
      if (columnName === "id") type = columnInput.type === "uuid" ? "uuid" : "id";

      columns.push({
        name: columnName,
        type,
        length: safeLength(columnInput.length),
        nullable: Boolean(columnInput.nullable),
        unique: Boolean(columnInput.unique),
        primaryKey: Boolean(columnInput.primaryKey) || columnName === "id",
        defaultNow: Boolean(columnInput.defaultNow),
        enumValues: safeEnumValues(columnInput.enumValues),
        references,
        note: typeof columnInput.note === "string" ? columnInput.note : undefined,
      });
    }

    if (!columns.some((column) => column.primaryKey)) columns.unshift(idColumn());
    tables.push({
      name: tableName,
      description: typeof tableInput.description === "string" ? tableInput.description : undefined,
      columns,
    });
  }

  if (tables.length === 0) return null;

  return {
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim() : fallbackName,
    description: typeof input.description === "string" ? input.description : "",
    dialect,
    tables: topoSort(pruneDanglingKeys(tables)),
    source: "ai",
    notes: [],
  };
}

function coerceType(raw: string): LogicalType {
  if (/(serial|autoincrement|identity)/.test(raw)) return "id";
  if (/uuid/.test(raw)) return "uuid";
  if (/(varchar|char|string|name)/.test(raw)) return "string";
  if (/text|longtext/.test(raw)) return "text";
  if (/mail/.test(raw)) return "email";
  if (/phone|tel/.test(raw)) return "phone";
  if (/url|link/.test(raw)) return "url";
  if (/bigint/.test(raw)) return "bigint";
  if (/(int|number|numeric)/.test(raw)) return "int";
  if (/(decimal|float|double|real)/.test(raw)) return "decimal";
  if (/(money|price|amount|currency)/.test(raw)) return "money";
  if (/(bool|bit)/.test(raw)) return "bool";
  if (/timestamp|datetime/.test(raw)) return "datetime";
  if (/date/.test(raw)) return "date";
  if (/time/.test(raw)) return "time";
  if (/json/.test(raw)) return "json";
  if (/enum/.test(raw)) return "enum";
  return "string";
}

function normalizeRef(value: unknown): DbColumn["references"] {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const table = tableNameFor(String(input.table ?? ""));
  if (!table) return undefined;
  const onDelete = String(input.onDelete ?? "cascade").toLowerCase();
  return {
    table,
    column: snake(String(input.column ?? "id")) || "id",
    onDelete:
      onDelete === "set null" || onDelete === "restrict" ? (onDelete as "set null" | "restrict") : "cascade",
  };
}

/* ------------------------------------------------------------------ */
/* One-click fix: patch an existing schema                             */
/* ------------------------------------------------------------------ */

export interface PatchResult {
  schema: DbSchema;
  summary: string;
  changed: boolean;
}

export function applyInstruction(schema: DbSchema, instruction: string, maxTables = 50): PatchResult {
  const text = instruction.toLowerCase().trim();
  const working: DbSchema = JSON.parse(JSON.stringify(schema));
  const changes: string[] = [];
  const findTable = (name: string) => working.tables.find((table) => table.name === name);

  const removeMatch = text.match(
    /(?:remove|delete|drop)\s+(?:the\s+)?(?:column\s+)?([a-z_ ]+?)\s+(?:column\s+)?from\s+(?:the\s+)?([a-z_ ]+?)(?:\s+table)?$/,
  );
  const dropTableMatch = text.match(/(?:remove|delete|drop)\s+(?:the\s+)?([a-z_ ]+?)\s*(?:table)?$/);
  const addColumnMatch = text.match(
    /(?:add|include|put)\s+(?:a\s+|an\s+|the\s+)?(?:column\s+)?([a-z_ ]+?)\s+(?:column\s+)?(?:to|in|on)\s+(?:the\s+)?([a-z_ ]+?)(?:\s+table)?$/,
  );
  const renameMatch = text.match(/rename\s+(?:the\s+)?([a-z_ ]+?)\s+(?:table\s+)?to\s+([a-z_ ]+?)(?:\s+table)?$/);
  const linkMatch = text.match(
    /(?:link|connect|relate|join)\s+(?:the\s+)?([a-z_ ]+?)\s+(?:table\s+)?(?:to|with)\s+(?:the\s+)?([a-z_ ]+?)(?:\s+table)?$/,
  );

  if (removeMatch) {
    const columnName = snake(removeMatch[1]);
    const table = findTable(tableNameFor(removeMatch[2]));
    if (table) {
      const before = table.columns.length;
      table.columns = table.columns.filter(
        (column) => column.name !== columnName || column.primaryKey === true,
      );
      if (table.columns.length !== before) changes.push(`Removed \`${columnName}\` from \`${table.name}\``);
    }
  } else if (renameMatch) {
    const from = tableNameFor(renameMatch[1]);
    const to = tableNameFor(renameMatch[2]);
    const table = findTable(from);
    if (table && to) {
      table.name = to;
      for (const other of working.tables) {
        for (const column of other.columns) {
          if (column.references?.table === from) column.references.table = to;
        }
      }
      changes.push(`Renamed \`${from}\` to \`${to}\``);
    }
  } else if (linkMatch) {
    const child = findTable(tableNameFor(linkMatch[1]));
    const parent = findTable(tableNameFor(linkMatch[2]));
    if (child && parent && child.name !== parent.name) {
      addRelationColumn(child, parent.name);
      changes.push(`Linked \`${child.name}\` → \`${parent.name}\` with a foreign key`);
    }
  } else if (addColumnMatch && findTable(tableNameFor(addColumnMatch[2]))) {
    const table = findTable(tableNameFor(addColumnMatch[2]));
    const columnName = snake(addColumnMatch[1]);
    if (table && columnName && !table.columns.some((column) => column.name === columnName)) {
      table.columns.push(inferColumn(columnName, working.tables.map((item) => item.name)));
      changes.push(`Added \`${columnName}\` to \`${table.name}\``);
    }
  }

  if (changes.length === 0 && /(remove|delete|drop)/.test(text) && dropTableMatch) {
    const target = tableNameFor(dropTableMatch[1]);
    if (findTable(target)) {
      working.tables = working.tables.filter((table) => table.name !== target);
      working.tables = pruneDanglingKeys(working.tables);
      changes.push(`Dropped table \`${target}\``);
    }
  }

  const destructive = /^(remove|delete|drop|clear)\b/.test(text);

  if (changes.length === 0 && destructive) {
    return {
      schema: working,
      summary: "Could not find that table or column — check the name and try again.",
      changed: false,
    };
  }

  if (changes.length === 0) {
    // Fall back to entity extraction: "add payment table", "also add suppliers and deliveries"
    const analysis = analyzePrompt(instruction);
    const existing = new Set(working.tables.map((table) => table.name));
    const candidates: string[] = [];

    for (const entity of analysis.entities) {
      if (!existing.has(entity)) candidates.push(entity);
    }
    if (candidates.length === 0 && /\b(add|create|new|include|need|want|put)\b/.test(text)) {
      const words = text.replace(
        /\b(add|create|new|make|include|need|want|put|table|tables|column|field|please|also|and|a|an|the|for|with|to|in|on|of|my|our|another|one)\b/g,
        " ",
      );
      for (const word of words.split(/[\s,]+/).filter(Boolean)) {
        if (!/^[a-z_]{3,}$/.test(word)) continue;
        const name = tableNameFor(word);
        if (!name || existing.has(name) || STOP_WORDS.has(singularize(name))) continue;
        candidates.push(name);
      }
    }

    const room = Math.max(0, maxTables - working.tables.length);
    const blocked = candidates.slice(room);

    for (const candidate of candidates.slice(0, room)) {
      const present = new Set([...existing, ...candidates]);
      const table = buildTable(candidate, present);
      working.tables.push(table);
      existing.add(candidate);
      changes.push(`Added \`${candidate}\` table with ${table.columns.length} columns`);
    }

    if (blocked.length > 0) {
      changes.push(
        `⚠ Plan limit of ${maxTables} tables reached — upgrade to add ${blocked
          .map((item) => `\`${item}\``)
          .join(", ")}`,
      );
    }

    for (const relation of analysis.relations) {
      const child = findTable(relation.child);
      if (child && existing.has(relation.parent)) {
        addRelationColumn(child, relation.parent, relation.column);
        changes.push(`Linked \`${relation.child}\` → \`${relation.parent}\``);
      }
    }

    // "...and link payments to students" once the new table exists
    if (linkMatch) {
      const child = findTable(tableNameFor(linkMatch[1]));
      const parent = findTable(tableNameFor(linkMatch[2]));
      if (child && parent && child.name !== parent.name) {
        addRelationColumn(child, parent.name);
        changes.push(`Linked \`${child.name}\` → \`${parent.name}\``);
      }
    }
  }

  working.tables = topoSort(pruneDanglingKeys(working.tables));

  return {
    schema: working,
    summary: changes.length ? changes.join(" · ") : "No change detected — try “add payments table” or “add phone to users”.",
    changed: changes.length > 0,
  };
}

export function inferColumn(name: string, tableNames: string[]): DbColumn {
  const clean = snake(name);
  if (clean.endsWith("_id")) {
    const target = tableNameFor(clean.slice(0, -3));
    if (tableNames.includes(target)) {
      return { name: clean, type: "fk", references: { table: target, column: "id", onDelete: "cascade" } };
    }
    return { name: clean, type: "int" };
  }
  if (/mail/.test(clean)) return { name: clean, type: "email", length: 160 };
  if (/(phone|mobile|tel|whatsapp)/.test(clean)) return { name: clean, type: "phone", length: 25 };
  if (/(url|link|website|photo|image|avatar)/.test(clean)) return { name: clean, type: "url" };
  if (/(price|amount|cost|fee|salary|total|balance|fare|rent|budget|revenue)/.test(clean)) {
    return { name: clean, type: "money" };
  }
  if (/(is_|has_|active|enabled|verified|paid)/.test(clean)) return { name: clean, type: "bool" };
  if (/(count|quantity|qty|number|age|stock|year|capacity|points)/.test(clean)) return { name: clean, type: "int" };
  if (/(rate|score|rating|percentage|weight|distance)/.test(clean)) return { name: clean, type: "decimal" };
  if (/(_at|timestamp|datetime)$/.test(clean)) return { name: clean, type: "datetime", defaultNow: clean === "created_at" };
  if (/(date|_on|birthday|dob)$/.test(clean)) return { name: clean, type: "date" };
  if (/(description|body|content|notes?|comment|bio|address)/.test(clean)) return { name: clean, type: "text", nullable: true };
  if (/(status|state|type|category|stage|level|role|method)/.test(clean)) {
    return { name: clean, type: "enum", enumValues: ["pending", "active", "inactive"] };
  }
  if (/json|meta|payload|config/.test(clean)) return { name: clean, type: "json", nullable: true };
  return { name: clean, type: "string", length: 150 };
}

export { buildTable, addRelationColumn, topoSort, KNOWN_TABLES };
