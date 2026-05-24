import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react';
import { upload } from '@vercel/blob/client';
import { CheckCircle2, Loader2, Play, Radio, RefreshCw, UploadCloud, UserRound, Waves } from 'lucide-react';

type Reflection = {
  id: string;
  name: string;
  audioUrl: string;
  mediaType: string;
  note: string;
  timestamp: string;
};

type UploadState = 'idle' | 'uploading' | 'uploaded' | 'error';
type SubmitState = 'idle' | 'submitting' | 'submitted' | 'error';

const initialForm = {
  name: '',
  note: '',
  audioUrl: '',
  mediaType: '',
};

function sanitizeUploadName(value: string) {
  const extension = value.includes('.') ? `.${value.split('.').pop()}` : '';
  const baseName = value
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${baseName || 'reflection'}${extension || '.bin'}`;
}

function App() {
  const isUploadPage = window.location.pathname.replace(/\/+$/, '') === '/upload';

  return (
    <main className="app">
      <AmbientStage />
      {isUploadPage ? <UploadPage /> : <PlaybackPage />}
    </main>
  );
}

function PlaybackPage() {
  const { reflections, latestReflection, isLoading, message, loadReflections } = useReflections();

  return (
    <>
      <section className="playback-hero page-fade">
        <div className="hero-copy">
          <div className="signal-pills" aria-hidden="true">
            <span>Course Reflection</span>
            <span>Playback Wall</span>
            <span>Firestore Archive</span>
          </div>
          <p className="eyebrow">FINAL REVIEW CHANNEL</p>
          <h1 className="glitch-title" data-text="回响">回响</h1>
          <p className="subtitle">播放学生的课程总结。每一段声音与影像都会在这里成为现场的一次回响。</p>
          <div className="loading-track" aria-hidden="true"><span /></div>
          <div className="hero-actions">
            <a className="primary-action" href="/upload">
              <UploadCloud />
              上传课程总结
            </a>
            <button className="ghost-action" type="button" onClick={() => void loadReflections()}>
              <RefreshCw />
              刷新播放列表
            </button>
          </div>
          {message && <p className="terminal-line"><i /> {message}</p>}
        </div>
      </section>

      <section className="archive-section playback-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PLAYBACK WALL</p>
            <h2>课程总结播放列表</h2>
          </div>
        </div>

        {latestReflection && (
          <article className="featured-player">
            <div>
              <p className="eyebrow">NOW PLAYING</p>
              <h3>{latestReflection.name}</h3>
              <p>{latestReflection.note || '这是一段来自课程现场的回响。'}</p>
            </div>
            <MediaPlayer reflection={latestReflection} featured />
          </article>
        )}

        <div className="reflection-grid">
          {isLoading && <p className="empty-state">正在同步播放列表...</p>}
          {!isLoading && reflections.length === 0 && <p className="empty-state">还没有课程总结。等待第一段回响上传。</p>}
          {reflections.map((reflection, index) => (
            <article className="reflection-card" key={reflection.id}>
              <div className="card-index">{String(index + 1).padStart(2, '0')}</div>
              <h3>{reflection.name}</h3>
              <p>{reflection.note || '未填写总结文字'}</p>
              <MediaPlayer reflection={reflection} />
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function UploadPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState(initialForm);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [message, setMessage] = useState('');
  const hasUpload = Boolean(form.audioUrl);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setUploadState('uploading');
    setSubmitState('idle');
    setMessage('正在上传到 Vercel Blob...');

    try {
      const blob = await upload(`reflections/${Date.now()}-${sanitizeUploadName(file.name)}`, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        contentType: file.type || 'application/octet-stream',
        multipart: true,
        clientPayload: JSON.stringify({
          fileName: file.name,
          mediaType: file.type || 'application/octet-stream',
        }),
        onUploadProgress: ({ percentage }) => {
          setMessage(`正在上传到 Vercel Blob... ${Math.round(percentage)}%`);
        },
      });

      setForm((current) => ({
        ...current,
        audioUrl: blob.url,
        mediaType: file.type || 'application/octet-stream',
      }));
      setUploadState('uploaded');
      setMessage('上传成功，文件 URL 已写入表单状态。');
    } catch (error) {
      setUploadState('error');
      setForm((current) => ({ ...current, audioUrl: '', mediaType: '' }));
      setMessage(error instanceof Error ? error.message : '上传失败');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState('submitting');
    setMessage('正在保存到 Firestore...');

    try {
      const response = await fetch('/api/reflections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as { reflection?: Reflection; error?: string };
      if (!response.ok || !payload.reflection) throw new Error(payload.error || '保存失败');

      setForm(initialForm);
      setSelectedFileName('');
      setUploadState('idle');
      setSubmitState('submitted');
      setMessage('已保存。新的回响已经加入播放列表。');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      setSubmitState('error');
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  }

  const statusText = useMemo(() => {
    if (uploadState === 'uploading') return 'UPLOADING TO BLOB';
    if (uploadState === 'uploaded') return 'BLOB URL READY';
    if (submitState === 'submitting') return 'WRITING FIRESTORE';
    if (submitState === 'submitted') return 'SAVED';
    return 'WAITING FOR UPLOAD';
  }, [submitState, uploadState]);

  return (
    <section className="upload-page page-fade">
      <div className="upload-intro">
        <div className="signal-pills" aria-hidden="true">
          <span>Submit</span>
          <span>Vercel Blob</span>
          <span>Firestore</span>
        </div>
        <p className="eyebrow">UPLOAD CHANNEL</p>
        <h1 className="glitch-title upload-title" data-text="上传">上传</h1>
        <p className="subtitle">填写姓名并上传课程总结视频或音频。上传完成后，URL 会自动进入表单并随姓名一起保存。</p>
        <div className="hero-actions">
          <a className="ghost-action" href="/">返回播放界面</a>
        </div>
        <p className="terminal-line"><i /> {statusText}</p>
      </div>

      <form className="upload-console" onSubmit={handleSubmit}>
        <div className="console-heading">
          <div>
            <p className="eyebrow">SUBMIT A SIGNAL</p>
            <h2>上传课程总结</h2>
          </div>
          <UploadCloud aria-hidden="true" />
        </div>

        <label className="field-label" htmlFor="student-name">学生姓名</label>
        <div className="input-wrap">
          <UserRound aria-hidden="true" />
          <input
            id="student-name"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="请输入姓名"
            required
          />
        </div>

        <label className="field-label" htmlFor="reflection-note">一句总结</label>
        <textarea
          id="reflection-note"
          value={form.note}
          onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
          placeholder="可以写下这段视频或音频想表达的内容"
          rows={3}
        />

        <label className="upload-drop" htmlFor="reflection-file">
          <input
            ref={fileInputRef}
            id="reflection-file"
            type="file"
            accept="audio/*,video/*"
            onChange={handleFileChange}
          />
          <span className="upload-icon">
            {uploadState === 'uploading' ? <Loader2 className="spin" /> : <UploadCloud />}
          </span>
          <strong>{selectedFileName || '选择视频或音频文件'}</strong>
          <em>{hasUpload ? 'URL 已自动写入表单' : '上传后会先进入学生自己的 Vercel Blob'}</em>
        </label>

        <label className="field-label" htmlFor="audio-url">audioUrl</label>
        <input
          id="audio-url"
          className="url-field"
          value={form.audioUrl}
          onChange={(event) => setForm((current) => ({ ...current, audioUrl: event.target.value }))}
          placeholder="上传成功后自动填入"
          required
        />

        {message && <p className={`form-message ${uploadState === 'error' || submitState === 'error' ? 'is-error' : ''}`}>{message}</p>}

        <button className="primary-action" type="submit" disabled={!form.name.trim() || !hasUpload || submitState === 'submitting'}>
          {submitState === 'submitting' ? <Loader2 className="spin" /> : <CheckCircle2 />}
          保存到 Firestore
        </button>
      </form>
    </section>
  );
}

function useReflections() {
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  async function loadReflections() {
    setIsLoading(true);
    try {
      const response = await fetch('/api/reflections');
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 503) {
          setMessage('配置 Firebase Admin 后会显示已保存的课程总结。');
          setReflections([]);
          return;
        }
        throw new Error(payload.error || '无法读取课程总结');
      }
      const payload = (await response.json()) as { reflections?: Reflection[] };
      setReflections(payload.reflections ?? []);
      setMessage('播放列表已同步');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法读取课程总结');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadReflections();
  }, []);

  return {
    reflections,
    latestReflection: reflections[0],
    isLoading,
    message,
    loadReflections,
  };
}

function MediaPlayer({ reflection, featured = false }: { reflection: Reflection; featured?: boolean }) {
  const isVideo = reflection.mediaType.startsWith('video/');

  return (
    <div className={featured ? 'media-shell featured' : 'media-shell'}>
      <div className="media-badge">
        {isVideo ? <Play /> : <Waves />}
        {isVideo ? 'VIDEO' : 'AUDIO'}
      </div>
      {isVideo ? (
        <video src={reflection.audioUrl} controls playsInline />
      ) : (
        <audio src={reflection.audioUrl} controls />
      )}
    </div>
  );
}

function AmbientStage() {
  const traceLines = [
    'M-30 590 C130 510 120 360 250 310 C380 200 505 250 665 470 C830 350 900 330 980 310',
    'M40 720 C190 620 285 705 382 585 C510 425 610 690 790 520 C850 475 890 450 930 430',
    'M120 85 C260 170 185 300 330 330 475 380 430 505 610 535 735 566 750 430 960 365',
    'M-20 250 C110 205 180 160 255 220 340 295 455 110 555 180 675 252 720 120 920 92',
    'M25 430 L160 515 L285 475 L390 610 L520 565 L670 730 L830 690 L985 780',
  ];

  return (
    <div className="ambient-stage" aria-hidden="true">
      <div className="deep-field" />
      <div className="signal-dust" />
      <svg className="constellation-map" viewBox="0 0 1000 860" preserveAspectRatio="none">
        {traceLines.map((line, index) => (
          <path className="trace-line" d={line} key={line} style={{ '--i': index } as CSSProperties} />
        ))}
        {Array.from({ length: 34 }).map((_, index) => (
          <circle
            className="trace-node"
            cx={(index * 89 + 42) % 1000}
            cy={(index * 137 + 64) % 860}
            key={index}
            r={(index % 4) + 1.2}
            style={{ '--delay': `${(index % 8) * 0.31}s` } as CSSProperties}
          />
        ))}
      </svg>
      <div className="wave wave-a" />
      <div className="wave wave-b" />
      <div className="grid-noise" />
      {Array.from({ length: 80 }).map((_, index) => (
        <span
          className="particle"
          key={index}
          style={{
            '--x': `${(index * 47 + 11) % 100}%`,
            '--y': `${(index * 61 + 7) % 100}%`,
            '--delay': `${(index % 13) * 0.28}s`,
            '--size': `${2 + (index % 4)}px`,
          } as CSSProperties}
        />
      ))}
      <Radio className="corner-glyph" />
    </div>
  );
}

export default App;
