const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Variables de entorno opcionales en Render para persistencia permanente en GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || ''; // Ej: "tu-usuario/torneo-softball-udea"
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');

[UPLOADS_DIR, DATA_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

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

// Sincroniza cualquier archivo nuevo o modificado directamente hacia GitHub para que Render no lo borre al reiniciar
async function syncFileToGitHub(repoPath, bufferContent, commitMessage) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return;
  try {
    const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${repoPath}`;
    const headers = {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'UdeA-Softball-App'
    };

    let sha;
    const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    }

    await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: commitMessage,
        content: bufferContent.toString('base64'),
        branch: GITHUB_BRANCH,
        ...(sha ? { sha } : {})
      })
    });
  } catch (err) {
    console.error('GitHub sync warning:', err.message);
  }
}

function readStore() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_STORE, null, 2), 'utf8');
      return JSON.parse(JSON.stringify(DEFAULT_STORE));
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}

async function writeStore(data) {
  const jsonString = JSON.stringify(data, null, 2);
  fs.writeFileSync(DB_FILE, jsonString, 'utf8');
  await syncFileToGitHub('data/store.json', Buffer.from(jsonString, 'utf8'), 'Update article data');
}

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
  limits: { fileSize: 25 * 1024 * 1024 },
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

app.get('/api/state', (_req, res) => {
  res.json(readStore());
});

app.post('/api/meta', async (req, res) => {
  const store = readStore();
  const { vocarooUrl, organizerName, organizerOpinion } = req.body || {};
  if (typeof vocarooUrl === 'string') store.meta.vocarooUrl = vocarooUrl.trim();
  if (typeof organizerName === 'string') store.meta.organizerName = organizerName.trim();
  if (typeof organizerOpinion === 'string') store.meta.organizerOpinion = organizerOpinion.trim();
  await writeStore(store);
  res.json({ ok: true, meta: store.meta });
});

app.post('/api/gallery/upload', upload.array('media', 10), async (req, res) => {
  const store = readStore();
  const customCaption = (req.body.caption || '').trim();
  const uploadedFiles = req.files || [];
  const added = [];

  for (const file of uploadedFiles) {
    const isVideo = file.mimetype.startsWith('video/');
    const fileBuffer = fs.readFileSync(file.path);
    await syncFileToGitHub(`public/uploads/${file.filename}`, fileBuffer, `Upload ${file.filename}`);

    const entry = {
      id: `${Date.now()}-${Math.round(Math.random() * 1e5)}`,
      src: `/uploads/${file.filename}`,
      filename: file.filename,
      kind: isVideo ? 'video' : 'image',
      caption: customCaption || file.originalname.replace(/\.[^/.]+$/, ''),
      createdAt: Date.now()
    };
    store.gallery.push(entry);
    added.push(entry);
  }

  await writeStore(store);
  res.json({ ok: true, added, gallery: store.gallery });
});

app.patch('/api/gallery/:id', async (req, res) => {
  const store = readStore();
  const item = store.gallery.find((g) => g.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false });
  if (typeof req.body.caption === 'string') {
    item.caption = req.body.caption.trim() || 'Tournament highlight';
  }
  await writeStore(store);
  res.json({ ok: true, item });
});

app.delete('/api/gallery/:id', async (req, res) => {
  const store = readStore();
  const idx = store.gallery.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false });

  const [removed] = store.gallery.splice(idx, 1);
  if (removed && removed.filename) {
    const filePath = path.join(UPLOADS_DIR, removed.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await writeStore(store);
  res.json({ ok: true });
});

app.post('/api/comments', async (req, res) => {
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
  await writeStore(store);
  res.json({ ok: true, comment: newComment, comments: store.comments });
});

app.listen(PORT, () => {
  console.log(`UdeA Softball Festival server running on port ${PORT}`);
});
