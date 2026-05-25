import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Camera, CheckCircle2, Circle, Loader2, Play, RefreshCw, RotateCcw, Square, UploadCloud, UserRound, Waves } from 'lucide-react';

type Program = {
  text: string;
  updatedAt: string;
};

type Work = {
  id?: string;
  studentId?: string;
  studentName?: string;
  workIndex?: number;
  workUrl: string;
  coverUrl: string;
  createdAt?: string;
};

type Summary = {
  id: string;
  fullName: string;
  textSummary: string;
  videoSummaryUrl: string;
  createdAt: string;
};

type UploadInitResponse = {
  uploadId: string;
  objectKey: string;
  uploadUrl: string;
  publicUrl: string;
  expiresAt?: string;
};

type UploadState = 'idle' | 'uploading' | 'uploaded' | 'error';
type SubmitState = 'idle' | 'submitting' | 'submitted' | 'error';
type RecordingState = 'idle' | 'camera-ready' | 'recording' | 'recorded' | 'error';

const defaultEventApiBase = 'https://show-plan-event-backend.liucheng-show-plan.workers.dev';
const eventApiBase = (import.meta.env.VITE_EVENT_API_BASE || defaultEventApiBase).replace(/\/+$/, '');
const roleOptions = ['导演组', '舞台监督', '视觉设计', '音频技术', '摄影摄像', '主持串联', '场务执行', '互动设计'];

const initialForm = {
  fullName: '',
  roles: [] as string[],
  textSummary: '',
  videoSummaryUrl: '',
  work1Url: '',
  cover1Url: '',
  work2Url: '',
  cover2Url: '',
  uploadId: '',
  objectKey: '',
  sizeBytes: 0,
  durationMs: 0,
  videoWidth: 0,
  videoHeight: 0,
};

function buildApiUrl(path: string) {
  return `${eventApiBase}${path.startsWith('/') ? path : `/${path}`}`;
}

function sanitizeUploadName(value: string) {
  const extension = value.includes('.') ? `.${value.split('.').pop()}` : '';
  const baseName = value
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${baseName || 'reflection'}${extension || '.bin'}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatTimestamp(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function getRecorderMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text.slice(0, 180));
  }
}

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}) {
  const response = await fetch(buildApiUrl(path), {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await readJsonResponse<T & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || `请求失败：HTTP ${response.status}`);
  }

  return payload;
}

async function requestUploadInit(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
  externalUserId: string;
  durationMs?: number;
  width?: number;
  height?: number;
  metadata?: Record<string, string | number | boolean>;
}) {
  return api<UploadInitResponse>('/api/uploads/init', {
    method: 'POST',
    body: input,
  });
}

async function completeUpload(uploadId: string) {
  return api<{ ok?: boolean; publicUrl?: string }>('/api/uploads/complete', {
    method: 'POST',
    body: { uploadId },
  });
}

function putBlobToUploadUrl(input: {
  uploadUrl: string;
  blob: Blob;
  contentType: string;
  onProgress: (percentage: number) => void;
}) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', input.uploadUrl);
    xhr.setRequestHeader('Content-Type', input.contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        input.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`视频上传失败：HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('视频上传失败，请检查网络或跨域配置'));
    xhr.send(input.blob);
  });
}

function getUploadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '上传失败');
  if (message.includes('HTTP 413')) return '视频过大，超过活动后端允许的大小限制。';
  return message;
}

function buildWorksPayload(form: typeof initialForm) {
  const works = [
    { index: 1, workUrl: form.work1Url.trim(), coverUrl: form.cover1Url.trim() },
    { index: 2, workUrl: form.work2Url.trim(), coverUrl: form.cover2Url.trim() },
  ];

  const normalized: Array<{ workUrl: string; coverUrl: string }> = [];
  for (const work of works) {
    if (!work.workUrl && !work.coverUrl) continue;
    if (!work.workUrl || !work.coverUrl) {
      throw new Error(`作品 ${work.index} 需要同时填写作品链接和封面链接。`);
    }
    if (!isHttpsUrl(work.workUrl) || !isHttpsUrl(work.coverUrl)) {
      throw new Error(`作品 ${work.index} 的链接必须是 HTTPS URL。`);
    }
    normalized.push({ workUrl: work.workUrl, coverUrl: work.coverUrl });
  }

  if (!normalized.length) {
    throw new Error('请至少填写 1 份作品链接和封面链接。');
  }

  return normalized.slice(0, 2);
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
  const { data, isLoading, message, load } = usePublicEventData();
  const latestSummary = data.summaries[0];
  const programLines = data.program.text.split(/\r?\n/).filter((line) => line.trim());

  return (
    <>
      <section className="playback-hero page-fade">
        <div className="hero-copy">
          <div className="signal-pills" aria-hidden="true">
            <span>Student Client</span>
            <span>Public Event API</span>
            <span>{eventApiBase.replace(/^https?:\/\//, '')}</span>
          </div>
          <p className="eyebrow">FINAL REVIEW CHANNEL</p>
          <h1 className="glitch-title" data-text="回响">回响</h1>
          <p className="subtitle">公开页面直接读取活动后端的节目单、作品列表和课程总结，学生端录制完成后可在上传页直接提交。</p>
          <div className="loading-track" aria-hidden="true"><span /></div>
          <div className="hero-actions">
            <a className="primary-action" href="/upload">
              <UploadCloud />
              进入学生上传页
            </a>
            <button className="ghost-action" type="button" onClick={() => void load()}>
              <RefreshCw />
              刷新公开数据
            </button>
          </div>
          {message && <p className="terminal-line"><i /> {message}</p>}
        </div>
      </section>

      <section className="archive-section playback-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PUBLIC SNAPSHOT</p>
            <h2>节目单、作品与总结</h2>
          </div>
        </div>

        {latestSummary && (
          <article className="featured-player">
            <div>
              <p className="eyebrow">LATEST SUMMARY</p>
              <h3>{latestSummary.fullName}</h3>
              <p>{latestSummary.textSummary || '这位同学暂未填写文本总结。'}</p>
              <p className="meta-line">提交时间：{formatTimestamp(latestSummary.createdAt)}</p>
            </div>
            <MediaPlayer summary={latestSummary} featured />
          </article>
        )}

        <div className="reflection-grid">
          <article className="reflection-card">
            <div className="card-index">01</div>
            <h3>节目单</h3>
            {programLines.length ? (
              <ol className="program-list">
                {programLines.map((line, index) => (
                  <li key={`${line}-${index}`}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <p>{line}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p>后台尚未配置节目单。</p>
            )}
          </article>

          <article className="reflection-card">
            <div className="card-index">02</div>
            <h3>作品列表</h3>
            {isLoading && !data.works.length ? (
              <p>正在同步作品列表...</p>
            ) : data.works.length ? (
              <div className="work-link-list">
                {data.works.map((work) => (
                  <a className="work-link-card" href={work.workUrl} target="_blank" rel="noreferrer" key={work.id || `${work.studentName}-${work.workUrl}`}>
                    <img src={work.coverUrl} alt={`${work.studentName || '同学'} 作品封面`} />
                    <span>{work.studentName || '未命名同学'} · 作品 {work.workIndex ?? 1}</span>
                  </a>
                ))}
              </div>
            ) : (
              <p>暂无作品数据。</p>
            )}
          </article>

          <article className="reflection-card">
            <div className="card-index">03</div>
            <h3>总结列表</h3>
            {isLoading && !data.summaries.length ? (
              <p>正在同步课程总结...</p>
            ) : data.summaries.length ? (
              <div className="summary-link-list">
                {data.summaries.map((summary) => (
                  <div className="summary-item" key={summary.id}>
                    <strong>{summary.fullName}</strong>
                    <p>{summary.textSummary}</p>
                    <a href={summary.videoSummaryUrl} target="_blank" rel="noreferrer">查看视频总结</a>
                  </div>
                ))}
              </div>
            ) : (
              <p>暂无课程总结。</p>
            )}
          </article>
        </div>
      </section>
    </>
  );
}

function UploadPage() {
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const sourceStreamRef = useRef<MediaStream | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const recordedUrlRef = useRef('');
  const recordStartedAtRef = useRef(0);
  const [form, setForm] = useState(initialForm);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    return () => {
      stopCamera();
      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
    };
  }, []);

  function stopCamera() {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
    sourceStreamRef.current?.getTracks().forEach((track) => track.stop());
    canvasStreamRef.current?.getTracks().forEach((track) => track.stop());
    sourceStreamRef.current = null;
    canvasStreamRef.current = null;
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecordingState('error');
      setMessage('当前浏览器不支持摄像头录制，请换用最新版 Chrome、Edge 或 Safari。');
      return;
    }

    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      sourceStreamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
      setRecordingState('camera-ready');
      setMessage('前置摄像头已开启。');
    } catch {
      setRecordingState('error');
      setMessage('无法开启前置摄像头，请检查浏览器摄像头和麦克风权限。');
    }
  }

  function startRecording() {
    const sourceStream = sourceStreamRef.current;
    const sourceVideo = liveVideoRef.current;
    if (!sourceStream || !sourceVideo) {
      setMessage('请先开启前置摄像头。');
      return;
    }

    const sourceWidth = sourceVideo.videoWidth || 1280;
    const sourceHeight = sourceVideo.videoHeight || 720;
    const scale = Math.min(1280 / sourceWidth, 720 / sourceHeight, 1);
    const outputWidth = Math.max(2, Math.round((sourceWidth * scale) / 2) * 2);
    const outputHeight = Math.max(2, Math.round((sourceHeight * scale) / 2) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setMessage('无法创建 720p 压缩画布。');
      return;
    }

    const drawFrame = () => {
      context.save();
      context.translate(outputWidth, 0);
      context.scale(-1, 1);
      context.drawImage(sourceVideo, 0, 0, outputWidth, outputHeight);
      context.restore();
      animationFrameRef.current = requestAnimationFrame(drawFrame);
    };
    drawFrame();

    const canvasStream = canvas.captureStream(30);
    sourceStream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
    canvasStreamRef.current = canvasStream;

    const mimeType = getRecorderMimeType();
    chunksRef.current = [];
    recordStartedAtRef.current = performance.now();
    const recorder = new MediaRecorder(canvasStream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: 1_800_000,
      audioBitsPerSecond: 96_000,
    });

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      canvasStream.getTracks().forEach((track) => {
        if (track.kind === 'video') track.stop();
      });
      const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
      const durationMs = Math.max(0, Math.round(performance.now() - recordStartedAtRef.current));
      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
      const url = URL.createObjectURL(blob);
      recordedUrlRef.current = url;
      setRecordedBlob(blob);
      setRecordedUrl(url);
      setForm((current) => ({
        ...current,
        videoSummaryUrl: '',
        uploadId: '',
        objectKey: '',
        sizeBytes: blob.size,
        durationMs,
        videoWidth: outputWidth,
        videoHeight: outputHeight,
      }));
      setUploadState('idle');
      setRecordingState('recorded');
      setMessage(`录制完成，已压缩到最高 720p，文件体积 ${formatFileSize(blob.size)}。`);
    };

    recorderRef.current = recorder;
    recorder.start(1000);
    setRecordedBlob(null);
    setRecordingState('recording');
    setUploadState('idle');
    setSubmitState('idle');
    setMessage('正在录制并压缩到 720p...');
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }

  function resetRecording() {
    if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
    recordedUrlRef.current = '';
    setRecordedBlob(null);
    setRecordedUrl('');
    setForm((current) => ({
      ...current,
      videoSummaryUrl: '',
      uploadId: '',
      objectKey: '',
      sizeBytes: 0,
      durationMs: 0,
      videoWidth: 0,
      videoHeight: 0,
    }));
    setUploadState('idle');
    setSubmitState('idle');
    setRecordingState(sourceStreamRef.current ? 'camera-ready' : 'idle');
    setMessage(sourceStreamRef.current ? '可以重新录制。' : '');
  }

  async function uploadRecording() {
    if (!recordedBlob) {
      setMessage('请先完成录制。');
      return;
    }

    const filename = sanitizeUploadName(`summary-${Date.now()}.webm`);
    const contentType = 'video/webm';
    setUploadState('uploading');
    setSubmitState('idle');
    setMessage('正在初始化视频上传...');

    try {
      const upload = await requestUploadInit({
        filename,
        contentType,
        sizeBytes: recordedBlob.size,
        externalUserId: form.fullName.trim() || `student:${Date.now()}`,
        durationMs: form.durationMs || undefined,
        width: form.videoWidth || undefined,
        height: form.videoHeight || undefined,
        metadata: {
          source: 'review-student-client',
          fullName: form.fullName.trim() || 'anonymous',
          originalMimeType: recordedBlob.type || 'video/webm',
        },
      });
      setMessage('正在上传到活动后端视频存储... 0%');

      await putBlobToUploadUrl({
        uploadUrl: upload.uploadUrl,
        blob: recordedBlob,
        contentType,
        onProgress: (percentage) => {
          setMessage(`正在上传到活动后端视频存储... ${percentage}%`);
        },
      });
      await completeUpload(upload.uploadId);

      setForm((current) => ({
        ...current,
        videoSummaryUrl: upload.publicUrl,
        uploadId: upload.uploadId,
        objectKey: upload.objectKey,
        sizeBytes: recordedBlob.size,
      }));
      setUploadState('uploaded');
      setMessage('上传成功，视频总结链接已写入表单。');
    } catch (error) {
      setUploadState('error');
      setForm((current) => ({
        ...current,
        videoSummaryUrl: '',
        uploadId: '',
        objectKey: '',
      }));
      setMessage(getUploadErrorMessage(error));
    }
  }

  function toggleRole(role: string) {
    setForm((current) => ({
      ...current,
      roles: current.roles.includes(role) ? current.roles.filter((item) => item !== role) : [...current.roles, role],
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState('submitting');

    try {
      const works = buildWorksPayload(form);
      if (!form.fullName.trim()) throw new Error('请输入学生姓名。');
      if (!form.roles.length) throw new Error('请至少选择一个工作人员职能。');
      if (!form.textSummary.trim()) throw new Error('请输入文本总结。');
      if (!isHttpsUrl(form.videoSummaryUrl.trim())) throw new Error('请提供有效的 HTTPS 视频总结链接。');

      setMessage('正在提交到活动后端...');
      const payload = await api<{ ok?: boolean; student?: { id: string } }>('/api/students', {
        method: 'POST',
        body: {
          fullName: form.fullName.trim(),
          roles: form.roles,
          textSummary: form.textSummary.trim(),
          videoSummaryUrl: form.videoSummaryUrl.trim(),
          works,
        },
      });

      if (!payload.ok) throw new Error('提交失败');

      stopCamera();
      if (recordedUrlRef.current) {
        URL.revokeObjectURL(recordedUrlRef.current);
        recordedUrlRef.current = '';
      }
      setRecordedBlob(null);
      setRecordedUrl('');
      setForm(initialForm);
      setUploadState('idle');
      setRecordingState('idle');
      setSubmitState('submitted');
      setMessage('提交完成，公开页面刷新后即可看到新的总结和作品。');
    } catch (error) {
      setSubmitState('error');
      setMessage(error instanceof Error ? error.message : '提交失败');
    }
  }

  const statusText = useMemo(() => {
    if (recordingState === 'recording') return 'RECORDING 720P';
    if (recordingState === 'recorded') return 'RECORDING READY';
    if (uploadState === 'uploading') return 'UPLOADING TO EVENT BACKEND';
    if (uploadState === 'uploaded') return 'VIDEO URL READY';
    if (submitState === 'submitting') return 'SUBMITTING STUDENT RECORD';
    if (submitState === 'submitted') return 'SUBMITTED';
    return 'WAITING FOR CAMERA';
  }, [recordingState, submitState, uploadState]);

  return (
    <section className="upload-page page-fade">
      <div className="upload-intro">
        <div className="signal-pills" aria-hidden="true">
          <span>Submit Student</span>
          <span>Public Event API</span>
          <span>WebM Upload</span>
        </div>
        <p className="eyebrow">UPLOAD CHANNEL</p>
        <h1 className="glitch-title upload-title" data-text="上传">上传</h1>
        <p className="subtitle">填写姓名、多选职能、文本总结、1-2 个作品链接，并保留现有 WebM 录制上传流程直连活动后端。</p>
        <div className="hero-actions">
          <a className="ghost-action" href="/">返回公开页面</a>
        </div>
        <p className="terminal-line"><i /> {statusText}</p>
      </div>

      <form className="upload-console" onSubmit={handleSubmit}>
        <div className="console-heading">
          <div>
            <p className="eyebrow">SUBMIT A STUDENT</p>
            <h2>学生端最小可用表单</h2>
          </div>
          <UploadCloud aria-hidden="true" />
        </div>

        <label className="field-label" htmlFor="student-name">学生姓名</label>
        <div className="input-wrap">
          <UserRound aria-hidden="true" />
          <input
            id="student-name"
            value={form.fullName}
            onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
            placeholder="请输入姓名"
            required
          />
        </div>

        <div className="role-field">
          <span className="field-label">工作人员职能（可多选）</span>
          <div className="role-chip-grid">
            {roleOptions.map((role) => (
              <button
                className={form.roles.includes(role) ? 'role-chip selected' : 'role-chip'}
                type="button"
                key={role}
                onClick={() => toggleRole(role)}
              >
                {role}
              </button>
            ))}
          </div>
        </div>

        <label className="field-label" htmlFor="reflection-note">文本总结</label>
        <textarea
          id="reflection-note"
          value={form.textSummary}
          onChange={(event) => setForm((current) => ({ ...current, textSummary: event.target.value }))}
          placeholder="写下这次课程总结的核心内容"
          rows={4}
          required
        />

        <div className="camera-recorder">
          <div className="camera-preview">
            {recordedUrl ? (
              <video src={recordedUrl} controls playsInline />
            ) : (
              <>
                <video ref={liveVideoRef} autoPlay muted playsInline />
                {recordingState === 'idle' && <span>FRONT CAMERA</span>}
              </>
            )}
          </div>

          <div className="recording-meta">
            <span>输出：最高 1280 x 720</span>
            <span>格式：WebM</span>
            <span>体积：{form.sizeBytes ? formatFileSize(form.sizeBytes) : '等待录制'}</span>
          </div>

          <div className="recorder-actions">
            {recordingState === 'idle' || recordingState === 'error' ? (
              <button className="ghost-action" type="button" onClick={() => void startCamera()}>
                <Camera />
                开启前置摄像头
              </button>
            ) : null}
            {recordingState === 'camera-ready' ? (
              <button className="primary-action" type="button" onClick={startRecording}>
                <Circle />
                开始录制
              </button>
            ) : null}
            {recordingState === 'recording' ? (
              <button className="primary-action" type="button" onClick={stopRecording}>
                <Square />
                停止录制
              </button>
            ) : null}
            {recordingState === 'recorded' ? (
              <>
                <button className="ghost-action" type="button" onClick={resetRecording}>
                  <RotateCcw />
                  重新录制
                </button>
                <button className="primary-action" type="button" onClick={() => void uploadRecording()} disabled={uploadState === 'uploading'}>
                  {uploadState === 'uploading' ? <Loader2 className="spin" /> : <UploadCloud />}
                  上传录制视频
                </button>
              </>
            ) : null}
          </div>
        </div>

        <label className="field-label" htmlFor="video-summary-url">视频总结链接</label>
        <input
          id="video-summary-url"
          className="url-field"
          type="url"
          value={form.videoSummaryUrl}
          onChange={(event) => setForm((current) => ({ ...current, videoSummaryUrl: event.target.value }))}
          placeholder="上传成功后自动填入，也可手动填写 HTTPS 链接"
          required
        />

        <div className="two-column-fields">
          <div>
            <label className="field-label" htmlFor="work-url-1">作品链接 1</label>
            <input
              id="work-url-1"
              className="url-field"
              type="url"
              value={form.work1Url}
              onChange={(event) => setForm((current) => ({ ...current, work1Url: event.target.value }))}
              placeholder="https://..."
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="cover-url-1">作品封面 1</label>
            <input
              id="cover-url-1"
              className="url-field"
              type="url"
              value={form.cover1Url}
              onChange={(event) => setForm((current) => ({ ...current, cover1Url: event.target.value }))}
              placeholder="https://..."
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="work-url-2">作品链接 2</label>
            <input
              id="work-url-2"
              className="url-field"
              type="url"
              value={form.work2Url}
              onChange={(event) => setForm((current) => ({ ...current, work2Url: event.target.value }))}
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="field-label" htmlFor="cover-url-2">作品封面 2</label>
            <input
              id="cover-url-2"
              className="url-field"
              type="url"
              value={form.cover2Url}
              onChange={(event) => setForm((current) => ({ ...current, cover2Url: event.target.value }))}
              placeholder="https://..."
            />
          </div>
        </div>

        <p className="form-message">默认直连活动后端：{eventApiBase}</p>
        {message && <p className={`form-message ${uploadState === 'error' || submitState === 'error' ? 'is-error' : ''}`}>{message}</p>}

        <button className="primary-action" type="submit" disabled={submitState === 'submitting'}>
          {submitState === 'submitting' ? <Loader2 className="spin" /> : <CheckCircle2 />}
          提交到活动后端
        </button>
      </form>
    </section>
  );
}

function usePublicEventData() {
  const [data, setData] = useState({
    program: { text: '', updatedAt: '' } as Program,
    works: [] as Work[],
    summaries: [] as Summary[],
  });
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    setIsLoading(true);
    try {
      const [program, works, summaries] = await Promise.all([
        api<{ program: Program }>('/api/program'),
        api<{ works: Work[] }>('/api/works'),
        api<{ summaries: Summary[] }>('/api/summaries'),
      ]);
      setData({
        program: program.program ?? { text: '', updatedAt: '' },
        works: works.works ?? [],
        summaries: summaries.summaries ?? [],
      });
      setMessage('公开数据已同步');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '无法读取活动公开数据');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return {
    data,
    isLoading,
    message,
    load,
  };
}

function MediaPlayer({ summary, featured = false }: { summary: Summary; featured?: boolean }) {
  return (
    <div className={featured ? 'media-shell featured' : 'media-shell'}>
      <div className="media-badge">
        <Play />
        VIDEO SUMMARY
      </div>
      <video src={summary.videoSummaryUrl} controls playsInline />
      {!featured ? (
        <div className="summary-card-footer">
          <strong>{summary.fullName}</strong>
          <span>{formatTimestamp(summary.createdAt)}</span>
        </div>
      ) : null}
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
      <Waves className="corner-glyph" />
    </div>
  );
}

export default App;
