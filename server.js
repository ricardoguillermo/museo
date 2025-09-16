import express from "express";
import cors from "cors";
import QRCode from "qrcode";

const app = express();
app.use(express.json());

// CORS: permite Netlify y local
import cors from "cors";

const allow = [
  process.env.ALLOW_ORIGIN, // https://museoqr.netlify.app
  "http://localhost:5500",
]
  .filter(Boolean)
  .map((s) => s.replace(/\/$/, "")); // sin barra final

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl / tests locales
      const o = origin.replace(/\/$/, "");
      cb(null, allow.includes(o));
    },
  })
);

// "DB" simple en memoria (poné acá tus piezas con URLs de Bunny)
const piezas = [
  {
    id: "001",
    titulo: "Pata de vaca",
    descripcion: "Árbol ornamental con flores rosadas. Muy usado en veredas.",
    img: "https://TU-PULLZONE.b-cdn.net/media/img/pata_de_vaca.jpg",
    audio: "https://TU-PULLZONE.b-cdn.net/media/audio/pata_de_vaca.mp3",
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

// Endpoints
app.get("/api/piezas/:id", (req, res) => {
  const p = piezas.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "No encontrada" });
  res.set("Cache-Control", "no-store");
  res.json(p);
});

app.get("/api/piezas", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(piezas);
});

// QR PNG: /api/qrcode?url=https://.../view.html?id=001
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
