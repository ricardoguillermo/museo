import express from "express";
import cors from "cors";
import QRCode from "qrcode";

const app = express();
app.use(express.json());

// CORS
const allow = [
  (process.env.ALLOW_ORIGIN || "").replace(/\/$/, ""), // ej: https://museoqr.netlify.app
  "http://localhost:5500",
].filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const o = origin.replace(/\/$/, "");
      cb(null, allow.includes(o));
    },
  })
);
app.options("*", cors());

// health check
app.get("/", (_req, res) => res.status(200).send("OK Museo API"));

// datos demo
const piezas = [
  {
    id: "001",
    titulo: "Caballo de crin dorada",
    descripcion: "Árbol ornamental…",
    img: "https://museo-cdn.b-cdn.net/media/img/caballo.jpg",
    audio: "https://museo-cdn.b-cdn.net/media/audio/caballo.mp3",
    video: "",
    lectura_auto: true,
    etiquetas: ["botánica"],
    actualizado: "2025-09-12T15:00:00Z",
  },
  {
    id: "002",
    titulo: "Perro de agua",
    descripcion: "Floración intensa…",
    img: "https://museo-cdn.b-cdn.net/media/img/perro.jpg",
    audio: "https://museo-cdn.b-cdn.net/media/audio/caballo.mp3",
    video: "",
    lectura_auto: false,
    etiquetas: ["botánica"],
    actualizado: "2025-09-12T15:10:00Z",
  },
];

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
app.get("/api/qrcode", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Falta ?url=");
  const png = await QRCode.toBuffer(url, { margin: 1, scale: 6 });
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(png);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API OK en puerto", PORT));
