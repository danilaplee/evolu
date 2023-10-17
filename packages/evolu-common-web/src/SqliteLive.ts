import {
  Sqlite,
  SqliteRow,
  parseJsonResults,
  valuesToSqliteValues,
} from "@evolu/common";
import { Effect, Function, Layer } from "effect";

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

if (typeof document !== "undefined")
  // @ts-expect-error Missing types.
  self.sqlite3ApiConfig = {
    debug: Function.constVoid,
    log: Function.constVoid,
    warn: Function.constVoid,
    error: Function.constVoid,
  };

const sqlitePromise = sqlite3InitModule().then((sqlite3) => {
  return typeof document === "undefined"
    ? new sqlite3.oo1.OpfsDb("/evolu/evolu1.db", "c")
    : new sqlite3.oo1.JsStorageDb("local");
});

const exec: Sqlite["exec"] = (arg) =>
  Effect.gen(function* (_) {
    const sqlite = yield* _(Effect.promise(() => sqlitePromise));
    const isSqlString = typeof arg === "string";
    const rows = sqlite.exec(isSqlString ? arg : arg.sql, {
      returnValue: "resultRows",
      rowMode: "object",
      ...(!isSqlString && { bind: valuesToSqliteValues(arg.parameters) }),
    }) as SqliteRow[];
    parseJsonResults(rows);
    return { rows, changes: sqlite.changes() };
  });

export const SqliteLive = Layer.succeed(Sqlite, { exec });