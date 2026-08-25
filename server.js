const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Fallback instances in case the discovery API is slow
const DEFAULT_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yt.chocolatemoo53.com',
  'https://invidious.tiekoetter.com',
  'https://pipedapi.kavin.rocks',
];

// Helper to extract YouTube Video ID
const extractVideoId = (url) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
};

// 1. Dynamically get the top 5 healthiest live servers
const getLiveInstances = async () => {
  try {
    const res = await fetch('https://api.invidious.io/instances.json?sort_by=type,health', {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      const healthy = data
        .filter(([name, info]) => info.type === 'https' && info.api === true)
        .map(([name, info]) => info.uri)
        .slice(0, 5);

      if (healthy.length > 0) return healthy;
    }
  } catch (e) {
    console.log('[DISCOVERY] Using fallback list...');
  }
  return DEFAULT_INSTANCES;
};

// 2. Fetch video data with multi-engine fallback (Invidious + Piped)
const fetchVideoData = async (videoId) => {
  const instances = await getLiveInstances();

  for (const base of instances) {
    try {
      console.log(`[ENGINE] Trying: ${base}`);

      // Handle Piped API structure
      if (base.includes('piped')) {
        const res = await fetch(`${base}/streams/${videoId}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const piped = await res.json();
          // Filter progressive streams (video + audio)
          const formats = (piped.videoStreams || [])
            .filter((v) => !v.videoOnly && v.format === 'mp4')
            .map((v) => ({
              itag: v.quality,
              quality: v.quality,
              container: 'mp4',
              url: v.url,
            }));

          if (formats.length > 0) {
            console.log(`[ENGINE] ✅ Success using Piped (${base})`);
            return {
              title: piped.title,
              thumbnail: piped.thumbnailUrl,
              duration: String(piped.duration || 0),
              formats,
            };
          }
        }
      } 
      // Handle Invidious API structure
      else {
        const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const inv = await res.json();
          if (inv.formatStreams && inv.formatStreams.length > 0) {
            const formats = inv.formatStreams.map((f) => ({
              itag: f.itag || f.qualityLabel,
              quality: f.qualityLabel || f.resolution || 'MP4 Video',
              container: f.container || 'mp4',
              url: f.url,
            }));

            console.log(`[ENGINE] ✅ Success using Invidious (${base})`);
            return {
              title: inv.title,
              thumbnail: inv.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
              duration: String(inv.lengthSeconds || 0),
              formats,
            };
          }
        }
      }
    } catch (err) {
      console.warn(`[ENGINE] Failed ${base}: ${err.message}`);
    }
  }

  throw new Error('All media stream engines are currently busy. Please try again in a few seconds.');
};

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
  res.send('<h1>✅ YouTube Downloader API is Live</h1>');
});

// --- 1. ENDPOINT TO FETCH VIDEO INFO ---
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  const videoId = extractVideoId(url);

  if (!videoId) {
    return res.status(400).json({ error: 'Please provide a valid YouTube URL.' });
  }

  console.log(`[INFO] Fetching info for ID: ${videoId}`);

  try {
    const data = await fetchVideoData(videoId);
    
    // Deduplicate format labels
    const uniqueFormats = Array.from(
      new Map(data.formats.map((f) => [f.quality, f])).values()
    );

    res.json({
      title: data.title,
      thumbnail: data.thumbnail,
      duration: data.duration,
      formats: uniqueFormats,
    });
  } catch (err) {
    console.error('[EXTRACTION ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- 2. ENDPOINT TO STREAM DOWNLOAD DIRECTLY ---
app.get('/api/download', async (req, res) => {
  const { url, itag, title } = req.query;
  const videoId = extractVideoId(url);

  if (!videoId) {
    return res.status(400).send('Invalid YouTube URL');
  }

  console.log(`[DOWNLOAD] Processing ID: ${videoId} (itag: ${itag})`);

  try {
    const data = await fetchVideoData(videoId);
    const format = data.formats.find((f) => String(f.itag) === String(itag)) || data.formats[0];

    if (!format || !format.url) {
      return res.status(404).send('Stream URL not found');
    }

    const safeTitle = (title || data.title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');

    res.header('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
    res.header('Content-Type', 'video/mp4');

    // Fetch video stream from the CDN
    const videoStream = await fetch(format.url);
    if (!videoStream.ok) {
      return res.status(videoStream.status).send('CDN stream unavailable');
    }

    // Pipe response stream to mobile client
    const { Readable } = require('stream');
    Readable.fromWeb(videoStream.body).pipe(res);
  } catch (err) {
    console.error('[DOWNLOAD ERROR]:', err.message);
    res.status(500).send('Failed to stream video.');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});