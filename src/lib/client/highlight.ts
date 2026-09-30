const KEYWORDS = [
  "CREATE",
  "TABLE",
  "DROP",
  "IF",
  "NOT",
  "NULL",
  "EXISTS",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "CONSTRAINT",
  "UNIQUE",
  "DEFAULT",
  "AUTO_INCREMENT",
  "AUTOINCREMENT",
  "ENGINE",
  "CHARSET",
  "INSERT",
  "INTO",
  "VALUES",
  "SET",
  "ON",
  "DELETE",
  "UPDATE",
  "CASCADE",
  "RESTRICT",
  "INDEX",
  "ALTER",
  "ENABLE",
  "ROW",
  "LEVEL",
  "SECURITY",
  "POLICY",
  "FOR",
  "SELECT",
  "TO",
  "USING",
  "WITH",
  "CHECK",
  "TYPE",
  "AS",
  "ENUM",
  "PRAGMA",
  "BEGIN",
  "COMMIT",
  "TRANSACTION",
  "EXTENSION",
  "INT",
  "INTEGER",
  "UNSIGNED",
  "VARCHAR",
  "CHAR",
  "TEXT",
  "DECIMAL",
  "REAL",
  "BOOLEAN",
  "TINYINT",
  "BIGINT",
  "DATE",
  "DATETIME",
  "TIMESTAMPTZ",
  "TIME",
  "JSON",
  "JSONB",
  "SERIAL",
  "UUID",
  "CURRENT_TIMESTAMP",
  "TRUE",
  "FALSE",
  "NAMES",
  "FOREIGN_KEY_CHECKS",
];

const KEYWORD_PATTERN = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "gi");

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightSql(code: string): string {
  const escaped = escapeHtml(code);
  const pattern = /(--[^\n]*)|('(?:[^']|'')*')|(`[^`]*`|"[^"]*")|(\b\d+(?:\.\d+)?\b)/g;

  let result = "";
  let lastIndex = 0;

  const highlightKeywords = (chunk: string) =>
    chunk.replace(KEYWORD_PATTERN, (match) => `<span class="kw">${match}</span>`);

  for (const match of escaped.matchAll(pattern)) {
    const index = match.index ?? 0;
    result += highlightKeywords(escaped.slice(lastIndex, index));
    if (match[1]) result += `<span class="cmt">${match[1]}</span>`;
    else if (match[2]) result += `<span class="str">${match[2]}</span>`;
    else if (match[3]) result += `<span class="id">${match[3]}</span>`;
    else if (match[4]) result += `<span class="num">${match[4]}</span>`;
    lastIndex = index + match[0].length;
  }
  result += highlightKeywords(escaped.slice(lastIndex));
  return result;
}
