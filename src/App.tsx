import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type FormEvent } from 'react';
import { Camera, CheckCircle2, Circle, Cpu, Home, LibraryBig, Loader2, LockKeyhole, LogOut, MonitorPlay, Music2, Network, Pause, Pencil, Play, RadioTower, RefreshCw, Route, RotateCcw, Save, ShieldCheck, SkipBack, SkipForward, Sparkles, Square, Trash2, UploadCloud, UserRound, UsersRound, Waves } from 'lucide-react';

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
type AdminDraft = {
  id: string;
  fullName: string;
  roles: string[];
  textSummary: string;
  videoSummaryUrl: string;
  works: Array<{
    id?: string;
    workIndex: number;
    workUrl: string;
    coverUrl: string;
  }>;
  createdAt: string;
};

const defaultEventApiBase = 'https://review-api.saintmob.workers.dev';
const eventApiBase = (import.meta.env.VITE_REVIEW_API_BASE || defaultEventApiBase).replace(/\/+$/, '');
const roleOptions = Array.from(new Set(['音乐', '交互', '视觉', '导演', '海报', '字幕旁白', '技术支持', '场务', '指导老师']));
const ADMIN_TOKEN_KEY = 'review-admin-token-v1';

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

function normalizeRoles(value: unknown) {
  const selected = Array.isArray(value) ? new Set(value.filter((item): item is string => typeof item === 'string')) : new Set<string>();
  return roleOptions.filter((role) => selected.has(role));
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
        roles: normalizeRoles(parsed.form?.roles),
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

function inferVideoContentType(blob: Blob, fileName: string) {
  const explicitType = blob.type.trim();
  if (explicitType.startsWith('video/')) return explicitType;

  const extension = fileName.split('.').pop()?.toLowerCase();
  const typesByExtension: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    qt: 'video/quicktime',
    mkv: 'video/x-matroska',
  };

  return (extension && typesByExtension[extension]) || 'video/mp4';
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

function playVideoIfReady(video: HTMLVideoElement | null) {
  if (!video || !video.currentSrc) return;
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
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

async function readVideoMetadata(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('无法读取视频文件信息'));
      video.src = objectUrl;
    });

    return {
      durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0,
      width: video.videoWidth || 0,
      height: video.videoHeight || 0,
    };
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

async function api<T>(path: string, options: { method?: string; body?: unknown | FormData; headers?: Record<string, string> } = {}) {
  const headers = {
    ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(buildApiUrl(path), {
    method: options.method ?? 'GET',
    headers: Object.keys(headers).length ? headers : undefined,
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await readJsonResponse<T & { error?: string }>(response);

  if (!response.ok) {
    throw new Error(payload.error || `请求失败：HTTP ${response.status}`);
  }

  return payload;
}

function getStoredAdminToken() {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredAdminToken(token: string) {
  try {
    if (token) {
      sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    } else {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  } catch {
    // Session storage can be unavailable in locked-down browsers.
  }
}

function adminApi<T>(path: string, token: string, options: { method?: string; body?: unknown } = {}) {
  return api<T>(path, {
    ...options,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
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
  if (message.includes('HTTP 413')) return '文件过大，超过系统允许的大小限制。';
  return message;
}

function getSummaryScrollDuration(text: string) {
  return `${Math.min(64, Math.max(18, Math.ceil(text.length / 7)))}s`;
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
  const isAdminPage = pathname === '/admin';
  const isUploadPage = pathname === '/upload';
  const isDisplayPage = pathname === '/display' || pathname === '/videos' || pathname === '/video-carousel';
  const isArchitecturePage = pathname === '/architecture' || pathname === '/credits';
  const isPublicPage = pathname === '/public';
  const pageKey = isAdminPage ? 'admin' : isUploadPage ? 'upload' : isDisplayPage ? 'display' : isArchitecturePage ? 'architecture' : isPublicPage ? 'public' : 'home';

  return (
    <main className={`app page-${pageKey}`}>
      <AmbientStage />
      <AppNav activePage={pageKey} />
      {isAdminPage ? <AdminPage /> : isUploadPage ? <UploadPage /> : isDisplayPage ? <DisplayPage /> : isArchitecturePage ? <ArchitecturePage /> : isPublicPage ? <PlaybackPage /> : <LandingPage />}
    </main>
  );
}

function AppNav({ activePage }: { activePage: 'home' | 'display' | 'public' | 'upload' | 'admin' | 'architecture' }) {
  const navItems = [
    { key: 'home', label: '首页', href: '/', icon: Home },
    { key: 'display', label: '现场', href: '/display', icon: MonitorPlay },
    { key: 'public', label: '全部', href: '/public', icon: LibraryBig },
    { key: 'architecture', label: '架构', href: '/architecture', icon: Network },
    { key: 'upload', label: '提交', href: '/upload', icon: UploadCloud },
  ] as const;

  return (
    <header className="app-nav">
      <a className="app-brand" href="/" aria-label="回响入口">
        <span>回响</span>
        <small>课程总结播放</small>
      </a>
      <nav className="app-nav-links" aria-label="主导航">
        {navItems.map(({ key, label, href, icon: Icon }) => (
          <a className={activePage === key ? 'app-nav-link active' : 'app-nav-link'} href={href} aria-current={activePage === key ? 'page' : undefined} key={key}>
            <Icon />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </header>
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
        <p className="eyebrow">首页</p>
        <h1 className="glitch-title" data-text="回响">回响</h1>
        <p className="subtitle">从首页进入现场播放、全部内容或学生提交。</p>
        <div className="hero-actions">
          <a className="primary-action" href="/upload">
            <UploadCloud />
            学生提交
          </a>
          <a className="ghost-action" href="/display">
            <Play />
            现场播放
          </a>
          <a className="ghost-action" href="/public">
            <LibraryBig />
            全部内容
          </a>
        </div>
        <p className="terminal-line"><i /> 先提交，再展示。</p>
      </div>
    </section>
  );
}

function countRoles(students: StudentRecord[]) {
  const counts = new Map<string, number>();
  for (const student of students) {
    for (const role of student.roles) {
      counts.set(role, (counts.get(role) || 0) + 1);
    }
  }

  return roleOptions.map((role) => ({ role, count: counts.get(role) || 0 })).filter((item) => item.count > 0);
}

function getModuleCrew(students: StudentRecord[], roles: string[]) {
  const roleSet = new Set(roles);
  return students
    .filter((student) => student.roles.some((role) => roleSet.has(role)))
    .map((student) => student.fullName)
    .filter(Boolean)
    .slice(0, 10);
}

function groupStudentsByRole(students: StudentRecord[]) {
  return roleOptions
    .map((role) => ({
      role,
      students: students.filter((student) => student.roles.includes(role)).map((student) => student.fullName).filter(Boolean),
    }))
    .filter((group) => group.students.length);
}

function formatCrewNames(names: string[], limit = 8) {
  const visible = names.slice(0, limit);
  const hiddenCount = Math.max(0, names.length - visible.length);
  return hiddenCount ? `${visible.join(' / ')} / +${hiddenCount}` : visible.join(' / ');
}

function ArchitecturePage() {
  const { data, isLoading, message, load } = usePublicEventData();
  const roleCounts = useMemo(() => countRoles(data.students), [data.students]);
  const roleGroups = useMemo(() => groupStudentsByRole(data.students), [data.students]);
  const systemModules = useMemo(
    () => [
      {
        port: '4300',
        name: '总控 API',
        repo: 'vad.26.api',
        icon: RadioTower,
        roles: ['导演', '场务', '技术支持', '指导老师'],
        description: '保存全局状态，承接 Dashboard 控制，把音频、视觉、多屏路由调度到同一条现场时间线上。',
        signals: ['Dashboard', 'WebSocket', '屏幕路由', '全局状态'],
      },
      {
        port: '4301',
        name: 'DJ / 音频',
        repo: 'mixer-target-123',
        icon: Music2,
        roles: ['音乐'],
        description: '播放与混音，向总控持续发布实时音频特征，为视觉和多屏交互提供节奏脉冲。',
        signals: ['混音播放', '音频特征', '节奏驱动'],
      },
      {
        port: '4302',
        name: 'VJ 视觉',
        repo: 'visual-dynamic-effect',
        icon: Sparkles,
        roles: ['视觉', '字幕旁白'],
        description: '承载 VJ 控制台和屏幕输出，接收场景、文字、音频驱动与全屏控制。',
        signals: ['Dumbar', 'Topology', 'Liquid', 'Chromaflux', 'Cyber'],
      },
      {
        port: '4303',
        name: '多屏特效',
        repo: 'baofa',
        icon: Route,
        roles: ['交互', '技术支持'],
        description: '负责原生多屏特效、树形生长、烟花模式与每块屏幕的交互呈现。',
        signals: ['Tree', 'Firework', 'Pulse', 'Reset tree'],
      },
      {
        port: '公网',
        name: '回响提交与归档',
        repo: 'review',
        icon: UsersRound,
        roles: roleOptions,
        description: '收集学生总结、视频与作品封面，把课程参与者的分工映射成公开展示和管理后台。',
        signals: ['学生提交', 'D1 / R2', '公开播放', '内容管理'],
      },
    ],
    [],
  );

  const screenGroups = [
    { name: 'A', ids: ['A1'] },
    { name: 'B', ids: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'] },
    { name: 'C', ids: ['C1', 'C2', 'C3', 'C4'] },
    { name: 'D', ids: ['D1', 'D2', 'D3'] },
    { name: '翼', ids: ['E1', 'F1', 'L1', 'L2', 'R1', 'R2'] },
  ];
  const routePresets = [
    {
      name: 'Balanced',
      description: 'A1、L1、L2、R1、R2 交给 VJ，其余屏幕交给 baofa，让主视觉与多屏特效同时在场。',
    },
    {
      name: 'VJ Takeover',
      description: '所有屏幕切到 VJ，用统一视觉场景接管现场。',
    },
    {
      name: 'Baofa Takeover',
      description: '所有屏幕切到 baofa，用树、烟花、脉冲和互动状态接管现场。',
    },
  ];

  return (
    <section className="architecture-page page-fade">
      <div className="architecture-hero">
        <div>
          <p className="eyebrow">架构</p>
          <h1 className="architecture-title">演职员表，也是系统图</h1>
          <p className="subtitle">
            这套项目由现场总控、DJ、VJ、多屏交互和提交归档共同组成。每个模块都有自己的端口、职责和参与者，观众看到的是一场演出，后台跑着一支临时剧组。
          </p>
        </div>
        <div className="architecture-live-card">
          <span>线上数据</span>
          <strong>{data.students.length || '—'}</strong>
          <p>位参与者 / {data.works.length || '—'} 组作品 / {data.summaries.length || '—'} 条视频总结</p>
          <button className="ghost-action" type="button" onClick={() => void load()} disabled={isLoading}>
            {isLoading ? <Loader2 className="spin" /> : <RefreshCw />}
            刷新
          </button>
        </div>
      </div>

      <div className="architecture-flow" aria-label="模块流向">
        <div className="architecture-node main-node">
          <Cpu />
          <strong>4300 总控</strong>
          <span>状态 / 命令 / 路由</span>
        </div>
        <div className="architecture-lanes">
          <span>4301 DJ 音频特征</span>
          <span>4302 VJ 场景输出</span>
          <span>4303 baofa 多屏特效</span>
          <span>review 提交归档</span>
        </div>
      </div>

      <div className="architecture-grid">
        {systemModules.map(({ port, name, repo, icon: Icon, roles, description, signals }) => {
          const crew = getModuleCrew(data.students, roles);
          return (
            <article className="architecture-module" key={repo}>
              <div className="architecture-module-head">
                <span>{port}</span>
                <Icon />
              </div>
              <h2>{name}</h2>
              <p>{description}</p>
              <div className="architecture-tags">
                {signals.map((signal) => <span key={signal}>{signal}</span>)}
              </div>
              <div className="architecture-crew">
                <strong>{repo}</strong>
                <p>{crew.length ? crew.join(' / ') : '现场支持与系统协作'}</p>
              </div>
            </article>
          );
        })}
      </div>

      <div className="architecture-panels">
        <section className="architecture-panel">
          <div className="section-heading archive-heading">
            <div>
              <p className="eyebrow">团队分工</p>
              <h2>从提交数据生成的参与结构</h2>
            </div>
          </div>
          <div className="role-count-grid">
            {roleCounts.length ? roleCounts.map((item) => (
              <div className="role-count-item" key={item.role}>
                <span>{item.role}</span>
                <strong>{item.count}</strong>
              </div>
            )) : <p className="empty-state">正在读取团队分工...</p>}
          </div>
        </section>

        <section className="architecture-panel">
          <div className="section-heading archive-heading">
            <div>
              <p className="eyebrow">屏幕路由</p>
              <h2>20 块屏幕的现场入口</h2>
            </div>
          </div>
          <div className="screen-map-grid">
            {screenGroups.map((group) => (
              <div className="screen-group" key={group.name}>
                <strong>{group.name}</strong>
                <div>
                  {group.ids.map((id) => <span key={id}>{id}</span>)}
                </div>
              </div>
            ))}
          </div>
          <p className="meta-line">屏幕只需打开 4300 的统一入口，由总控根据 owner 自动跳转到 VJ、baofa 或诊断状态。</p>
        </section>
      </div>

      <div className="architecture-panels">
        <section className="architecture-panel">
          <div className="section-heading archive-heading">
            <div>
              <p className="eyebrow">演职员表</p>
              <h2>按模块职能展开</h2>
            </div>
          </div>
          <div className="credit-role-list">
            {roleGroups.length ? roleGroups.map((group) => (
              <div className="credit-role-item" key={group.role}>
                <strong>{group.role}</strong>
                <p>{formatCrewNames(group.students, 10)}</p>
              </div>
            )) : <p className="empty-state">正在读取团队名单...</p>}
          </div>
        </section>

        <section className="architecture-panel">
          <div className="section-heading archive-heading">
            <div>
              <p className="eyebrow">调度方式</p>
              <h2>现场如何切换所有屏幕</h2>
            </div>
          </div>
          <div className="route-preset-list">
            {routePresets.map((preset) => (
              <div className="route-preset-item" key={preset.name}>
                <strong>{preset.name}</strong>
                <p>{preset.description}</p>
              </div>
            ))}
          </div>
          <p className="meta-line">Dashboard 的控制命令进入 4300，再通过 WebSocket 分发给 VJ、baofa 和屏幕网关。</p>
        </section>
      </div>

      {message && <p className="form-message">{message}</p>}
    </section>
  );
}

function DisplayPage() {
  const { data, isLoading, message, load } = usePublicEventData();
  const [isStarted, setIsStarted] = useState(false);
  const [trackIndex, setTrackIndex] = useState(0);
  const [isTransitionEnabled, setIsTransitionEnabled] = useState(true);
  const [isAwaitingNext, setIsAwaitingNext] = useState(false);
  const [isPlaybackPaused, setIsPlaybackPaused] = useState(false);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const startLockRef = useRef(false);

  const reviewStudents = useMemo(() => {
    return data.students.filter((student) => isPlayableReviewVideoUrl(student.videoSummaryUrl));
  }, [data.students]);

  const slides = useMemo(() => {
    return reviewStudents.map((student) => {
      const primaryWork = getStudentPrimaryWork(student);
      const displayWorks = student.works.filter((work) => work.coverUrl || work.workUrl).slice(0, 2);
      return {
        ...student,
        primaryWork,
        displayWorks,
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
  const queuePreview = slides.slice(0, 4);

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
    playVideoIfReady(currentVideo);
  }, [isStarted, slides.length, trackIndex]);

  useEffect(() => {
    setIsAwaitingNext(false);
    setIsPlaybackPaused(false);
  }, [trackIndex]);

  function startDisplay() {
    if (startLockRef.current) return;
    startLockRef.current = true;
    setIsStarted(true);
    setTrackIndex(0);
    setIsTransitionEnabled(true);
    setIsAwaitingNext(false);
    setIsPlaybackPaused(false);
  }

  function stopDisplay() {
    videoRefs.current.forEach((video) => {
      if (video && !video.paused) video.pause();
    });
    startLockRef.current = false;
    setIsStarted(false);
    setTrackIndex(0);
    setIsTransitionEnabled(true);
    setIsAwaitingNext(false);
    setIsPlaybackPaused(false);
  }

  useEffect(() => {
    if (!isStarted) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        stopDisplay();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isStarted]);

  function goPrevious() {
    if (!slides.length) return;
    setIsAwaitingNext(false);
    setIsTransitionEnabled(true);
    setTrackIndex((current) => {
      if (current === slides.length) return Math.max(slides.length - 1, 0);
      return current <= 0 ? Math.max(slides.length - 1, 0) : current - 1;
    });
  }

  function goNext() {
    if (!slides.length) return;
    setIsAwaitingNext(false);
    if (slides.length === 1) {
      const currentVideo = videoRefs.current[0];
      if (currentVideo) {
        currentVideo.currentTime = 0;
        playVideoIfReady(currentVideo);
      }
      return;
    }
    const nextIndex = trackIndex >= slides.length - 1 ? slides.length : trackIndex + 1;
    const nextVideo = videoRefs.current[nextIndex];
    if (nextVideo) {
      nextVideo.currentTime = 0;
      playVideoIfReady(nextVideo);
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

  function togglePlaybackPause() {
    const activeIndex = slides.length ? trackIndex % slides.length : 0;
    const currentVideo = videoRefs.current[activeIndex];
    if (!currentVideo) return;
    if (isPlaybackPaused) {
      setIsPlaybackPaused(false);
      playVideoIfReady(currentVideo);
      return;
    }
    currentVideo.pause();
    setIsPlaybackPaused(true);
  }

  return (
    <section className={`display-page page-fade ${isStarted ? 'is-reviewing' : ''}`}>
      {!isStarted ? (
        <div className="display-header">
          <div>
            <div className="signal-pills" aria-hidden="true">
              <span>现场播放</span>
              <span>手动下一位</span>
              <span>投屏模式</span>
            </div>
            <p className="eyebrow">现场播放</p>
            <h1 className="display-page-title">播放控制台</h1>
            <p className="subtitle">课堂投屏逐位播放；全部页用于课后浏览作品、视频和总结。</p>
            <p className="display-count">{slides.length ? `${slides.length} 位待播放` : '等待可播放视频'}</p>
          </div>
          <div className="display-header-actions">
            <button className="ghost-action" type="button" onClick={() => void load()}>
              <RefreshCw />
              刷新数据
            </button>
            <a className="ghost-action" href="/public">
              <LibraryBig />
              打开全部
            </a>
          </div>
        </div>
      ) : null}

      {!isStarted ? (
        <div className="display-queue-strip" aria-label="现场播放队列">
          <div>
            <span>播放队列</span>
            <strong>{slides.length ? `${slides.length} 位同学` : '暂无视频'}</strong>
          </div>
          {queuePreview.length ? (
            <ol>
              {queuePreview.map((slide, index) => (
                <li key={slide.id || `${slide.fullName}-${index}`}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{slide.fullName}</strong>
                  <small>{slide.roleLabel}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p>提交页录入并上传视频后，这里会生成现场播放队列。</p>
          )}
        </div>
      ) : null}

      <div className={isStarted ? 'display-stage is-live' : 'display-stage is-idle'}>
        {isStarted && slides.length ? (
          <div className="display-review-rail">
            <div>
              <span>{String((trackIndex % slides.length) + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</span>
              <strong>{slides[trackIndex % slides.length]?.fullName || '回顾播放'}</strong>
              <small>现场播放中</small>
            </div>
          </div>
        ) : null}
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
              const summaryText = slide.textSummary || '这位同学尚未填写课程总结。';
              const shouldScrollSummary = isStarted && summaryText.length > 80;
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
                              playVideoIfReady(currentVideo);
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
                      <div className="display-work-list">
                        {slide.displayWorks.length ? (
                          slide.displayWorks.map((work, workIndex) => (
                            <article className="display-work-item" key={work.id || `${slide.id}-work-${workIndex}`}>
                              {work.coverUrl ? (
                                <img
                                  className="display-cover"
                                  src={work.coverUrl}
                                  alt={`${slide.fullName} 的作品封面 ${workIndex + 1}`}
                                  loading={shouldPrioritizeCover ? 'eager' : 'lazy'}
                                  decoding="async"
                                />
                              ) : (
                                <div className="display-cover placeholder">暂无作品封面</div>
                              )}
                              <div className="display-work-item-foot">
                                <span>作品 {work.workIndex ?? workIndex + 1}</span>
                                {work.workUrl ? (
                                  <a className="display-link" href={work.workUrl} target="_blank" rel="noreferrer">
                                    查看作品
                                  </a>
                                ) : (
                                  <div className="display-link">链接待补充</div>
                                )}
                              </div>
                            </article>
                          ))
                        ) : (
                          <div className="display-cover placeholder">暂无作品封面</div>
                        )}
                      </div>
                      <div className="display-meta-block">
                        <span>{slide.displayWorks.length > 1 ? `${slide.displayWorks.length} 组作品` : slide.workLabel}</span>
                        <strong>{slide.fullName}</strong>
                        <span>{slide.roleLabel}</span>
                      </div>
                    </aside>

                    <div className="display-summary-strip">
                      <div className="display-summary-title">总结</div>
                      <p
                        className={shouldScrollSummary ? 'is-auto-scrolling' : undefined}
                        style={{ ['--summary-scroll-duration' as string]: getSummaryScrollDuration(summaryText) }}
                      >
                        {summaryText}
                      </p>
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
              <strong>开始现场播放</strong>
              <span>进入队列播放模式。视频结束后，右下角会出现“下一位”。</span>
            </div>
          </div>
        ) : null}

        {isStarted && slides.length ? (
          <div className="display-control-dock" aria-label="现场播放控制">
            <button type="button" onClick={goPrevious} aria-label="上一位" title="上一位">
              <SkipBack />
            </button>
            <button type="button" onClick={togglePlaybackPause} aria-label={isPlaybackPaused ? '继续' : '暂停'} title={isPlaybackPaused ? '继续' : '暂停'}>
              {isPlaybackPaused ? <Play /> : <Pause />}
            </button>
            <button className={isAwaitingNext ? 'is-ready' : undefined} type="button" onClick={goNext} aria-label="下一位" title="下一位">
              <SkipForward />
            </button>
          </div>
        ) : null}
      </div>

      {!isStarted && (message ? <p className="terminal-line display-message"><i /> {message}</p> : null)}
    </section>
  );
}

function PlaybackPage() {
  const { data, isLoading, message, load } = usePublicEventData();
  const [archiveView, setArchiveView] = useState<'author' | 'type'>('author');
  const summaryCount = data.summaries.length;
  const workCount = data.works.length;
  const authorGroups = useMemo(() => {
    const groups = new Map<string, { name: string; summaries: Summary[]; works: Work[] }>();

    data.summaries.forEach((summary) => {
      const name = summary.fullName || '未命名同学';
      const group = groups.get(name) || { name, summaries: [], works: [] };
      group.summaries.push(summary);
      groups.set(name, group);
    });

    data.works.forEach((work) => {
      const name = work.studentName || '未命名同学';
      const group = groups.get(name) || { name, summaries: [], works: [] };
      group.works.push(work);
      groups.set(name, group);
    });

    return Array.from(groups.values());
  }, [data.summaries, data.works]);
  const [activeSummaryId, setActiveSummaryId] = useState('');
  const activeSummary = useMemo(
    () => data.summaries.find((summary) => summary.id === activeSummaryId) || null,
    [activeSummaryId, data.summaries],
  );

  return (
    <>
      <section className="playback-hero page-fade">
        <div className="hero-copy">
          <div className="signal-pills" aria-hidden="true">
            <span>按作者</span>
            <span>按类型</span>
            <span>课后浏览</span>
          </div>
          <p className="eyebrow">全部内容</p>
          <h1 className="glitch-title" data-text="全部">全部</h1>
          <p className="subtitle">课后浏览入口，按作者或内容类型查看视频、图像和总结文本。</p>
          <div className="public-metrics" aria-label="公开页面统计">
            <span><strong>{summaryCount}</strong> 视频总结</span>
            <span><strong>{workCount}</strong> 作品封面</span>
            <span><strong>{summaryCount}</strong> 总结文本</span>
          </div>
          <div className="hero-actions">
            <a className="primary-action" href="/display">
              <Play />
              进入现场
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
        <div className="section-heading archive-heading">
          <div>
            <p className="eyebrow">内容视图</p>
            <h2>{archiveView === 'author' ? '按作者聚合' : '按类型排列'}</h2>
          </div>
          <div className="archive-view-switch" aria-label="内容分类方式">
            <button className={archiveView === 'author' ? 'active' : undefined} type="button" onClick={() => setArchiveView('author')}>
              按作者
            </button>
            <button className={archiveView === 'type' ? 'active' : undefined} type="button" onClick={() => setArchiveView('type')}>
              按类型
            </button>
          </div>
        </div>

        {activeSummary ? (
          <article className="reflection-card">
            <div className="summary-detail-view">
              <div className="summary-detail-header">
                <button className="ghost-action" type="button" onClick={() => setActiveSummaryId('')}>
                  返回
                </button>
                <div>
                  <p className="eyebrow">作者聚合</p>
                  <strong>{activeSummary.fullName}</strong>
                </div>
              </div>
              <MediaPlayer summary={activeSummary} featured />
              <p className="summary-detail-text">{activeSummary.textSummary || '这位同学暂未填写文本总结。'}</p>
            </div>
          </article>
        ) : archiveView === 'author' ? (
          <div className="archive-author-list">
            {isLoading && !authorGroups.length ? <p className="empty-state">正在载入全部内容...</p> : null}
            {authorGroups.map((group) => (
              <article className="archive-author-module" key={group.name}>
                <div className="archive-author-head">
                  <div>
                    <span>作者</span>
                    <h3>{group.name}</h3>
                  </div>
                  <p>{group.summaries.length} 视频 / {group.works.length} 图像 / {group.summaries.length} 文本</p>
                </div>
                <div className="archive-author-content">
                  <div className="summary-link-list">
                    {group.summaries.map((summary) => (
                      <div className="summary-item" key={summary.id}>
                        <strong>视频总结</strong>
                        <p>{summary.textSummary || '暂无文本总结。'}</p>
                        <button className="summary-open-button" type="button" onClick={() => setActiveSummaryId(summary.id)}>
                          打开视频
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="work-link-list">
                    {group.works.map((work) => (
                      <a className="work-link-card" href={work.workUrl} target="_blank" rel="noreferrer" key={work.id || `${work.studentName}-${work.workUrl}`}>
                        <img src={work.coverUrl} alt={`${work.studentName || '同学'} 作品封面`} loading="lazy" decoding="async" />
                        <span>作品 {work.workIndex ?? 1}</span>
                      </a>
                    ))}
                  </div>
                </div>
              </article>
            ))}
            {!isLoading && !authorGroups.length ? <p className="empty-state">暂无可浏览内容。</p> : null}
          </div>
        ) : (
          <div className="archive-type-grid">
            <article className="reflection-card">
              <div className="card-index">Video</div>
              <h3>视频</h3>
              {data.summaries.length ? (
                <div className="summary-link-list">
                  {data.summaries.map((summary) => (
                    <div className="summary-item" key={summary.id}>
                      <strong>{summary.fullName}</strong>
                      <button className="summary-open-button" type="button" onClick={() => setActiveSummaryId(summary.id)}>
                        打开视频总结
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p>暂无视频。</p>
              )}
            </article>
            <article className="reflection-card">
              <div className="card-index">Image</div>
              <h3>图像</h3>
              {data.works.length ? (
                <div className="work-link-list">
                  {data.works.map((work) => (
                    <a className="work-link-card" href={work.workUrl} target="_blank" rel="noreferrer" key={work.id || `${work.studentName}-${work.workUrl}`}>
                      <img src={work.coverUrl} alt={`${work.studentName || '同学'} 作品封面`} loading="lazy" decoding="async" />
                      <span>{work.studentName || '未命名同学'} · 作品 {work.workIndex ?? 1}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <p>暂无图像。</p>
              )}
            </article>
            <article className="reflection-card">
              <div className="card-index">Text</div>
              <h3>总结文本</h3>
              {data.summaries.length ? (
                <div className="summary-link-list">
                  {data.summaries.map((summary) => (
                    <div className="summary-item" key={summary.id}>
                      <strong>{summary.fullName}</strong>
                      <p>{summary.textSummary || '暂无文本总结。'}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p>暂无总结文本。</p>
              )}
            </article>
          </div>
        )}
      </section>
    </>
  );
}

function createAdminDraft(student: StudentRecord): AdminDraft {
  const works = [0, 1].map((index) => {
    const work = student.works[index];
    return {
      id: work?.id,
      workIndex: work?.workIndex ?? index + 1,
      workUrl: work?.workUrl || '',
      coverUrl: work?.coverUrl || '',
    };
  });

  return {
    id: student.id,
    fullName: student.fullName,
    roles: normalizeRoles(student.roles),
    textSummary: student.textSummary,
    videoSummaryUrl: student.videoSummaryUrl,
    works,
    createdAt: student.createdAt,
  };
}

function AdminPage() {
  const [token, setToken] = useState(getStoredAdminToken);
  const [password, setPassword] = useState('');
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<AdminDraft | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(token));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function loadAdminStudents(activeToken = token) {
    if (!activeToken) return;
    setIsLoading(true);
    try {
      const payload = await adminApi<{ students: StudentRecord[] }>('/api/admin/students', activeToken);
      const nextStudents = payload.students ?? [];
      setStudents(nextStudents);
      const nextSelected = nextStudents.find((student) => student.id === selectedId) || nextStudents[0] || null;
      setSelectedId(nextSelected?.id || '');
      setDraft(nextSelected ? createAdminDraft(nextSelected) : null);
      setMessage(nextStudents.length ? '管理内容已更新' : '暂无提交内容');
    } catch (error) {
      setStoredAdminToken('');
      setToken('');
      setMessage(error instanceof Error ? error.message : '管理员登录已失效');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      void loadAdminStudents(token);
    }
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setMessage('正在登录...');
    try {
      const payload = await api<{ ok?: boolean; token: string; expiresAt: string }>('/api/admin/login', {
        method: 'POST',
        body: { password },
      });
      if (!payload.token) throw new Error('登录响应缺少会话');
      setStoredAdminToken(payload.token);
      setToken(payload.token);
      setPassword('');
      setMessage('登录成功');
      await loadAdminStudents(payload.token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '登录失败');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogout() {
    if (token) {
      await adminApi('/api/admin/logout', token, { method: 'POST' }).catch(() => {});
    }
    setStoredAdminToken('');
    setToken('');
    setStudents([]);
    setSelectedId('');
    setDraft(null);
    setMessage('已退出管理');
  }

  function selectStudent(student: StudentRecord) {
    setSelectedId(student.id);
    setDraft(createAdminDraft(student));
    setMessage('');
  }

  function toggleDraftRole(role: string) {
    setDraft((current) => {
      if (!current) return current;
      const roles = current.roles.includes(role) ? current.roles.filter((item) => item !== role) : [...current.roles, role];
      return { ...current, roles: normalizeRoles(roles) };
    });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !token) return;
    setIsSaving(true);
    setMessage('正在保存...');
    try {
      const works = draft.works
        .map((work, index) => ({
          ...work,
          workIndex: index + 1,
          workUrl: work.workUrl.trim(),
          coverUrl: work.coverUrl.trim(),
        }))
        .filter((work) => work.workUrl || work.coverUrl);
      const payload = await adminApi<{ ok?: boolean; student: StudentRecord }>(`/api/admin/students/${encodeURIComponent(draft.id)}`, token, {
        method: 'PUT',
        body: {
          fullName: draft.fullName.trim(),
          roles: normalizeRoles(draft.roles),
          textSummary: draft.textSummary.trim(),
          videoSummaryUrl: draft.videoSummaryUrl.trim(),
          works,
          createdAt: draft.createdAt,
        },
      });
      const updated = payload.student;
      setStudents((current) => current.map((student) => (student.id === updated.id ? updated : student)));
      setDraft(createAdminDraft(updated));
      setMessage('保存成功');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft || !token) return;
    if (!window.confirm(`确认删除 ${draft.fullName || '这条提交'}？删除后公开页将不再显示该内容。`)) return;
    setIsSaving(true);
    setMessage('正在删除...');
    try {
      await adminApi(`/api/admin/students/${encodeURIComponent(draft.id)}`, token, { method: 'DELETE' });
      const remaining = students.filter((student) => student.id !== draft.id);
      setStudents(remaining);
      const nextSelected = remaining[0] || null;
      setSelectedId(nextSelected?.id || '');
      setDraft(nextSelected ? createAdminDraft(nextSelected) : null);
      setMessage('删除成功');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败');
    } finally {
      setIsSaving(false);
    }
  }

  if (!token) {
    return (
      <section className="upload-page admin-page page-fade">
        <div className="upload-intro">
          <p className="eyebrow">管理页</p>
          <h1 className="upload-title">内容管理</h1>
          <p className="subtitle">输入管理员密码后编辑或删除学生提交内容。</p>
          <div className="upload-status-strip" aria-label="管理能力">
            <span>D1 密码</span>
            <span>失败限流</span>
            <span>会话保护</span>
          </div>
        </div>

        <form className="upload-console admin-login-panel" onSubmit={handleLogin}>
          <div className="console-heading">
            <div>
              <p className="eyebrow">登录</p>
              <h2>管理员入口</h2>
            </div>
            <LockKeyhole />
          </div>
          <label className="field-label" htmlFor="admin-password">管理员密码</label>
          <div className="input-wrap">
            <ShieldCheck aria-hidden="true" />
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {message && <p className={`form-message ${message.includes('不正确') || message.includes('过多') || message.includes('失败') ? 'is-error' : ''}`}>{message}</p>}
          <button className="primary-action" type="submit" disabled={isLoading}>
            {isLoading ? <Loader2 className="spin" /> : <LockKeyhole />}
            登录
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="upload-page admin-page page-fade">
      <div className="upload-intro">
        <p className="eyebrow">管理页</p>
        <h1 className="upload-title">内容管理</h1>
        <p className="subtitle">编辑学生提交信息，或删除不需要展示的内容。</p>
        <div className="upload-status-strip" aria-label="管理状态">
          <span>{students.length} 条提交</span>
          <span>{draft ? '已选择' : '未选择'}</span>
        </div>
        <button className="ghost-action admin-logout-button" type="button" onClick={() => void handleLogout()}>
          <LogOut />
          退出
        </button>
      </div>

      <div className="admin-console">
        <div className="admin-list-panel">
          <div className="section-heading archive-heading">
            <div>
              <p className="eyebrow">记录</p>
              <h2>提交列表</h2>
            </div>
            <button className="ghost-action admin-refresh-button" type="button" onClick={() => void loadAdminStudents()} disabled={isLoading}>
              {isLoading ? <Loader2 className="spin" /> : <RefreshCw />}
              刷新
            </button>
          </div>
          <div className="admin-record-list">
            {students.map((student) => (
              <button className={selectedId === student.id ? 'admin-record-item active' : 'admin-record-item'} type="button" key={student.id} onClick={() => selectStudent(student)}>
                <strong>{student.fullName || '未命名同学'}</strong>
                <span>{student.roles.length ? student.roles.join(' / ') : '未选职能'}</span>
                <small>{formatTimestamp(student.createdAt)}</small>
              </button>
            ))}
            {!students.length ? <p className="empty-state">暂无提交内容。</p> : null}
          </div>
        </div>

        <form className="upload-console admin-edit-panel" onSubmit={handleSave}>
          <div className="console-heading">
            <div>
              <p className="eyebrow">编辑</p>
              <h2>{draft ? draft.fullName || '未命名同学' : '选择一条记录'}</h2>
            </div>
            <Pencil />
          </div>

          {draft ? (
            <>
              <div className="identity-role-grid">
                <div className="identity-field">
                  <label className="field-label" htmlFor="admin-student-name">学生姓名</label>
                  <div className="input-wrap">
                    <UserRound aria-hidden="true" />
                    <input id="admin-student-name" value={draft.fullName} onChange={(event) => setDraft((current) => current ? { ...current, fullName: event.target.value } : current)} required />
                  </div>
                </div>

                <div className="role-field">
                  <div className="role-field-head">
                    <span className="field-label">工作人员职能</span>
                    <span>{draft.roles.length ? `已选 ${draft.roles.length}` : '至少 1 项'}</span>
                  </div>
                  <div className="role-chip-grid">
                    {roleOptions.map((role) => (
                      <button className={draft.roles.includes(role) ? 'role-chip selected' : 'role-chip'} type="button" key={role} onClick={() => toggleDraftRole(role)}>
                        {role}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <label className="field-label" htmlFor="admin-reflection-note">课程总结</label>
              <textarea id="admin-reflection-note" value={draft.textSummary} onChange={(event) => setDraft((current) => current ? { ...current, textSummary: event.target.value } : current)} rows={4} required />

              <label className="field-label" htmlFor="admin-video-url">视频总结链接</label>
              <input id="admin-video-url" className="url-field" type="url" value={draft.videoSummaryUrl} onChange={(event) => setDraft((current) => current ? { ...current, videoSummaryUrl: event.target.value } : current)} required />

              <div className="subsection-heading">
                <span>作品信息</span>
                <small>最多两组</small>
              </div>
              <div className="work-upload-grid">
                {draft.works.map((work, index) => (
                  <div className="work-upload-card admin-work-card" key={index}>
                    <label className="field-label" htmlFor={`admin-work-url-${index}`}>作品链接 {index + 1}</label>
                    <input
                      id={`admin-work-url-${index}`}
                      className="url-field"
                      type="url"
                      value={work.workUrl}
                      onChange={(event) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                works: current.works.map((currentWork, workIndex) =>
                                  workIndex === index ? { ...currentWork, workUrl: event.target.value } : currentWork,
                                ),
                              }
                            : current,
                        )
                      }
                    />
                    <label className="field-label" htmlFor={`admin-cover-url-${index}`}>封面链接 {index + 1}</label>
                    <input
                      id={`admin-cover-url-${index}`}
                      className="url-field"
                      type="url"
                      value={work.coverUrl}
                      onChange={(event) =>
                        setDraft((current) =>
                          current
                            ? {
                                ...current,
                                works: current.works.map((currentWork, workIndex) =>
                                  workIndex === index ? { ...currentWork, coverUrl: event.target.value } : currentWork,
                                ),
                              }
                            : current,
                        )
                      }
                    />
                  </div>
                ))}
              </div>

              {message && <p className={`form-message ${message.includes('失败') || message.includes('必须') || message.includes('需要') ? 'is-error' : ''}`}>{message}</p>}
              <div className="admin-edit-actions">
                <button className="primary-action" type="submit" disabled={isSaving}>
                  {isSaving ? <Loader2 className="spin" /> : <Save />}
                  保存修改
                </button>
                <button className="ghost-action danger-action" type="button" onClick={() => void handleDelete()} disabled={isSaving}>
                  <Trash2 />
                  删除内容
                </button>
              </div>
            </>
          ) : (
            <p className="empty-state">请选择一条提交记录。</p>
          )}
        </form>
      </div>
    </section>
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
        roles: normalizeRoles(snapshot.form.roles),
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

  async function handleVideoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (!file) return;

    if (!file.type.startsWith('video/') && !/\.(mp4|m4v|webm|mov|qt|mkv)$/i.test(file.name)) {
      setMessage('视频总结只能选择常见视频文件。');
      return;
    }

    try {
      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
      stopCamera();

      const metadata = await readVideoMetadata(file).catch(() => ({ durationMs: 0, width: 0, height: 0 }));
      const fileName = sanitizeUploadName(file.name || `summary-${Date.now()}.mp4`);
      const url = URL.createObjectURL(file);
      recordedUrlRef.current = url;
      recordedFileNameRef.current = fileName;
      setRecordedBlob(file);
      setRecordedUrl(url);
      setForm((current) => ({
        ...current,
        videoSummaryUrl: '',
        uploadId: '',
        objectKey: '',
        sizeBytes: file.size,
        durationMs: metadata.durationMs,
        videoWidth: metadata.width,
        videoHeight: metadata.height,
      }));
      setUploadState('idle');
      setSubmitState('idle');
      setRecordingState('recorded');
      setMessage(`已选择视频：${file.name}，文件体积 ${formatFileSize(file.size)}。`);
    } catch (error) {
      setRecordedBlob(null);
      setRecordedUrl('');
      setUploadState('error');
      setRecordingState('error');
      setMessage(error instanceof Error ? error.message : '无法读取视频文件。');
    }
  }

  async function uploadRecording() {
    if (!recordedBlob) {
      setMessage('请先完成录制。');
      return null;
    }

    const filename = recordedFileNameRef.current || sanitizeUploadName(`summary-${Date.now()}.webm`);
    recordedFileNameRef.current = filename;
    const contentType = inferVideoContentType(recordedBlob, filename);
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
          originalMimeType: recordedBlob.type || contentType,
          originalFileName: filename,
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
      return upload;
    } catch (error) {
      setUploadState('error');
      setForm((current) => ({
        ...current,
        videoSummaryUrl: '',
        uploadId: '',
        objectKey: '',
      }));
      setMessage(getUploadErrorMessage(error));
      return null;
    }
  }

  function toggleRole(role: string) {
    setForm((current) => ({
      ...current,
      roles: normalizeRoles(current.roles.includes(role) ? current.roles.filter((item) => item !== role) : [...current.roles, role]),
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
      if (!form.textSummary.trim()) throw new Error('请输入课程总结。');
      if (recordingState !== 'recorded') throw new Error('请先录制或上传视频总结。');
      let videoSummaryUrl = form.videoSummaryUrl.trim();
      let videoUploadId = form.uploadId;
      let videoObjectKey = form.objectKey;
      let videoSizeBytes = form.sizeBytes;
      if (uploadState !== 'uploaded') {
        setMessage('正在上传视频总结...');
        const upload = await uploadRecording();
        videoSummaryUrl = upload?.publicUrl || '';
        videoUploadId = upload?.uploadId || '';
        videoObjectKey = upload?.objectKey || '';
        videoSizeBytes = upload?.sizeBytes || recordedBlob?.size || form.sizeBytes;
      }
      if (!isHttpsUrl(videoSummaryUrl)) throw new Error('视频上传失败，请重试。');
      const works = await buildWorksPayload(workSlotsRef.current, (status) => setMessage(status));

      setMessage('正在保存提交内容...');
      const payload = await api<{ ok?: boolean; student?: { id: string } }>('/api/students', {
        method: 'POST',
        body: {
          fullName: form.fullName.trim(),
          roles: normalizeRoles(form.roles),
          textSummary: form.textSummary.trim(),
          videoSummaryUrl,
          videoUploadId,
          videoObjectKey,
          videoSizeBytes,
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
      await clearDraftBlobs();
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
        <p className="eyebrow">提交页</p>
        <h1 className="upload-title">学生提交</h1>
        <p className="subtitle">一次提交姓名、职能、视频总结和作品封面。</p>
        <div className="upload-status-strip" aria-label="提交内容">
          <span>身份</span>
          <span>视频</span>
          <span>作品</span>
        </div>
        <p className="terminal-line"><i /> {statusText}</p>
      </div>

      <form className="upload-console" onSubmit={handleSubmit}>
        <div className="console-heading">
          <div>
            <p className="eyebrow">提交内容</p>
            <h2>提交作品</h2>
          </div>
        </div>

        <div className="identity-role-grid">
          <div className="identity-field">
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
          </div>

          <div className="role-field">
            <div className="role-field-head">
              <span className="field-label">工作人员职能</span>
              <span>{form.roles.length ? `已选 ${form.roles.length}` : '至少 1 项'}</span>
            </div>
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
        </div>

        <label className="field-label" htmlFor="reflection-note">课程总结</label>
        <textarea
          id="reflection-note"
          value={form.textSummary}
          onChange={(event) => setForm((current) => ({ ...current, textSummary: event.target.value }))}
          placeholder="写下这门课程中的收获、反思和想记录的内容"
          rows={3}
          required
        />

        <div className="camera-recorder">
          <div className="subsection-heading">
            <span>视频总结</span>
            <small>录制或上传</small>
          </div>
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
            <span>录制：最高 1280 x 720</span>
            <span>上传：MP4 / WebM / MOV</span>
            <span>体积：{form.sizeBytes ? formatFileSize(form.sizeBytes) : '等待视频'}</span>
          </div>

          <div className="recorder-actions">
            <label className="ghost-action video-file-action" htmlFor="summary-video-file">
              <UploadCloud />
              选择视频文件
              <input
                id="summary-video-file"
                type="file"
                accept="video/*,.mp4,.m4v,.webm,.mov,.qt,.mkv"
                onChange={(event) => void handleVideoFileChange(event)}
              />
            </label>
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
                  清除视频
                </button>
                <button className="primary-action" type="button" onClick={() => void uploadRecording()} disabled={uploadState === 'uploading' || uploadState === 'uploaded'}>
                  {uploadState === 'uploading' ? <Loader2 className="spin" /> : <UploadCloud />}
                  {uploadState === 'uploaded' ? '视频已上传' : '上传视频'}
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="subsection-heading">
          <span>作品信息</span>
          <small>链接 + 封面</small>
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
                    <em>封面将随作品一起提交。</em>
                  </>
                ) : (
                  <>
                    <span className="upload-icon" aria-hidden="true">
                      <UploadCloud />
                    </span>
                    <strong>选择封面</strong>
                    <em>支持常见图片格式。</em>
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

        <p className="form-message">至少提交 1 组作品链接和封面。</p>
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
