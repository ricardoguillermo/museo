// server.js — versión limpia
import express from "express";
import cors from "cors";
import QRCode from "qrcode";

const app = express();
app.use(express.json());

// CORS: Netlify + local, incluyendo Authorization y métodos de admin
const allow = ["https://museoqr.netlify.app", "http://localhost:5500"];
app.use(
  cors({
    origin: (o, cb) =>
      cb(null, !o || allow.includes((o || "").replace(/\/$/, ""))),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());

// Health check
app.get("/", (_req, res) => res.status(200).send("OK Museo API"));

// ---- "DB" en memoria de ejemplo ----
const piezas = [
  {
    id: "001",
    titulo: "Pata de vaca",
    descripcion: "Árbol ornamental con flores rosadas. Muy usado en veredas.",
    img: "https://TU-PULLZONE.b-cdn.net/media/img/pata_de_vaca.jpg",
    audio: "",
    video: "",
    lectura_auto: true,
    etiquetas: ["botánica"],
    actualizado: "2025-09-12T15:00:00Z",
  },
  {
    id: "002",
    titulo: "Lapacho amarillo",
    descripcion:
      "Floración intensa a fines de invierno y principios de primavera.",
    img: "https://TU-PULLZONE.b-cdn.net/media/img/lapacho.jpg",
    audio: "",
    video: "",
    lectura_auto: false,
    etiquetas: ["botánica"],
    actualizado: "2025-09-12T15:10:00Z",
  },
];

// Lectura
app.get("/api/piezas", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(piezas);
});
app.get("/api/piezas/:id", (req, res) => {
  const p = piezas.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "No encontrada" });
  res.set("Cache-Control", "no-store");
  res.json(p);
});

// QR
app.get("/api/qrcode", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Falta ?url=");
  const png = await QRCode.toBuffer(url, { margin: 1, scale: 6 });
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(png);
});

// --- Auth por token para escritura ---
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
function norm(body = {}) {
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
    actualizado: new Date().toISOString(),
  };
}
// Upsert
app.post("/api/piezas", auth, (req, res) => {
  const p = norm(req.body);
  if (!p.id || !p.titulo)
    return res.status(400).json({ error: "id y titulo son obligatorios" });
  const i = piezas.findIndex((x) => x.id === p.id);
  if (i >= 0) piezas[i] = { ...piezas[i], ...p };
  else piezas.push(p);
  res.json(p);
});
// Reemplazo por id
app.put("/api/piezas/:id", auth, (req, res) => {
  const id = String(req.params.id).trim();
  const p = norm({ ...req.body, id });
  if (!p.id || !p.titulo)
    return res.status(400).json({ error: "id y titulo son obligatorios" });
  const i = piezas.findIndex((x) => x.id === id);
  if (i >= 0) piezas[i] = p;
  else piezas.push(p);
  res.json(p);
});
// Borrar
app.delete("/api/piezas/:id", auth, (req, res) => {
  const id = String(req.params.id).trim();
  const before = piezas.length;
  for (let i = piezas.length - 1; i >= 0; i--)
    if (piezas[i].id === id) piezas.splice(i, 1);
  res.json({ ok: true, removed: before - piezas.length });
});
// Export
app.get("/api/export", auth, (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(piezas);
});

// Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API OK en puerto", PORT));
