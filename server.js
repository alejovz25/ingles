const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Carpetas para almacenar archivos subidos y datos persistentes
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

[UPLOADS_DIR, DATA_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Datos iniciales por defecto
const DEFAULT_STORE = {
  meta: {
    vocarooUrl: '',
    organizerName: '',
    organizerOpinion: ''
  },
  gallery: [],
  comments: [
    {
      id: 'seed-1',
      name: 'Laura Restrepo',
      team: 'Fan — Team Águilas',
      message: 'Great atmosphere every Thursday at 2:00 p.m.! Love seeing new students learning softball at the synthetic field.',
      date: 'UdeA Campus',
      createdAt: 1700000000000
    },
    {
      id: 'seed-2',
      name: 'Mateo Ríos',
      team: 'UdeA Spectator',
      message: 'Excited for the final on November 26! Great article by Alejandro and Wendy.',
      date: 'UdeA Campus',
      createdAt: 1700000001000
    }
  ]
};

function readStore() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_STORE, null, 2), 'utf8');
      return JSON.parse(JSON.stringify(DEFAULT_STORE));
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}

function writeStore(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Configuración de subida de fotos y videos (hasta 60 MB por archivo)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed.'));
    }
  }
});

app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

// Obtener todo el estado compartido (galería, comentarios, audio y entrevista)
app.get('/api/state', (_req, res) => {
  res.json(readStore());
});

// Guardar audio Vocaroo o entrevista del organizador
app.post('/api/meta', (req, res) => {
  const store = readStore();
  const { vocarooUrl, organizerName, organizerOpinion } = req.body || {};
  if (typeof vocarooUrl === 'string') store.meta.vocarooUrl = vocarooUrl.trim();
  if (typeof organizerName === 'string') store.meta.organizerName = organizerName.trim();
  if (typeof organizerOpinion === 'string') store.meta.organizerOpinion = organizerOpinion.trim();
  writeStore(store);
  res.json({ ok: true, meta: store.meta });
});

// Subir fotos o videos reales desde el dispositivo
app.post('/api/gallery/upload', upload.array('media', 10), (req, res) => {
  const store = readStore();
  const customCaption = (req.body.caption || '').trim();
  const uploadedFiles = req.files || [];

  const added = uploadedFiles.map((file) => {
    const isVideo = file.mimetype.startsWith('video/');
    const entry = {
      id: `${Date.now()}-${Math.round(Math.random() * 1e5)}`,
      src: `/uploads/${file.filename}`,
      filename: file.filename,
      kind: isVideo ? 'video' : 'image',
      caption: customCaption || file.originalname.replace(/\.[^/.]+$/, ''),
      createdAt: Date.now()
    };
    store.gallery.push(entry);
    return entry;
  });

  writeStore(store);
  res.json({ ok: true, added, gallery: store.gallery });
});

// Actualizar descripción de una foto o video
app.patch('/api/gallery/:id', (req, res) => {
  const store = readStore();
  const item = store.gallery.find((g) => g.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false });
  if (typeof req.body.caption === 'string') {
    item.caption = req.body.caption.trim() || 'Tournament highlight';
  }
  writeStore(store);
  res.json({ ok: true, item });
});

// Eliminar una foto o video
app.delete('/api/gallery/:id', (req, res) => {
  const store = readStore();
  const idx = store.gallery.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false });

  const [removed] = store.gallery.splice(idx, 1);
  if (removed && removed.filename) {
    const filePath = path.join(UPLOADS_DIR, removed.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  writeStore(store);
  res.json({ ok: true });
});

// Agregar comentario del espectador
app.post('/api/comments', (req, res) => {
  const store = readStore();
  const name = (req.body.name || '').trim().slice(0, 60);
  const team = (req.body.team || 'UdeA Spectator').trim().slice(0, 60);
  const message = (req.body.message || '').trim().slice(0, 320);

  if (!name || !message) {
    return res.status(400).json({ ok: false, error: 'Name and comment are required.' });
  }

  const newComment = {
    id: `c-${Date.now()}-${Math.round(Math.random() * 1e4)}`,
    name,
    team,
    message,
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    createdAt: Date.now()
  };

  store.comments.unshift(newComment);
  writeStore(store);
  res.json({ ok: true, comment: newComment, comments: store.comments });
});

app.listen(PORT, () => {
  console.log(`UdeA Softball Festival server running on port ${PORT}`);
});
