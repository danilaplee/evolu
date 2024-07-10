import SQLite from "better-sqlite3";
import bodyParser from "body-parser";
import cors from "cors";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Exit from "effect/Exit";
import { flow } from "effect/Function";
import * as Match from "effect/Match";
import express from "express";
import { Kysely, SqliteDialect } from "kysely";
import path from "path";
import { Server, ServerLive } from "../Server.js";
import { Database, Db } from "../Types.js";
import { createServer } from "http";
import WebSocket from "ws";

// Array to keep track of connected WebSocket clients
const clients: WebSocket[] = [];

// Function to broadcast messages to all connected clients
const broadcast = (data: ArrayBufferLike) => {
  clients.map((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
};
const createDb = (fileName: string) =>
  new Kysely<Database>({
    dialect: new SqliteDialect({
      database: new SQLite(path.join(process.cwd(), "/", fileName)),
    }),
  });

export const createExpressAppGenerator = Effect.gen(function* (_) {
  const server = yield* _(
    Server.pipe(
      Effect.provide(ServerLive),
      Effect.provideService(Db, createDb("db.sqlite")),
    ),
  );

  yield* _(server.initDatabase);

  const app = express();
  app.use(cors());
  app.use(bodyParser.raw({ limit: "20mb", type: "application/x-protobuf" }));

  app.post("/", (req, res) => {
    Effect.runCallback(server.sync(req.body as Uint8Array), {
      onExit: Exit.match({
        onFailure: flow(
          Cause.failureOrCause,
          Either.match({
            onLeft: flow(
              Match.value,
              Match.tagsExhaustive({
                BadRequestError: ({ error }) => {
                  res.status(400).send(JSON.stringify(error));
                },
              }),
            ),
            onRight: (error) => {
              console.error(error);
              res.status(500).send("Internal Server Error");
            },
          }),
        ),
        onSuccess: (buffer) => {
          res.setHeader("Content-Type", "application/x-protobuf");
          res.send(buffer);
          try {
            broadcast(buffer);
          } catch (err) {
            console.error("broadcast error", err, buffer);
          }
        },
      }),
    });
  });

  return { app, server };
});

// Main startup function
export const createExpressAppWithWebsocket = async (port?: Number) => {
  try {
    const { app, server } = await Effect.runPromise(createExpressAppGenerator);

    const httpServer = createServer(app);
    const wss = new WebSocket.Server({ server: httpServer });

    wss.on("connection", (ws) => {
      // Add new client to the list
      clients.push(ws);
      ws.on("message", async (message: WebSocket.RawData) => {
        try {
          // Convert message to Uint8Array if it is not already
          let uint8ArrayMessage: Uint8Array;
          if (message instanceof Uint8Array) {
            uint8ArrayMessage = message;
          } else if (message instanceof ArrayBuffer) {
            uint8ArrayMessage = new Uint8Array(message);
          } else if (Array.isArray(message)) {
            uint8ArrayMessage = Buffer.concat(message);
          } else {
            uint8ArrayMessage = new Uint8Array(message);
          }

          const response = await Effect.runPromise(
            server.sync(uint8ArrayMessage),
          );
          ws.send(response);
        } catch (error) {
          console.error("Error handling sync request:", error);
          ws.send(JSON.stringify({ error: "Failed to process sync request" }));
        }
      });
    });

    const PORT = port || process.env.PORT || 4000;
    httpServer.listen(PORT, () => {
      console.log(
        `HTTP and WebSocket server started on http://localhost:${PORT}`,
      );
    });
    return { app, server };
  } catch (error) {
    console.error("Failed to start the server:", error);
    throw error;
  }
};
