import { MongoClient } from "mongodb";
import { log } from "./logging.js";

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "radio_bot";

let client = null;
let db = null;
let connectPromise = null;

async function connect() {
  if (db) return db;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      client = new MongoClient(MONGO_URL, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      await client.connect();
      db = client.db(DB_NAME);
      log("INFO", `MongoDB verbunden: ${DB_NAME}`);
      return db;
    } catch (err) {
      log("ERROR", `MongoDB Verbindung fehlgeschlagen: ${err.message}`);
      connectPromise = null;
      throw err;
    }
  })();

  return connectPromise;
}

function getDb() {
  return db;
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    connectPromise = null;
  }
}

export { connect, getDb, close };
