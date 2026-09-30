import type { DbSchema } from "@/lib/types";

const BOX_WIDTH = 250;
const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 21;
const COL_GAP = 120;
const ROW_GAP = 40;
const PADDING = 48;

interface Placed {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: { name: string; type: string; isPk: boolean; isFk: boolean; y: number }[];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function shortType(type: string, length?: number): string {
  switch (type) {
    case "id":
      return "PK";
    case "fk":
      return "FK";
    case "string":
      return `varchar${length ? `(${length})` : ""}`;
    case "money":
      return "decimal";
    case "datetime":
      return "timestamp";
    default:
      return type;
  }
}

export function generateDiagramSVG(schema: DbSchema): string {
  const levels = new Map<string, number>();
  const byName = new Map(schema.tables.map((table) => [table.name, table]));

  const depth = (name: string, seen = new Set<string>()): number => {
    if (levels.has(name)) return levels.get(name) as number;
    if (seen.has(name)) return 0;
    seen.add(name);
    const table = byName.get(name);
    if (!table) return 0;
    const parents = table.columns
      .map((column) => column.references?.table)
      .filter((parent): parent is string => Boolean(parent) && parent !== name && byName.has(parent as string));
    const value = parents.length === 0 ? 0 : Math.max(...parents.map((parent) => depth(parent, seen))) + 1;
    levels.set(name, value);
    return value;
  };

  schema.tables.forEach((table) => depth(table.name));

  const columns: string[][] = [];
  for (const table of schema.tables) {
    const level = levels.get(table.name) ?? 0;
    if (!columns[level]) columns[level] = [];
    columns[level].push(table.name);
  }

  const placed: Placed[] = [];
  let maxHeight = 0;

  columns.forEach((group, columnIndex) => {
    let y = PADDING + 44;
    for (const name of group) {
      const table = byName.get(name);
      if (!table) continue;
      const height = HEADER_HEIGHT + table.columns.length * ROW_HEIGHT + 8;
      const x = PADDING + columnIndex * (BOX_WIDTH + COL_GAP);
      placed.push({
        name,
        x,
        y,
        width: BOX_WIDTH,
        height,
        rows: table.columns.map((column, rowIndex) => ({
          name: column.name,
          type: shortType(column.type, column.length),
          isPk: Boolean(column.primaryKey || column.type === "id"),
          isFk: Boolean(column.references),
          y: y + HEADER_HEIGHT + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2,
        })),
      });
      y += height + ROW_GAP;
      maxHeight = Math.max(maxHeight, y);
    }
  });

  const width = PADDING * 2 + Math.max(1, columns.length) * BOX_WIDTH + Math.max(0, columns.length - 1) * COL_GAP;
  const height = Math.max(maxHeight + PADDING, 420);
  const placedByName = new Map(placed.map((item) => [item.name, item]));

  const edges: string[] = [];
  for (const table of schema.tables) {
    const child = placedByName.get(table.name);
    if (!child) continue;
    table.columns.forEach((column) => {
      if (!column.references) return;
      const parent = placedByName.get(column.references.table);
      if (!parent || parent.name === child.name) return;
      const row = child.rows.find((item) => item.name === column.name);
      if (!row) return;

      const fromRight = parent.x > child.x;
      const startX = fromRight ? child.x + child.width : child.x;
      const startY = row.y;
      const endX = fromRight ? parent.x : parent.x + parent.width;
      const endY = parent.y + HEADER_HEIGHT / 2;
      const dx = Math.max(50, Math.abs(endX - startX) / 2);
      const c1 = fromRight ? startX + dx : startX - dx;
      const c2 = fromRight ? endX - dx : endX + dx;

      edges.push(
        `<path d="M ${startX} ${startY} C ${c1} ${startY}, ${c2} ${endY}, ${endX} ${endY}" fill="none" stroke="url(#edge)" stroke-width="1.8" marker-end="url(#arrow)" opacity="0.85"/>`,
        `<circle cx="${startX}" cy="${startY}" r="3.2" fill="#38bdf8"/>`,
      );
    });
  }

  const boxes = placed
    .map((item) => {
      const rows = item.rows
        .map((row) => {
          const color = row.isPk ? "#fbbf24" : row.isFk ? "#38bdf8" : "#cbd5f5";
          const icon = row.isPk ? "🔑" : row.isFk ? "🔗" : "•";
          return [
            `<text x="${item.x + 14}" y="${row.y + 4}" font-family="ui-monospace, Menlo, monospace" font-size="11" fill="${color}">${escapeXml(
              `${icon} ${row.name}`,
            )}</text>`,
            `<text x="${item.x + item.width - 14}" y="${row.y + 4}" text-anchor="end" font-family="ui-monospace, Menlo, monospace" font-size="10" fill="#64748b">${escapeXml(
              row.type,
            )}</text>`,
          ].join("");
        })
        .join("");

      return `
<g>
  <rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" rx="12" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>
  <path d="M ${item.x} ${item.y + 12} a 12 12 0 0 1 12 -12 h ${item.width - 24} a 12 12 0 0 1 12 12 v ${HEADER_HEIGHT - 12} h -${item.width} z" fill="url(#header)"/>
  <text x="${item.x + 14}" y="${item.y + 23}" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="700" fill="#f8fafc">${escapeXml(
    item.name,
  )}</text>
  ${rows}
</g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="header" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#4338ca"/>
      <stop offset="100%" stop-color="#0ea5e9"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#a855f7"/>
    </marker>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#1e293b" stroke-width="0.6"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="#020617"/>
  <rect width="${width}" height="${height}" fill="url(#grid)" opacity="0.5"/>
  <text x="${PADDING}" y="${PADDING - 6}" font-family="Inter, system-ui, sans-serif" font-size="20" font-weight="800" fill="#f8fafc">${escapeXml(
    schema.name,
  )}</text>
  <text x="${PADDING}" y="${PADDING + 14}" font-family="Inter, system-ui, sans-serif" font-size="11" fill="#64748b">ER diagram · ${
    schema.tables.length
  } tables · generated by DBW AI (${schema.dialect})</text>
  ${edges.join("")}
  ${boxes}
</svg>`;
}

export function generateReadme(schema: DbSchema, dialectFile: string): string {
  const relations = schema.tables.flatMap((table) =>
    table.columns
      .filter((column) => column.references)
      .map((column) => `- \`${table.name}.${column.name}\` → \`${column.references?.table}.${column.references?.column}\``),
  );

  return `# ${schema.name}

Generated with **DBW AI · ZeroBox AI Schema** — text/voice to production-ready SQL.

## What's inside

| File | Purpose |
| --- | --- |
| \`${dialectFile}\` | Full \`CREATE TABLE\` statements, keys, indexes and foreign keys |
| \`sample_data.sql\` | Realistic seed rows for every table (run after the schema) |
| \`diagram.png\` | Visual ER diagram |
| \`diagram.svg\` | Vector version of the ER diagram |

## How to import

### phpMyAdmin (MySQL)
1. Create a database, e.g. \`${schema.tables[0]?.name ?? "app"}_db\`
2. Open **Import → Choose file → ${dialectFile} → Go**
3. Repeat with \`sample_data.sql\`

### MySQL Workbench / CLI
\`\`\`bash
mysql -u root -p your_database < ${dialectFile}
mysql -u root -p your_database < sample_data.sql
\`\`\`

### PostgreSQL
\`\`\`bash
psql -U postgres -d your_database -f ${dialectFile}
psql -U postgres -d your_database -f sample_data.sql
\`\`\`

### SQLite
\`\`\`bash
sqlite3 app.db < ${dialectFile}
\`\`\`

### Supabase
Paste the SQL into **SQL Editor → New query → Run**. RLS policies are included.

## Tables (${schema.tables.length})
${schema.tables.map((table) => `- **${table.name}** — ${table.columns.length} columns${table.description ? ` · ${table.description}` : ""}`).join("\n")}

## Relationships
${relations.length ? relations.join("\n") : "- No foreign keys in this schema"}

---
Built with ❤️ by DBW AI
`;
}
