import { normalizeSchema } from "@/lib/nlp/engine";
import type { DbSchema, Dialect } from "@/lib/types";

const SYSTEM_PROMPT = `You are a Senior Database Architect with 20 years of experience designing normalised production schemas.
Return ONLY valid minified JSON (no markdown, no prose) matching this TypeScript shape:

{
  "name": string,               // short database name, e.g. "Hospital Management DB"
  "description": string,
  "tables": [
    {
      "name": string,           // snake_case PLURAL table name
      "description": string,
      "columns": [
        {
          "name": string,             // snake_case
          "type": "id"|"uuid"|"fk"|"string"|"text"|"email"|"phone"|"url"|"slug"|"int"|"bigint"|"decimal"|"money"|"bool"|"date"|"datetime"|"time"|"json"|"enum",
          "length": number|null,      // for string types
          "nullable": boolean,
          "unique": boolean,
          "primaryKey": boolean,
          "defaultNow": boolean,      // true for created_at style columns
          "enumValues": string[]|null,
          "references": { "table": string, "column": "id", "onDelete": "cascade"|"set null"|"restrict" } | null
        }
      ]
    }
  ]
}

Rules:
- Every table starts with an "id" column of type "id" with primaryKey true.
- Foreign keys use type "fk", name "<singular_parent>_id" and a references object.
- Include created_at (datetime, defaultNow) on transactional tables.
- Use enums for status/type fields.
- 4 to 12 columns per table. Design proper 3NF relationships, including join tables when many-to-many.
- Understand English and Krio/pidgin phrasing.`;

export function aiProviderName(): "openai" | "anthropic" | null {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function voiceProviderAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Vocabulary and phrasing hints handed to the transcription model.
 *
 * Whisper's `prompt` field is not an instruction, it is a *style and spelling
 * primer*: the model treats it as a sample of the register it should produce.
 * That is what stops it rendering "foreign key" as "forane key" and
 * "one-to-many" as "won to many", which are the failures that actually show up
 * when someone dictates a schema out loud.
 */
const TRANSCRIBE_STYLE_HINT = [
  "A developer dictates the database they want to build.",
  "Terms: primary key, foreign key, one-to-many, many-to-many, table, column,",
  "index, join, schema, migration, seed data, created at, updated at,",
  "auto increment, nullable, unique, cascade delete, enum, varchar, boolean.",
  "The speaker may use Krio, Nigerian Pidgin or English. Keep their own words and",
  "sentence order. Do not summarise, do not answer them, do not add or remove",
  "tables. Only add punctuation, capitalisation and paragraph breaks.",
].join(" ");

/**
 * `gpt-4o-transcribe` over `whisper-1` for two reasons that matter here: it is
 * markedly better on the Krio/pidgin-accented English this app is built for, and
 * it keeps proper nouns and casing intact, so a table the speaker calls
 * "Apointment" is not silently normalised into something else.
 *
 * The env var still wins, so an existing deployment is not forced to change.
 */
function transcribeModel(): string {
  return process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-transcribe";
}

/** Only these two accept a `temperature`; sending it elsewhere is a 400. */
function transcribeSupportsTemperature(model: string): boolean {
  return model === "whisper-1" || model.startsWith("gpt-4o-transcribe");
}

function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function callOpenAI(userPrompt: string): Promise<unknown | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content;
  return content ? extractJson(content) : null;
}

async function callAnthropic(userPrompt: string): Promise<unknown | null> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { content?: { text?: string }[] };
  const text = payload.content?.map((part) => part.text ?? "").join("") ?? "";
  return extractJson(text);
}

async function callModel(userPrompt: string): Promise<unknown | null> {
  const provider = aiProviderName();
  try {
    if (provider === "openai") return await callOpenAI(userPrompt);
    if (provider === "anthropic") return await callAnthropic(userPrompt);
  } catch {
    return null;
  }
  return null;
}

export async function generateSchemaWithAI(prompt: string, dialect: Dialect, maxTables: number): Promise<DbSchema | null> {
  if (!aiProviderName()) return null;
  const json = await callModel(
    `User request: """${prompt}"""\nTarget SQL dialect: ${dialect}. Maximum ${maxTables} tables. Output the JSON now.`,
  );
  if (!json) return null;
  return normalizeSchema(json, dialect);
}

export async function refineSchemaWithAI(
  schema: DbSchema,
  instruction: string,
  maxTables: number,
): Promise<DbSchema | null> {
  if (!aiProviderName()) return null;
  const json = await callModel(
    `Here is an existing schema JSON:\n${JSON.stringify({ name: schema.name, tables: schema.tables })}\n\nApply this change without rebuilding from scratch: """${instruction}"""\nKeep all existing tables and columns unless the user asked to remove them. Maximum ${maxTables} tables. Output the full updated JSON now.`,
  );
  if (!json) return null;
  return normalizeSchema(json, schema.dialect, schema.name);
}

export async function transcribeAudio(file: Blob, fileName: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const model = transcribeModel();
  const form = new FormData();
  form.append("file", file, fileName);
  form.append("model", model);
  form.append("prompt", TRANSCRIBE_STYLE_HINT);
  // 0 asks for the most likely token at every position. Any randomness here
  // shows up directly in the text the user is about to build a database from.
  if (transcribeSupportsTemperature(model)) form.append("temperature", "0");
  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { text?: string };
    // The model can return a blank string for silence; callers treat any falsy
    // value as a failure, so normalise it here rather than at three call sites.
    const text = payload.text?.trim();
    return text ? text : null;
  } catch {
    return null;
  }
}
