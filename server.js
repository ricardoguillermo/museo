// server.js — API Museo (Node 20+, "type":"module")
// CORS blindado + CRUD + Postgres fallback + QR + Upload a Bunny

import express from "express";
import QRCode from "qrcode";
import multer from "multer";

const app = express();
app.use(express.json());

// ---------------- CORS BLINDADO ----------------
const ALLOW_SET = new Set(
  String(process.env.ALLOW_ORIGIN || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, "")) // sin barra final
    .filter(Boolean)
);

// agrega tus orígenes de dev si querés
ALLOW_SET.add("http://localhost:5500");

app.use((req, res, next) => {
  const origin = (req.headers.origin || "").replace(/\/$/, "");
  if (origin && (ALLOW_SET.has(origin) || ALLOW_SET.has("*"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,DELETE,OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type"
    );
  }
  if (req.method === "OPTIONS") return res.sendStatus(204); // preflight OK siempre
  next();
});

// ---------------- Health ----------------
app.get("/", (_req, res) => res.status(200).send("OK Museo API"));

// ---------------- Auth por token ----------------
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
function auth(req, res, next) {
  if (!ADMIN_TOKEN)
    return res.status(501).json({ error: "Admin no habilitado" });
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer "))
    return res.status(401).json({ error: "Falta token" });
  if (h.slice(7) !== ADMIN_TOKEN)
    return res.status(403).json({ error: "Token inválido" });
  next();
}

// ---------------- Normalizador ----------------
const norm = (body = {}) => {
  const etiquetas = Array.isArray(body.etiquetas)
    ? body.etiquetas
    : String(body.etiquetas || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  return {
    id: String(body.id || "").trim(),
    titulo: String(body.titulo || "").trim(),
    descripcion: String(body.descripcion || "").trim(),
    img: body.img || "",
    audio: body.audio || "",
    video: body.video || "",
    lectura_auto: !!body.lectura_auto,
    etiquetas,
  };
};

// ---------------- Capa de datos (PG ó Memoria) ----------------
const url = process.env.DATABASE_URL || "";
let USE_PG = /^postgres(ql)?:\/\//i.test(url);

let db = {};
if (USE_PG) {
  try {
    const { default: pg } = await import("pg");
    const { Pool } = pg;
    const pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS piezas (
        id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        descripcion TEXT,
        img TEXT,
        audio TEXT,
        video TEXT,
        lectura_auto BOOLEAN DEFAULT FALSE,
        etiquetas TEXT[] DEFAULT '{}',
        actualizado TIMESTAMPTZ DEFAULT now()
      );
    `);

    db.list = async () =>
      (
        await pool.query(
          `SELECT id,titulo,descripcion,img,audio,video,lectura_auto,etiquetas,actualizado
       FROM piezas ORDER BY id ASC`
        )
      ).rows;

    db.get = async (id) =>
      (
        await pool.query(
          `SELECT id,titulo,descripcion,img,audio,video,lectura_auto,etiquetas,actualizado
       FROM piezas WHERE id=$1 LIMIT 1`,
          [id]
        )
      ).rows[0] || null;

    db.upsert = async (p) => {
      await pool.query(
        `
        INSERT INTO piezas(id,titulo,descripcion,img,audio,video,lectura_auto,etiquetas,actualizado)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8, now())
        ON CONFLICT (id) DO UPDATE SET
          titulo=EXCLUDED.titulo,
          descripcion=EXCLUDED.descripcion,
          img=EXCLUDED.img,
          audio=EXCLUDED.audio,
          video=EXCLUDED.video,
          lectura_auto=EXCLUDED.lectura_auto,
          etiquetas=EXCLUDED.etiquetas,
          actualizado=now()
      `,
        [
          p.id,
          p.titulo,
          p.descripcion,
          p.img,
          p.audio,
          p.video,
          p.lectura_auto,
          Array.isArray(p.etiquetas)
            ? p.etiquetas
            : String(p.etiquetas || "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
        ]
      );
      return { ...p, actualizado: new Date().toISOString() };
    };

    db.remove = async (id) =>
      (await pool.query(`DELETE FROM piezas WHERE id=$1`, [id])).rowCount;
    db.exportAll = async () => await db.list();
  } catch (e) {
    console.error(
      "DB connection failed, falling back to memory:",
      e?.message || e
    );
    USE_PG = false;
  }
}

if (!USE_PG) {
  const piezas = []; // arranca vacío en memoria
  db.list = async () =>
    piezas.slice().sort((a, b) => (a.id || "").localeCompare(b.id || ""));
  db.get = async (id) => piezas.find((x) => x.id === id) || null;
  db.upsert = async (p) => {
    const i = piezas.findIndex((x) => x.id === p.id);
    const out = {
      ...(i >= 0 ? piezas[i] : {}),
      ...p,
      actualizado: new Date().toISOString(),
    };
    if (i >= 0) piezas[i] = out;
    else piezas.push(out);
    return out;
  };
  db.remove = async (id) => {
    const before = piezas.length;
    for (let i = before - 1; i >= 0; i--)
      if (piezas[i].id === id) piezas.splice(i, 1);
    return before - piezas.length;
  };
  db.exportAll = async () => piezas;
}

// ---------------- Endpoints CRUD ----------------
app.get("/api/piezas", async (_req, res) => {
  const rows = await db.list();
  res.set("Cache-Control", "no-store");
  res.json(rows);
});

app.get("/api/piezas/:id", async (req, res) => {
  const p = await db.get(req.params.id);
  if (!p) return res.status(404).json({ error: "No encontrada" });
  res.set("Cache-Control", "no-store");
  res.json(p);
});

app.post("/api/piezas", auth, async (req, res) => {
  const p = norm(req.body || {});
  if (!p.id || !p.titulo)
    return res.status(400).json({ error: "id y titulo son obligatorios" });
  res.json(await db.upsert(p));
});

app.put("/api/piezas/:id", auth, async (req, res) => {
  const p = norm({ ...req.body, id: req.params.id });
  if (!p.id || !p.titulo)
    return res.status(400).json({ error: "id y titulo son obligatorios" });
  res.json(await db.upsert(p));
});

app.delete("/api/piezas/:id", auth, async (req, res) => {
  const removed = await db.remove(req.params.id);
  res.json({ ok: true, removed });
});

app.get("/api/export", auth, async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await db.exportAll());
});

// ---------------- QR ----------------
app.get("/api/qrcode", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Falta ?url=");
  const png = await QRCode.toBuffer(url, { margin: 1, scale: 6 });
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(png);
});

// ---------------- Upload a Bunny ----------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.post("/api/upload", auth, upload.single("file"), async (req, res) => {
  try {
    const ZONE = process.env.BUNNY_STORAGE_ZONE;
    const HOST = (
      process.env.BUNNY_STORAGE_HOST || "storage.bunnycdn.com"
    ).replace(/^https?:\/\//, "");
    const KEY = process.env.BUNNY_API_KEY;
    const PULL = (process.env.BUNNY_PULLZONE_HOST || "")
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");

    // Diagnóstico: indica qué falta
    const missing = [];
    if (!ZONE) missing.push("BUNNY_STORAGE_ZONE");
    if (!HOST) missing.push("BUNNY_STORAGE_HOST");
    if (!KEY) missing.push("BUNNY_API_KEY");
    if (!PULL) missing.push("BUNNY_PULLZONE_HOST");
    if (missing.length)
      return res.status(500).json({ error: "Bunny no configurado", missing });

    if (!req.file)
      return res.status(400).json({ error: "Falta archivo 'file'" });

    const kind = (req.body.kind || "img").replace(/[^a-z]/g, "");
    let base = (
      req.body.filename ||
      req.file.originalname ||
      "archivo"
    ).replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!base.includes(".")) {
      const ext = (req.file.mimetype.split("/")[1] || "").split(";")[0];
      if (ext) base += "." + ext;
    }
    const path = `media/${kind}/${base}`;

    const urlPut = `https://${HOST}/${encodeURIComponent(ZONE)}/${path}`;
    const r = await fetch(urlPut, {
      method: "PUT",
      headers: { AccessKey: KEY, "Content-Type": "application/octet-stream" },
      body: req.file.buffer,
    });

    if (!r.ok) {
      const bodyTxt = await r.text().catch(() => "");
      console.error("Bunny upload error:", r.status, bodyTxt);
      return res.status(r.status).json({
        error: "Bunny rechazó la subida",
        bunnyStatus: r.status,
        bunnyBody: bodyTxt.slice(0, 400),
      });
    }

    const cdnUrl = `https://${PULL}/${path}`;
    res.json({ ok: true, kind, path, cdnUrl });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// ---------------- Listen ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("API OK en puerto", PORT, USE_PG ? "(Postgres)" : "(Memoria)")
);
