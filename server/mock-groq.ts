/**
 * Мок Groq API для локальной проверки без ключа и без интернета.
 * Запуск: npx tsx server/mock-groq.ts  (порт MOCK_PORT, по умолчанию 9099)
 * Затем:  GROQ_API_KEY=mock GROQ_BASE_URL=http://127.0.0.1:9099/openai/v1 npx tsx server/index.ts
 *
 * Это инструмент разработки и проверки контрактов, а не замена
 * реальному распознаванию: он возвращает заранее заданные тексты.
 */
import express from 'express';

const PORT = Number(process.env.MOCK_PORT ?? 9099);
const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));

let transcribeCalls = 0;
let formatCalls = 0;
const failNext = { transcribe429: 0, format500: 0 };

app.get('/openai/v1/models', (_req, res) => {
  res.json({
    data: [
      { id: 'whisper-large-v3-turbo' },
      { id: 'whisper-large-v3' },
      { id: 'openai/gpt-oss-20b' },
    ],
  });
});

app.post('/openai/v1/audio/transcriptions', (req, res) => {
  transcribeCalls += 1;
  if (failNext.transcribe429 > 0) {
    failNext.transcribe429 -= 1;
    res.setHeader('retry-after', '3');
    res.status(429).json({ error: { message: 'rate limit exceeded' } });
    return;
  }
  const contentType = req.header('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    res.status(400).json({ error: { message: 'expected multipart/form-data' } });
    return;
  }
  res.json({
    text: 'э-э, ну, давай встретимся во вторник, то есть в четверг, как бы, в общем, в шесть',
    language: 'ru',
    duration: 6.4,
    segments: [{ no_speech_prob: 0.01, avg_logprob: -0.12 }],
  });
});

app.post('/openai/v1/chat/completions', (req, res) => {
  formatCalls += 1;
  if (failNext.format500 > 0) {
    failNext.format500 -= 1;
    res.status(500).json({ error: { message: 'upstream boom' } });
    return;
  }
  const body = req.body as { messages?: Array<{ role: string; content: string }> };
  const userText = body.messages?.find((m) => m.role === 'user')?.content ?? '';
  const raw = userText.replace(/^Расшифровка диктовки:\n/, '');
  //  не работает для кириллицы в JS — режем филлеры без границ слова.
  let cleaned = raw;
  // Несколько проходов: совпадения идут встык («э-э, ну,»), за один проход /g их не снять.
  for (let pass = 0; pass < 4; pass += 1) {
    cleaned = cleaned.replace(
      /(^|[\s,.])(э-э|эээ|ну|как бы|в общем|типа|вот|короче)(?=[\s,.!?]|$)[\s,.]*/gi,
      '$1',
    );
  }
  cleaned = cleaned
    .replace(/во вторник, то есть в четверг/g, 'в четверг')
    .replace(/\s+/g, ' ')
    .trim();
  res.json({
    choices: [{ message: { content: cleaned.charAt(0).toUpperCase() + cleaned.slice(1) + '.' } }],
  });
});

app.post('/__mock/fail', (req, res) => {
  const body = req.body as { transcribe429?: number; format500?: number };
  failNext.transcribe429 = body.transcribe429 ?? 0;
  failNext.format500 = body.format500 ?? 0;
  res.json({ ok: true, failNext });
});

app.get('/__mock/stats', (_req, res) => {
  res.json({ transcribeCalls, formatCalls });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[mock-groq] слушает 0.0.0.0:${PORT}`);
});
