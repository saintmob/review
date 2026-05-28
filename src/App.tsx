import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type FormEvent } from 'react';
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

type WorkSlotState = {
  workUrl: string;
  file: File | null;
  fileName: string;
  previewUrl: string;
};

type Summary = {
  id: string;
  fullName: string;
  textSummary: string;
  videoSummaryUrl: string;
  createdAt: string;
};

type StudentRecord = {
  id: string;
  fullName: string;
  roles: string[];
  textSummary: string;
  videoSummaryUrl: string;
  works: Work[];
  createdAt: string;
  updatedAt?: string;
};

type BootstrapResponse = {
  program: Program;
  works: Work[];
  summaries: Summary[];
  students: StudentRecord[];
  updatedAt?: string;
};

type UploadResponse = {
  uploadId: string;
  objectKey: string;
  publicUrl: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  assetKind: string;
};

type UploadState = 'idle' | 'uploading' | 'uploaded' | 'error';
type SubmitState = 'idle' | 'submitting' | 'submitted' | 'error';
type RecordingState = 'idle' | 'camera-ready' | 'recording' | 'recorded' | 'error';

const defaultEventApiBase = 'https://review-api.saintmob.workers.dev';
const eventApiBase = (import.meta.env.VITE_REVIEW_API_BASE || defaultEventApiBase).replace(/\/+$/, '');
const roleOptions = ['音乐', '交互', '视觉', '导演', '海报', '字幕旁白', '技术支持', '场务', '指导老师'];

const initialForm = {
  fullName: '',
  roles: [] as string[],
  textSummary: '',
  videoSummaryUrl: '',
  uploadId: '',
  objectKey: '',
  sizeBytes: 0,
  durationMs: 0,
  videoWidth: 0,
  videoHeight: 0,
};

type DraftWorkSlot = {
  workUrl: string;
  fileName: string;
};

type DraftSnapshot = {
  form: typeof initialForm;
  workSlots: DraftWorkSlot[];
  updatedAt: string;
};

type DraftBlobRecord = {
  key: string;
  blob: Blob;
  fileName: string;
  updatedAt: number;
};

const DRAFT_STORAGE_KEY = 'review-upload-draft-v2';
const DRAFT_DB_NAME = 'review-upload-draft-files-v1';
const DRAFT_DB_STORE = 'files';
const DRAFT_VIDEO_BLOB_KEY = 'video-summary';
const DRAFT_WORK_BLOB_KEYS = ['work-cover-1', 'work-cover-2'] as const;
let draftDbPromise: Promise<IDBDatabase> | null = null;

function hasBrowserStorage() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined' && typeof indexedDB !== 'undefined';
}

function cloneInitialForm() {
  return {
    ...initialForm,
    roles: [...initialForm.roles],
  };
}

function serializeDraftSnapshot(form: typeof initialForm, workSlots: WorkSlotState[]): DraftSnapshot {
  return {
    form: {
      ...form,
      roles: [...form.roles],
    },
    workSlots: workSlots.map((slot) => ({
      workUrl: slot.workUrl,
      fileName: slot.fileName,
    })),
    updatedAt: new Date().toISOString(),
  };
}

function buildDraftSignature(form: typeof initialForm, workSlots: WorkSlotState[]) {
  return JSON.stringify({
    form: {
      ...form,
      roles: [...form.roles],
    },
    workSlots: workSlots.map((slot) => ({
      workUrl: slot.workUrl,
      fileName: slot.fileName,
    })),
  });
}

function readDraftSnapshot(): DraftSnapshot | null {
  if (!hasBrowserStorage()) return null;

  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftSnapshot>;
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      form: {
        ...cloneInitialForm(),
        ...(parsed.form || {}),
        roles: Array.isArray(parsed.form?.roles) ? parsed.form!.roles.filter((item) => typeof item === 'string') : [],
      },
      workSlots: Array.isArray(parsed.workSlots)
        ? parsed.workSlots.slice(0, 2).map((slot) => ({
            workUrl: typeof slot?.workUrl === 'string' ? slot.workUrl : '',
            fileName: typeof slot?.fileName === 'string' ? slot.fileName : '',
          }))
        : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function writeDraftSnapshot(snapshot: DraftSnapshot) {
  if (!hasBrowserStorage()) return;
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
}

function clearDraftSnapshot() {
  if (!hasBrowserStorage()) return;
  localStorage.removeItem(DRAFT_STORAGE_KEY);
}

function openDraftDatabase() {
  if (!hasBrowserStorage()) {
    return Promise.reject(new Error('浏览器存储不可用'));
  }

  if (!draftDbPromise) {
    draftDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DRAFT_DB_NAME, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DRAFT_DB_STORE)) {
          db.createObjectStore(DRAFT_DB_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开草稿存储'));
      request.onblocked = () => reject(new Error('草稿存储正在被其他标签页占用'));
    });
  }

  return draftDbPromise;
}

async function readDraftBlob(key: string) {
  const db = await openDraftDatabase();
  return await new Promise<DraftBlobRecord | null>((resolve, reject) => {
    const tx = db.transaction(DRAFT_DB_STORE, 'readonly');
    const store = tx.objectStore(DRAFT_DB_STORE);
    const request = store.get(key);

    request.onsuccess = () => {
      const value = request.result as DraftBlobRecord | undefined;
      resolve(value || null);
    };
    request.onerror = () => reject(request.error || new Error('读取草稿文件失败'));
  });
}

async function writeDraftBlob(key: string, blob: Blob, fileName: string) {
  const db = await openDraftDatabase();
  return await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DRAFT_DB_STORE, 'readwrite');
    const store = tx.objectStore(DRAFT_DB_STORE);
    const request = store.put({
      key,
      blob,
      fileName,
      updatedAt: Date.now(),
    } satisfies DraftBlobRecord);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('保存草稿文件失败'));
  });
}

async function deleteDraftBlob(key: string) {
  const db = await openDraftDatabase();
  return await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DRAFT_DB_STORE, 'readwrite');
    const store = tx.objectStore(DRAFT_DB_STORE);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('删除草稿文件失败'));
  });
}

async function clearDraftBlobs() {
  const db = await openDraftDatabase();
  return await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DRAFT_DB_STORE, 'readwrite');
    const store = tx.objectStore(DRAFT_DB_STORE);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('清理草稿文件失败'));
  });
}

function draftWorkBlobKey(index: number) {
  return DRAFT_WORK_BLOB_KEYS[index] || `work-cover-${index + 1}`;
}

function createFileFromBlob(blob: Blob, fileName: string) {
  return new File([blob], fileName || 'file.bin', {
    type: blob.type || 'application/octet-stream',
    lastModified: Date.now(),
  });
}

function hasDraftContent(form: typeof initialForm, workSlots: WorkSlotState[], recordedBlob: Blob | null) {
  if (
    form.fullName.trim() ||
    form.roles.length ||
    form.textSummary.trim() ||
    form.videoSummaryUrl.trim() ||
    form.uploadId.trim() ||
    form.objectKey.trim() ||
    form.sizeBytes ||
    form.durationMs ||
    form.videoWidth ||
    form.videoHeight
  ) {
    return true;
  }

  if (recordedBlob) return true;

  return workSlots.some((slot) => slot.workUrl.trim() || slot.file || slot.fileName.trim());
}

function createEmptyWorkSlot(): WorkSlotState {
  return {
    workUrl: '',
    file: null,
    fileName: '',
    previewUrl: '',
  };
}

function createInitialWorkSlots() {
  return [createEmptyWorkSlot(), createEmptyWorkSlot()];
}

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
  return `${baseName || 'submission'}${extension || '.bin'}`;
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

function isPlayableReviewVideoUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (['example.com', 'localhost', '127.0.0.1'].includes(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function proxyMediaUrl(value: string) {
  if (!value) return '';
  return `/api/media?url=${encodeURIComponent(value)}`;
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mediaQuery) return;

    setPrefersReducedMotion(mediaQuery.matches);
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  return prefersReducedMotion;
}

function getStudentPrimaryWork(student: StudentRecord) {
  return student.works.find((work) => work.coverUrl || work.workUrl) || student.works[0] || null;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取封面文件'));
    image.src = src;
  });
}

async function readCoverImageBlob(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);
    const maxSide = 1024;
    const scale = Math.min(maxSide / image.width, maxSide / image.height, 1);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('无法处理封面图片');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('无法处理封面图片'));
          return;
        }
        resolve(blob);
      }, 'image/jpeg', 0.82);
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadCoverImage(file: File, workIndex: number) {
  const blob = await readCoverImageBlob(file);
  return uploadFileToWorker({
    file: blob,
    filename: sanitizeUploadName(`cover-${workIndex + 1}.jpg`),
    contentType: 'image/jpeg',
    assetKind: 'work-cover',
    workIndex: workIndex + 1,
    metadata: {
      source: 'review-student-client',
    },
    onProgress: () => {},
  });
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

async function api<T>(path: string, options: { method?: string; body?: unknown | FormData } = {}) {
  const response = await fetch(buildApiUrl(path), {
    method: options.method ?? 'GET',
    headers: options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await readJsonResponse<T & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || `请求失败：HTTP ${response.status}`);
  }

  return payload;
}

async function uploadFileToWorker(input: {
  file: Blob;
  filename: string;
  contentType: string;
  assetKind: 'video-summary' | 'work-cover';
  fullName?: string;
  workIndex?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  metadata?: Record<string, string | number | boolean | undefined>;
  onProgress: (percentage: number) => void;
}) {
  return new Promise<UploadResponse>((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', input.file, input.filename);
    formData.append('fileName', input.filename);
    formData.append('contentType', input.contentType);
    formData.append('assetKind', input.assetKind);
    if (input.fullName) formData.append('fullName', input.fullName);
    if (typeof input.workIndex === 'number') formData.append('workIndex', String(input.workIndex));
    if (typeof input.durationMs === 'number') formData.append('durationMs', String(input.durationMs));
    if (typeof input.width === 'number') formData.append('width', String(input.width));
    if (typeof input.height === 'number') formData.append('height', String(input.height));
    if (input.metadata) formData.append('metadata', JSON.stringify(input.metadata));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildApiUrl('/api/uploads'));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        input.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText || '{}') as UploadResponse);
        } catch {
          reject(new Error('上传响应解析失败'));
        }
        return;
      }
      try {
        const payload = JSON.parse(xhr.responseText || '{}') as { error?: string };
        reject(new Error(payload.error || `文件上传失败：HTTP ${xhr.status}`));
      } catch {
        reject(new Error(`文件上传失败：HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('文件上传失败，请检查网络或跨域配置'));
    xhr.send(formData);
  });
}

function getUploadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '上传失败');
  if (message.includes('HTTP 413')) return '文件过大，超过活动允许的大小限制。';
  return message;
}

async function buildWorksPayload(workSlots: WorkSlotState[], onStatus?: (message: string) => void) {
  const normalized: Array<{ workUrl: string; coverUrl: string }> = [];

  for (const [index, slot] of workSlots.entries()) {
    const workUrl = slot.workUrl.trim();
    const hasCover = Boolean(slot.file);

    if (!workUrl && !hasCover) {
      continue;
    }

    if (!workUrl) {
      throw new Error(`作品 ${index + 1} 需要填写作品链接。`);
    }
    if (!isHttpsUrl(workUrl)) {
      throw new Error(`作品 ${index + 1} 的链接请以 https 开头。`);
    }
    if (!slot.file) {
      throw new Error(`作品 ${index + 1} 需要从电脑本地上传封面图片。`);
    }

    onStatus?.(`正在上传作品 ${index + 1} 的封面...`);
    const coverUpload = await uploadCoverImage(slot.file, index);

    normalized.push({
      workUrl,
      coverUrl: coverUpload.publicUrl,
    });
  }

  if (!normalized.length) {
    throw new Error('请至少填写 1 组作品链接并上传对应封面。');
  }

  return normalized.slice(0, 2);
}

function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '');
  const isAdminPage = pathname === '/admin' || pathname === '/upload';
  const isDisplayPage = pathname === '/display' || pathname === '/videos' || pathname === '/video-carousel';
  const isPublicPage = pathname === '/public';

  return (
    <main className="app">
      <AmbientStage />
      {isAdminPage ? <UploadPage /> : isDisplayPage ? <DisplayPage /> : isPublicPage ? <PlaybackPage /> : <LandingPage />}
    </main>
  );
}

function LandingPage() {
  return (
    <section className="landing-page page-fade">
      <div className="landing-hero">
        <div className="signal-pills" aria-hidden="true">
          <span>学生提交</span>
          <span>作品展示</span>
          <span>草稿保存</span>
        </div>
        <p className="eyebrow">入口</p>
        <h1 className="glitch-title" data-text="回响">回响</h1>
        <p className="subtitle">进入视频展示页查看作品、封面与感悟回顾。</p>
        <div className="hero-actions">
          <a className="ghost-action" href="/display">
            <Play />
            视频展示页
          </a>
        </div>
        <p className="terminal-line"><i /> 先提交，再展示。</p>
      </div>
    </section>
  );
}

function DisplayPage() {
  const { data, isLoading, message, load } = usePublicEventData();
  const [isStarted, setIsStarted] = useState(false);
  const [trackIndex, setTrackIndex] = useState(0);
  const [isTransitionEnabled, setIsTransitionEnabled] = useState(true);
  const [isAwaitingNext, setIsAwaitingNext] = useState(false);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const startLockRef = useRef(false);

  const reviewStudents = useMemo(() => {
    return data.students.filter((student) => isPlayableReviewVideoUrl(student.videoSummaryUrl));
  }, [data.students]);

  const slides = useMemo(() => {
    return reviewStudents.map((student) => {
      const primaryWork = getStudentPrimaryWork(student);
      return {
        ...student,
        primaryWork,
        coverUrl: primaryWork?.coverUrl || '',
        workUrl: primaryWork?.workUrl || '',
        roleLabel: student.roles.length ? student.roles.join(' / ') : '岗位待补充',
        workLabel: primaryWork ? `作品 ${primaryWork.workIndex ?? 1}` : '作品',
      };
    });
  }, [reviewStudents]);

  const loopSlides = useMemo(() => {
    if (slides.length <= 1) return slides;
    return [...slides, slides[0]];
  }, [slides]);

  useEffect(() => {
    if (!isStarted || !slides.length) return;

    const currentVideo = videoRefs.current[trackIndex];
    videoRefs.current.forEach((video, index) => {
      if (video && index !== trackIndex && !video.paused) {
        video.pause();
      }
    });

    if (!currentVideo || trackIndex >= slides.length) return;

    currentVideo.load();
    currentVideo.currentTime = 0;
    const playPromise = currentVideo.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }, [isStarted, slides.length, trackIndex]);

  useEffect(() => {
    setIsAwaitingNext(false);
  }, [trackIndex]);

  function startDisplay() {
    if (startLockRef.current) return;
    startLockRef.current = true;
    setIsStarted(true);
    setTrackIndex(0);
    setIsTransitionEnabled(true);
    setIsAwaitingNext(false);
  }

  function goNext() {
    if (!slides.length) return;
    setIsAwaitingNext(false);
    if (slides.length === 1) {
      const currentVideo = videoRefs.current[0];
      if (currentVideo) {
        currentVideo.currentTime = 0;
        void currentVideo.play();
      }
      return;
    }
    const nextIndex = trackIndex >= slides.length - 1 ? slides.length : trackIndex + 1;
    const nextVideo = videoRefs.current[nextIndex];
    if (nextVideo) {
      nextVideo.currentTime = 0;
      void nextVideo.play();
    }
    if (trackIndex >= slides.length - 1) {
      setTrackIndex(slides.length);
      return;
    }
    setTrackIndex((current) => current + 1);
  }

  function handleTrackTransitionEnd() {
    if (!slides.length || slides.length === 1) return;
    if (trackIndex === slides.length) {
      setIsTransitionEnabled(false);
      setTrackIndex(0);
      window.requestAnimationFrame(() => {
        setIsTransitionEnabled(true);
      });
    }
  }

  return (
    <section className={`display-page page-fade ${isStarted ? 'is-reviewing' : ''}`}>
      {!isStarted ? (
        <div className="display-header">
          <div>
            <div className="signal-pills" aria-hidden="true">
              <span>展示模式</span>
              <span>作品轮播</span>
              <span>公开浏览</span>
            </div>
            <p className="eyebrow">视频展示</p>
            <h1 className="glitch-title" data-text="展示">展示</h1>
            <p className="subtitle">点击开始后，当前学生视频会自动播放，结束后点右下角“下一位”切换到下一位同学。</p>
          </div>
          <div className="display-header-actions">
            <button className="ghost-action" type="button" onClick={() => void load()}>
              <RefreshCw />
              刷新数据
            </button>
          </div>
        </div>
      ) : null}

      <div className="display-stage">
        <div
          className={isTransitionEnabled ? 'display-track is-animated' : 'display-track'}
          style={{
            ['--slide-count' as string]: Math.max(loopSlides.length, 1),
            transform: `translateX(-${trackIndex * (100 / Math.max(loopSlides.length, 1))}%)`,
          }}
          onTransitionEnd={handleTrackTransitionEnd}
        >
          {loopSlides.length ? (
            loopSlides.map((slide, index) => {
              const isActive = index === trackIndex;
              const isAdjacent = isStarted && Math.abs(index - trackIndex) <= 1;
              const shouldLoadVideo = !isStarted ? index === 0 : isActive || isAdjacent;
              const shouldPrioritizeCover = isActive || (!isStarted && index === 0);
              return (
                <article className="display-slide" key={`${slide.id || slide.fullName}-${index}`}>
                  <div className="display-slide-grid">
                    <section className="display-video-panel">
                      <div className="display-video-label">视频</div>
                      <video
                        ref={(node) => {
                          videoRefs.current[index] = node;
                        }}
                        src={shouldLoadVideo ? proxyMediaUrl(slide.videoSummaryUrl) : undefined}
                        playsInline
                        preload={isActive ? 'auto' : 'metadata'}
                        controls={false}
                        autoPlay={isStarted && isActive && index < slides.length}
                        onLoadedData={() => {
                          if (isStarted && isActive) {
                            const currentVideo = videoRefs.current[index];
                            if (currentVideo) {
                              currentVideo.currentTime = 0;
                              void currentVideo.play();
                            }
                          }
                        }}
                        onEnded={() => {
                          if (isActive) {
                            setIsAwaitingNext(true);
                          }
                        }}
                        onError={() => {
                          if (isActive) {
                            setIsAwaitingNext(true);
                          }
                        }}
                        onClick={() => {
                          if (!isStarted) {
                            startDisplay();
                          }
                        }}
                      />
                    </section>

                    <aside className="display-side-panel">
                      <div className="display-side-title">作品封面</div>
                      {slide.coverUrl ? (
                        <img
                          className="display-cover"
                          src={slide.coverUrl}
                          alt={`${slide.fullName} 的作品封面`}
                          loading={shouldPrioritizeCover ? 'eager' : 'lazy'}
                          decoding="async"
                        />
                      ) : (
                        <div className="display-cover placeholder">暂无作品封面</div>
                      )}
                      {slide.workUrl ? (
                        <a className="display-link" href={slide.workUrl} target="_blank" rel="noreferrer">
                          查看作品
                        </a>
                      ) : (
                        <div className="display-link">作品链接待补充</div>
                      )}
                      <div className="display-meta-block">
                        <strong>{slide.fullName}</strong>
                        <span>{slide.roleLabel}</span>
                      </div>
                    </aside>

                    <div className="display-summary-strip">
                      <div className="display-summary-title">总结</div>
                      <p>{slide.textSummary || '这位同学尚未填写职位感悟。'}</p>
                    </div>
                  </div>
                </article>
              );
            })
          ) : (
            <article className="display-slide">
              <div className="empty-state">
                {isLoading
                  ? '正在加载展示数据...'
                  : data.students.length
                    ? '当前没有可播放的视频回顾，请检查后台视频地址。'
                    : '暂无可展示的视频总结。'}
              </div>
            </article>
          )}
        </div>

        {!isStarted ? (
          <div
            className="display-start-overlay"
            role="button"
            tabIndex={0}
            onPointerDown={startDisplay}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                startDisplay();
              }
            }}
          >
            <div className="display-start-button">
              <Play />
              <strong>开始回顾</strong>
              <span>点击后进入回顾模式，视频结束后在右下角点“下一位”切换。</span>
            </div>
          </div>
        ) : null}

        {isStarted && isAwaitingNext && slides.length ? (
          <button className="display-next-button" type="button" onClick={goNext}>
            下一位
          </button>
        ) : null}
      </div>

      {!isStarted && (message ? <p className="terminal-line display-message"><i /> {message}</p> : null)}
    </section>
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
            <span>学生提交</span>
            <span>作品展示</span>
            <span>公开浏览</span>
          </div>
          <p className="eyebrow">公开浏览</p>
          <h1 className="glitch-title" data-text="回响">回响</h1>
          <p className="subtitle">这里汇总节目单、作品和总结；提交页用于录入学生信息与作品。</p>
          <div className="loading-track" aria-hidden="true"><span /></div>
          <div className="hero-actions">
            <a className="primary-action" href="/display">
              <Play />
              进入视频展示页
            </a>
            <button className="ghost-action" type="button" onClick={() => void load()}>
              <RefreshCw />
              刷新内容
            </button>
          </div>
          {message && <p className="terminal-line"><i /> {message}</p>}
        </div>
      </section>

      <section className="archive-section playback-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">公开概览</p>
            <h2>节目单、作品与总结</h2>
          </div>
        </div>

        {latestSummary && (
          <article className="featured-player">
            <div>
              <p className="eyebrow">最新总结</p>
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
              <p>暂时还没有节目单。</p>
            )}
          </article>

          <article className="reflection-card">
            <div className="card-index">02</div>
            <h3>作品列表</h3>
            {isLoading && !data.works.length ? (
              <p>正在载入作品列表...</p>
            ) : data.works.length ? (
              <div className="work-link-list">
                {data.works.map((work) => (
                  <a className="work-link-card" href={work.workUrl} target="_blank" rel="noreferrer" key={work.id || `${work.studentName}-${work.workUrl}`}>
                    <img
                      src={work.coverUrl}
                      alt={`${work.studentName || '同学'} 作品封面`}
                      loading="lazy"
                      decoding="async"
                    />
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
              <p>正在载入总结...</p>
            ) : data.summaries.length ? (
              <div className="summary-link-list">
                {data.summaries.map((summary) => (
                  <div className="summary-item" key={summary.id}>
                    <strong>{summary.fullName}</strong>
                    <p>{summary.textSummary}</p>
                    <a href={proxyMediaUrl(summary.videoSummaryUrl)} target="_blank" rel="noreferrer">
                      查看视频总结
                    </a>
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
  const workSlotsRef = useRef<WorkSlotState[]>(createInitialWorkSlots());
  const [form, setForm] = useState(initialForm);
  const [workSlots, setWorkSlots] = useState(createInitialWorkSlots);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState('');
  const [message, setMessage] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const lastDraftSignatureRef = useRef('');
  const lastWorkFileRefs = useRef<Array<File | null>>([null, null]);
  const lastRecordedBlobRef = useRef<Blob | null>(null);
  const recordedFileNameRef = useRef('');

  useEffect(() => {
    workSlotsRef.current = workSlots;
  }, [workSlots]);

  useEffect(() => {
    let cancelled = false;
    const emptySignature = buildDraftSignature(cloneInitialForm(), createInitialWorkSlots());

    async function restoreDraft() {
      if (!hasBrowserStorage()) {
        lastDraftSignatureRef.current = emptySignature;
        lastWorkFileRefs.current = [null, null];
        lastRecordedBlobRef.current = null;
        setDraftLoaded(true);
        return;
      }

      const snapshot = readDraftSnapshot();
      if (!snapshot) {
        lastDraftSignatureRef.current = emptySignature;
        lastWorkFileRefs.current = [null, null];
        lastRecordedBlobRef.current = null;
        setDraftLoaded(true);
        return;
      }

      const restoredWorkSlots: WorkSlotState[] = [];
      for (let index = 0; index < 2; index += 1) {
        const snapshotSlot = snapshot.workSlots[index];
        const blobRecord = await readDraftBlob(draftWorkBlobKey(index));

        if (blobRecord?.blob) {
          const fileName = blobRecord.fileName || snapshotSlot?.fileName || `cover-${index + 1}.jpg`;
          const file = createFileFromBlob(blobRecord.blob, fileName);
          restoredWorkSlots.push({
            workUrl: snapshotSlot?.workUrl || '',
            file,
            fileName,
            previewUrl: URL.createObjectURL(file),
          });
          continue;
        }

        restoredWorkSlots.push({
          workUrl: snapshotSlot?.workUrl || '',
          file: null,
          fileName: snapshotSlot?.fileName || '',
          previewUrl: '',
        });
      }

      const videoRecord = await readDraftBlob(DRAFT_VIDEO_BLOB_KEY);
      const restoredRecordedBlob = videoRecord?.blob ?? null;
      const restoredRecordedUrl = restoredRecordedBlob ? URL.createObjectURL(restoredRecordedBlob) : '';
      const restoredForm = {
        ...cloneInitialForm(),
        ...snapshot.form,
        roles: Array.isArray(snapshot.form.roles) ? snapshot.form.roles.filter((item) => typeof item === 'string') : [],
      };

      if (cancelled) {
        restoredWorkSlots.forEach((slot) => {
          if (slot.previewUrl) URL.revokeObjectURL(slot.previewUrl);
        });
        if (restoredRecordedUrl) URL.revokeObjectURL(restoredRecordedUrl);
        return;
      }

      workSlotsRef.current = restoredWorkSlots;
      recordedUrlRef.current = restoredRecordedUrl;
      recordedFileNameRef.current = videoRecord?.fileName || '';
      lastDraftSignatureRef.current = buildDraftSignature(restoredForm, restoredWorkSlots);
      lastWorkFileRefs.current = restoredWorkSlots.map((slot) => slot.file);
      lastRecordedBlobRef.current = restoredRecordedBlob;

      setForm(restoredForm);
      setWorkSlots(restoredWorkSlots);
      setRecordedBlob(restoredRecordedBlob);
      setRecordedUrl(restoredRecordedUrl);
      setUploadState(restoredForm.videoSummaryUrl ? 'uploaded' : 'idle');
      setRecordingState(restoredRecordedBlob || restoredForm.videoSummaryUrl ? 'recorded' : 'idle');
      setSubmitState('idle');
      if (hasDraftContent(restoredForm, restoredWorkSlots, restoredRecordedBlob)) {
        setMessage('已恢复上次填写内容。');
      }
      setDraftLoaded(true);
    }

    void restoreDraft().catch(() => {
      if (!cancelled) {
        lastDraftSignatureRef.current = emptySignature;
        lastWorkFileRefs.current = [null, null];
        lastRecordedBlobRef.current = null;
        setDraftLoaded(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;

    const signature = buildDraftSignature(form, workSlots);
    if (signature === lastDraftSignatureRef.current) return;
    lastDraftSignatureRef.current = signature;

    if (!hasDraftContent(form, workSlots, recordedBlob)) {
      clearDraftSnapshot();
      return;
    }

    writeDraftSnapshot(serializeDraftSnapshot(form, workSlots));
  }, [draftLoaded, form, workSlots, recordedBlob]);

  useEffect(() => {
    if (!draftLoaded) return;

    workSlots.forEach((slot, index) => {
      const currentFile = slot.file;
      if (lastWorkFileRefs.current[index] === currentFile) return;
      lastWorkFileRefs.current[index] = currentFile;

      if (!currentFile) {
        void deleteDraftBlob(draftWorkBlobKey(index)).catch(() => {});
        return;
      }

      void writeDraftBlob(draftWorkBlobKey(index), currentFile, currentFile.name).catch(() => {});
    });
  }, [draftLoaded, workSlots]);

  useEffect(() => {
    if (!draftLoaded) return;

    if (lastRecordedBlobRef.current === recordedBlob) return;
    lastRecordedBlobRef.current = recordedBlob;

    if (!recordedBlob) {
      recordedFileNameRef.current = '';
      void deleteDraftBlob(DRAFT_VIDEO_BLOB_KEY).catch(() => {});
      return;
    }

    const fileName = recordedFileNameRef.current || sanitizeUploadName(`summary-${Date.now()}.webm`);
    recordedFileNameRef.current = fileName;
    void writeDraftBlob(DRAFT_VIDEO_BLOB_KEY, recordedBlob, fileName).catch(() => {});
  }, [draftLoaded, recordedBlob]);

  useEffect(() => {
    return () => {
      stopCamera();
      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
      workSlotsRef.current.forEach((slot) => {
        if (slot.previewUrl) URL.revokeObjectURL(slot.previewUrl);
      });
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

  function commitWorkSlots(updater: (current: WorkSlotState[]) => WorkSlotState[]) {
    setWorkSlots((current) => {
      const next = updater(current);
      workSlotsRef.current = next;
      return next;
    });
  }

  function updateWorkSlot(index: number, updater: (current: WorkSlotState) => WorkSlotState) {
    commitWorkSlots((current) =>
      current.map((slot, slotIndex) => {
        if (slotIndex !== index) return slot;
        const next = updater(slot);
        if (next.previewUrl !== slot.previewUrl && slot.previewUrl) {
          URL.revokeObjectURL(slot.previewUrl);
        }
        return next;
      }),
    );
  }

  function setWorkFile(index: number, file: File | null) {
    updateWorkSlot(index, (current) => {
      return {
        workUrl: current.workUrl,
        file,
        fileName: file?.name || '',
        previewUrl: file ? URL.createObjectURL(file) : '',
      };
    });
  }

  function clearWorkSlots() {
    commitWorkSlots((current) => {
      current.forEach((slot) => {
        if (slot.previewUrl) URL.revokeObjectURL(slot.previewUrl);
      });
      return createInitialWorkSlots();
    });
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
      const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
      const durationMs = Math.max(0, Math.round(performance.now() - recordStartedAtRef.current));
      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
      const fileName = sanitizeUploadName(`summary-${Date.now()}.webm`);
      const url = URL.createObjectURL(blob);
      recordedUrlRef.current = url;
      recordedFileNameRef.current = fileName;
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
      stopCamera();
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
    recordedFileNameRef.current = '';
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

    const filename = recordedFileNameRef.current || sanitizeUploadName(`summary-${Date.now()}.webm`);
    recordedFileNameRef.current = filename;
    const contentType = 'video/webm';
    setUploadState('uploading');
    setSubmitState('idle');
    setMessage('正在上传视频总结...');

    try {
      const upload = await uploadFileToWorker({
        file: recordedBlob,
        filename,
        contentType,
        assetKind: 'video-summary',
        fullName: form.fullName.trim() || `student:${Date.now()}`,
        durationMs: form.durationMs || undefined,
        width: form.videoWidth || undefined,
        height: form.videoHeight || undefined,
        metadata: {
          source: 'review-student-client',
          assetKind: 'video-summary',
          fullName: form.fullName.trim() || 'anonymous',
          originalMimeType: recordedBlob.type || 'video/webm',
        },
        onProgress: (percentage) => {
          setMessage(`正在上传视频... ${percentage}%`);
        },
      });

      setForm((current) => ({
        ...current,
        videoSummaryUrl: upload.publicUrl,
        uploadId: upload.uploadId,
        objectKey: upload.objectKey,
        sizeBytes: recordedBlob.size,
      }));
      setUploadState('uploaded');
      setMessage('上传成功，视频总结已准备好提交。');
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

  function handleWorkInputChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    if (file && !file.type.startsWith('image/')) {
      event.currentTarget.value = '';
      setMessage(`作品图片 ${index + 1} 只能选择图片文件。`);
      return;
    }

    setWorkFile(index, file);
    event.currentTarget.value = '';
    if (file) {
      setMessage(`已选择作品图片 ${index + 1}：${file.name}`);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitState('submitting');

    try {
      if (!form.fullName.trim()) throw new Error('请输入学生姓名。');
      if (!form.roles.length) throw new Error('请至少选择一个工作人员职能。');
      if (!form.textSummary.trim()) throw new Error('请输入职位感悟。');
      if (recordingState !== 'recorded') throw new Error('请先拍摄视频总结。');
      if (uploadState !== 'uploaded') {
        setMessage('正在上传视频总结...');
        await uploadRecording();
      }
      if (!isHttpsUrl(form.videoSummaryUrl.trim())) throw new Error('视频上传失败，请重试。');
      const works = await buildWorksPayload(workSlotsRef.current, (status) => setMessage(status));

      setMessage('正在保存提交内容...');
      const payload = await api<{ ok?: boolean; student?: { id: string } }>('/api/students', {
        method: 'POST',
        body: {
          fullName: form.fullName.trim(),
          roles: form.roles,
          textSummary: form.textSummary.trim(),
          videoSummaryUrl: form.videoSummaryUrl.trim(),
          videoUploadId: form.uploadId,
          videoObjectKey: form.objectKey,
          videoSizeBytes: form.sizeBytes,
          videoDurationMs: form.durationMs,
          videoWidth: form.videoWidth,
          videoHeight: form.videoHeight,
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
      recordedFileNameRef.current = '';
      lastRecordedBlobRef.current = null;
      lastWorkFileRefs.current = [null, null];
      lastDraftSignatureRef.current = buildDraftSignature(cloneInitialForm(), createInitialWorkSlots());
      clearDraftSnapshot();
      void clearDraftBlobs().catch(() => {});
      setForm(initialForm);
      clearWorkSlots();
      setUploadState('idle');
      setRecordingState('idle');
      setSubmitState('submitted');
      setMessage('提交完成，公开页面更新后即可看到新的总结和作品。');
    } catch (error) {
      setSubmitState('error');
      setMessage(error instanceof Error ? error.message : '提交失败');
    }
  }

  const statusText = useMemo(() => {
    if (recordingState === 'recording') return '录制中';
    if (recordingState === 'recorded') return '已录制';
    if (uploadState === 'uploading') return '上传中';
    if (uploadState === 'uploaded') return '已上传';
    if (submitState === 'submitting') return '保存中';
    if (submitState === 'submitted') return '已提交';
    return '等待摄像头';
  }, [recordingState, submitState, uploadState]);

  return (
    <section className="upload-page page-fade">
      <div className="upload-intro">
        <div className="signal-pills" aria-hidden="true">
          <span>学生提交</span>
          <span>作品封面</span>
          <span>视频总结</span>
        </div>
        <p className="eyebrow">提交页</p>
        <h1 className="glitch-title upload-title" data-text="上传">上传</h1>
        <p className="subtitle">填写姓名、职能、作品链接和封面，再录制并保存视频总结。</p>
        <div className="hero-actions">
          <a className="ghost-action" href="/">返回入口页</a>
        </div>
        <p className="terminal-line"><i /> {statusText}</p>
      </div>

      <form className="upload-console" onSubmit={handleSubmit}>
        <div className="console-heading">
          <div>
            <p className="eyebrow">填写信息</p>
            <h2>管理提交页</h2>
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

        <div className="camera-recorder">
          <div className="camera-preview">
            {recordedUrl || form.videoSummaryUrl ? (
              <video src={recordedUrl || form.videoSummaryUrl} controls playsInline autoPlay />
            ) : (
              <>
                <video ref={liveVideoRef} autoPlay muted playsInline />
                {recordingState === 'idle' && <span>前置摄像头</span>}
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
                <button className="primary-action" type="button" onClick={() => void uploadRecording()} disabled={uploadState === 'uploading' || uploadState === 'uploaded'}>
                  {uploadState === 'uploading' ? <Loader2 className="spin" /> : <UploadCloud />}
                  {uploadState === 'uploaded' ? '视频已上传' : '上传录制视频'}
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="work-upload-grid">
          {workSlots.map((slot, index) => (
            <div className="work-upload-card" key={index}>
              <div className="work-upload-head">
                <label className="field-label" htmlFor={`work-url-${index}`}>作品链接 {index + 1}</label>
                <span className="upload-status idle">可跳转</span>
              </div>
              <input
                id={`work-url-${index}`}
                className="url-field"
                type="url"
                value={slot.workUrl}
                onChange={(event) =>
                  commitWorkSlots((current) =>
                    current.map((currentSlot, slotIndex) =>
                      slotIndex === index ? { ...currentSlot, workUrl: event.target.value } : currentSlot,
                    ),
                )
                }
                placeholder="填写作品链接"
              />

              <div className="work-upload-head">
                <label className="field-label" htmlFor={`work-image-${index}`}>作品封面 {index + 1}</label>
                <span className="upload-status idle">本地上传</span>
              </div>
              <label className={slot.previewUrl ? 'upload-drop work-upload-drop has-preview' : 'upload-drop work-upload-drop'} htmlFor={`work-image-${index}`}>
                <input
                  id={`work-image-${index}`}
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleWorkInputChange(index, event)}
                />
                {slot.previewUrl ? (
                  <>
                    <img className="work-upload-preview" src={slot.previewUrl} alt={`作品封面 ${index + 1} 预览`} />
                    <strong>{slot.fileName}</strong>
                    <em>封面会随提交一起写入，不需要再手填图片链接。</em>
                  </>
                ) : (
                  <>
                    <span className="upload-icon" aria-hidden="true">
                      <UploadCloud />
                    </span>
                    <strong>点击选择本地封面</strong>
                    <em>支持 JPG / PNG / WebP / GIF，提交时会自动编码后写入作品封面。</em>
                  </>
                )}
              </label>
              <div className="work-upload-actions">
                <p className="form-message">
                  {slot.fileName
                    ? `已选择：${slot.fileName}`
                    : '尚未选择封面图片。'}
                </p>
                {slot.file ? (
                  <button className="ghost-action work-clear-button" type="button" onClick={() => setWorkFile(index, null)}>
                    清除封面
                  </button>
                ) : null}
              </div>
            </div>
          ))}
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

        <label className="field-label" htmlFor="reflection-note">职位感悟</label>
        <textarea
          id="reflection-note"
          value={form.textSummary}
          onChange={(event) => setForm((current) => ({ ...current, textSummary: event.target.value }))}
          placeholder="写下你在本次岗位中的感悟与反思"
          rows={4}
          required
        />

        <p className="form-message">至少填写一组作品链接，并为该作品上传本地封面。封面会自动压缩后写入提交内容。</p>
        {message && <p className={`form-message ${uploadState === 'error' || submitState === 'error' ? 'is-error' : ''}`}>{message}</p>}

        <button className="primary-action" type="submit" disabled={submitState === 'submitting'}>
          {submitState === 'submitting' ? <Loader2 className="spin" /> : <CheckCircle2 />}
          保存到展示页
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
    students: [] as StudentRecord[],
  });
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    setIsLoading(true);
    try {
      const bootstrap = await api<BootstrapResponse>('/api/bootstrap');
      setData({
        program: bootstrap.program ?? { text: '', updatedAt: '' },
        works: bootstrap.works ?? [],
        summaries: bootstrap.summaries ?? [],
        students: bootstrap.students ?? [],
      });
      setMessage('页面内容已更新');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '暂时无法读取页面内容');
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
        视频总结
      </div>
      <video src={proxyMediaUrl(summary.videoSummaryUrl)} controls playsInline preload={featured ? 'metadata' : 'none'} />
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
  const prefersReducedMotion = usePrefersReducedMotion();
  const traceLines = [
    'M-30 590 C130 510 120 360 250 310 C380 200 505 250 665 470 C830 350 900 330 980 310',
    'M40 720 C190 620 285 705 382 585 C510 425 610 690 790 520 C850 475 890 450 930 430',
    'M120 85 C260 170 185 300 330 330 475 380 430 505 610 535 735 566 750 430 960 365',
    'M-20 250 C110 205 180 160 255 220 340 295 455 110 555 180 675 252 720 120 920 92',
    'M25 430 L160 515 L285 475 L390 610 L520 565 L670 730 L830 690 L985 780',
  ];
  const visibleTraceLines = prefersReducedMotion ? traceLines.slice(0, 2) : traceLines;
  const traceNodeCount = prefersReducedMotion ? 10 : 34;
  const particleCount = prefersReducedMotion ? 16 : 80;

  return (
    <div className="ambient-stage" aria-hidden="true">
      <div className="deep-field" />
      {!prefersReducedMotion ? <div className="signal-dust" /> : null}
      <svg className="constellation-map" viewBox="0 0 1000 860" preserveAspectRatio="none">
        {visibleTraceLines.map((line, index) => (
          <path className="trace-line" d={line} key={line} style={{ '--i': index } as CSSProperties} />
        ))}
        {Array.from({ length: traceNodeCount }).map((_, index) => (
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
      {!prefersReducedMotion ? (
        <>
          <div className="wave wave-a" />
          <div className="wave wave-b" />
          <div className="grid-noise" />
        </>
      ) : null}
      {Array.from({ length: particleCount }).map((_, index) => (
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
