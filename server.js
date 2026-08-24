const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
  res.send('<h1>✅ YouTube Downloader API is Live (Powered by Cobalt Engine)</h1>');
});

// --- 1. ENDPOINT TO FETCH VIDEO INFO ---
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'YouTube URL is required' });

  try {
    // Extract video ID from URL
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    const videoId = (match && match[2].length === 11) ? match[2] : null;

    // Fetch video title via YouTube oEmbed (Never blocked by cloud IPs)
    const oembedRes = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
    const oembedData = await oembedRes.json();

    const title = oembedData.title || 'YouTube Video';
    const thumbnail = videoId 
      ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` 
      : (oembedData.thumbnail_url || '');

    // Available download qualities
    const formats = [
      { itag: '1080', quality: '1080p', container: 'mp4' },
      { itag: '720', quality: '720p', container: 'mp4' },
      { itag: '480', quality: '480p', container: 'mp4' },
      { itag: '360', quality: '360p', container: 'mp4' },
      { itag: 'audio', quality: 'Audio Only', container: 'mp3' },
    ];

    res.json({
      title,
      thumbnail,
      duration: 'Unknown',
      formats,
    });
  } catch (err) {
    console.error('Metadata error:', err);
    res.status(500).json({ error: 'Failed to retrieve video information.' });
  }
});

// --- 2. ENDPOINT TO DOWNLOAD / STREAM VIA COBALT ---
app.get('/api/download', async (req, res) => {
  const { url, itag, title } = req.query;

  try {
    const isAudio = itag === 'audio';

    // Request direct high-speed stream from Cobalt API
    const response = await fetch('https://api.cobalt.tools/', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        videoQuality: isAudio ? '720' : itag,
        downloadMode: isAudio ? 'audio' : 'auto',
      }),
    });

    const data = await response.json();

    if (data.url) {
      // Redirect mobile app directly to the high-speed download CDN stream
      return res.redirect(data.url);
    } else {
      throw new Error(data.text || 'Cobalt processing failed');
    }
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Failed to generate download stream.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});