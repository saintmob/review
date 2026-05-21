import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Cloud,
  CloudOff,
  Download,
  EyeOff,
  Laptop,
  ListChecks,
  MinusCircle,
  Monitor,
  Music,
  Pencil,
  Plus,
  Printer,
  Radio,
  RotateCcw,
  Save,
  ScreenShare,
  Share2,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  Volume2,
} from 'lucide-react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, isFirebaseConfigured, OperationType } from './lib/firebase';

type GroupKey = 'music' | 'visual' | 'interaction' | 'all' | 'ai' | 'control';
type ScreenType = 'all' | 'main' | 'laptop' | 'main-laptop' | 'none' | 'onsite';
type TabKey = 'timeline' | 'staff' | 'checklist' | 'audience';
type OwnerMap = Partial<Record<GroupKey, string>>;

type PreheatItem = {
  id: string;
  group: GroupKey;
  task: string;
  duration: string;
  screen?: ScreenType;
  note?: string;
  owner?: string;
};

type Stage = {
  id: string;
  number: string;
  title: string;
  duration: string;
  tasks: string[];
  groups: GroupKey[];
  screen: ScreenType;
  groupScreens?: Partial<Record<GroupKey, ScreenType>>;
  owners?: OwnerMap;
  note?: string;
  trigger?: string;
  subStages?: Stage[];
};

type StaffGroup = {
  id: string;
  tone: GroupKey;
  title: string;
  fields: Record<string, string>;
};

type ChecklistGroup = {
  id: string;
  title: string;
  items: { id: string; text: string; done: boolean }[];
};

type AudienceRow = {
  id: string;
  time: string;
  title: string;
};

type MemoState = {
  preheat: PreheatItem[];
  stages: Stage[];
  staff: StaffGroup[];
  checklist: ChecklistGroup[];
  audience: AudienceRow[];
};

type SyncStatus = 'local' | 'connecting' | 'synced' | 'dirty' | 'saving' | 'remote-pending' | 'error' | 'copied';

const STORAGE_KEY = 'ensemble-field-manual-v5';
const PLAN_DOC_PATH = ['showPlans', 'ensemble-flow'];

const groupMeta: Record<
  GroupKey,
  {
    label: string;
    chip: string;
    text: string;
    soft: string;
    border: string;
    dot: string;
    Icon: typeof Music;
  }
> = {
  music: {
    label: '音乐组',
    chip: 'bg-violet-100 text-violet-700 ring-violet-200',
    text: 'text-violet-700',
    soft: 'bg-violet-50/80',
    border: 'border-violet-200',
    dot: 'bg-violet-600',
    Icon: Music,
  },
  visual: {
    label: '视觉组',
    chip: 'bg-pink-100 text-pink-700 ring-pink-200',
    text: 'text-pink-700',
    soft: 'bg-pink-50/80',
    border: 'border-pink-200',
    dot: 'bg-pink-500',
    Icon: Monitor,
  },
  interaction: {
    label: '交互组',
    chip: 'bg-orange-100 text-orange-700 ring-orange-200',
    text: 'text-orange-700',
    soft: 'bg-orange-50/80',
    border: 'border-orange-200',
    dot: 'bg-orange-500',
    Icon: Laptop,
  },
  all: {
    label: '全员',
    chip: 'bg-slate-100 text-slate-700 ring-slate-200',
    text: 'text-slate-700',
    soft: 'bg-slate-50/80',
    border: 'border-slate-200',
    dot: 'bg-slate-500',
    Icon: Users,
  },
  ai: {
    label: 'AI 旁白',
    chip: 'bg-sky-100 text-sky-700 ring-sky-200',
    text: 'text-sky-700',
    soft: 'bg-sky-50/80',
    border: 'border-sky-200',
    dot: 'bg-sky-500',
    Icon: Bot,
  },
  control: {
    label: '总控',
    chip: 'bg-blue-100 text-blue-800 ring-blue-200',
    text: 'text-blue-800',
    soft: 'bg-blue-50/80',
    border: 'border-blue-200',
    dot: 'bg-blue-900',
    Icon: Radio,
  },
};

const screenLabels: Record<ScreenType, string> = {
  all: '全部屏幕',
  main: '大屏幕',
  laptop: '小电脑',
  'main-laptop': '大屏幕 + 小电脑',
  none: '无屏幕显示',
  onsite: '视现场情况',
};

const timelineGroups: GroupKey[] = ['music', 'visual', 'interaction', 'ai', 'all', 'control'];
const preheatGroups: GroupKey[] = ['music', 'interaction', 'visual', 'all', 'control'];
const PREHEAT_START_SECONDS = 13 * 60 * 60 + 50 * 60;
const SHOW_START_SECONDS = 14 * 60 * 60;

const defaultState: MemoState = {
  preheat: [
    { id: 'p1', group: 'music', task: '进场音乐（较快）', duration: '3 min', owner: '' },
    { id: 'p2', group: 'interaction', task: '进场签到', duration: '3 min', note: '1台电脑，画面同步到大屏', screen: 'main-laptop', owner: '' },
    { id: 'p3', group: 'visual', task: '小电脑待机画面', duration: '2 min', screen: 'laptop', owner: '' },
    { id: 'p4', group: 'all', task: '所有工作人员就位', duration: '2 min', owner: '' },
  ],
  stages: [
    {
      id: 's1',
      number: '1',
      title: '开场引入',
      duration: '2 min',
      groups: ['visual', 'music'],
      screen: 'all',
      groupScreens: { visual: 'all', music: 'all' },
      owners: {},
      tasks: ['视觉组：熄灯，头像变成星光', '视觉组：汇聚成门，第一视角进门', '视觉组：虚拟 / 展馆第一视角', '音乐组：音乐沉浸'],
      note: '走到虚拟展馆终点后，触发开幕式',
    },
    {
      id: 's2',
      number: '2',
      title: '开幕式',
      duration: '30 s',
      groups: ['visual', 'music', 'ai'],
      screen: 'all',
      groupScreens: { visual: 'all', music: 'all', ai: 'all' },
      owners: {},
      tasks: ['视觉组：所有屏幕开幕式', 'AI 旁白引入', '音乐组：音乐由轻柔引导到更强烈'],
      trigger: '完成虚拟展馆第一视角沉浸体验，走到终点后，自动触发开幕式',
    },
    {
      id: 's3',
      number: '3',
      title: '过渡 1',
      duration: '20 s',
      groups: ['music', 'visual', 'ai'],
      screen: 'all',
      groupScreens: { music: 'all', visual: 'all', ai: 'all' },
      owners: {},
      tasks: ['音乐组：20s 过渡音乐', '视觉组：过渡画面', 'AI 旁白'],
    },
    {
      id: 's4',
      number: '4',
      title: 'Part 1《声成》生成展示',
      duration: '15 min',
      groups: ['music', 'visual', 'interaction', 'ai'],
      screen: 'main-laptop',
      groupScreens: { all: 'main-laptop', control: 'onsite' },
      owners: {},
      tasks: ['全员：分 3 个子阶段推进生成展示', '总控：现场根据观众节奏保持音乐、视觉、交互同步'],
      subStages: [
        {
          id: 's4-1',
          number: '1',
          title: '声成 1',
          duration: '5 min',
          groups: ['music', 'visual', 'ai'],
          screen: 'main-laptop',
          groupScreens: { music: 'main', visual: 'laptop', ai: 'all' },
          owners: {},
          tasks: ['音乐组：DJ / VJ 大屏展示', '视觉组：所有小电脑同步视觉画面', 'AI 旁白'],
        },
        {
          id: 's4-2',
          number: '2',
          title: '声成 2',
          duration: '8 min',
          groups: ['music', 'visual', 'interaction', 'ai'],
          screen: 'main-laptop',
          groupScreens: { visual: 'main-laptop', music: 'main', interaction: 'laptop', ai: 'all' },
          owners: {},
          tasks: ['视觉组：作品讲解 / 在大屏幕', '音乐组：真人录音或弹奏', '音乐组：音乐较欢快', '音乐组：大屏幕主展示', '视觉组：所有小电脑同步视觉画面', '交互组：小屏幕交互待机（作品互动）', 'AI 旁白'],
        },
        {
          id: 's4-3',
          number: '3',
          title: '声成 3',
          duration: '2 min',
          groups: ['music', 'interaction'],
          screen: 'all',
          groupScreens: { music: 'all', interaction: 'all' },
          owners: {},
          tasks: ['音乐组：隆重激烈', '交互组：放烟花', '所有屏幕联动'],
        },
      ],
    },
    {
      id: 's5',
      number: '5',
      title: '过渡 2',
      duration: '20 s',
      groups: ['music', 'visual', 'ai'],
      screen: 'all',
      groupScreens: { music: 'all', visual: 'all', ai: 'all' },
      owners: {},
      tasks: ['音乐组：20s 过渡音乐', '视觉组：过渡画面', 'AI 旁白'],
    },
    {
      id: 's6',
      number: '6',
      title: 'Part 2《回响》包括回顾',
      duration: '3 min',
      groups: ['music', 'visual'],
      screen: 'all',
      groupScreens: { music: 'all', visual: 'all' },
      owners: {},
      tasks: ['音乐组：音乐较欢快', '音乐组：有录音分享', '视觉组：内容回顾 / 素材回顾'],
    },
    {
      id: 's7',
      number: '7',
      title: '字幕谢幕',
      duration: '30 s',
      groups: ['music', 'visual'],
      screen: 'all',
      groupScreens: { music: 'all', visual: 'all' },
      owners: {},
      tasks: ['音乐组：音乐较欢快', '视觉组：字幕谢幕'],
    },
    {
      id: 's8',
      number: '8',
      title: '结束后',
      duration: '自由',
      groups: ['all'],
      screen: 'onsite',
      groupScreens: { all: 'onsite' },
      owners: {},
      tasks: ['全员：自由看裸空间作品'],
    },
  ],
  staff: [
    { id: 'staff-music', tone: 'music', title: '音乐组', fields: { 负责人姓名: '', 'DJ / 音乐控制': '', 过渡音乐控制: '', 备用人员: '' } },
    { id: 'staff-visual', tone: 'visual', title: '视觉组', fields: { 负责人姓名: '', 大屏视觉控制: '', 小电脑待机画面: '', 字幕谢幕控制: '', 备用人员: '' } },
    { id: 'staff-interaction', tone: 'interaction', title: '交互组', fields: { 负责人姓名: '', 进场签到: '', 小电脑交互待机: '', 放烟花互动: '', 备用人员: '' } },
    { id: 'staff-control', tone: 'control', title: '策划 / 总控', fields: { 总控: '', 时间提醒: '', 现场协调: '', 应急处理: '', 摄影记录: '' } },
  ],
  checklist: [
    {
      id: 'check-preheat',
      title: '入场预热内容',
      items: ['进场音乐（较快）已准备', '进场签到页面已打开，并能同步到大屏', '小电脑待机画面已准备', '所有工作人员就位提示已确认'].map((text, index) => ({ id: `preheat-${index}`, text, done: false })),
    },
    {
      id: 'check-opening',
      title: '开场 / 开幕式内容',
      items: ['熄灯与星光头像画面已确认', '汇聚成门 / 第一视角进门画面已确认', '虚拟展馆第一视角路线已确认', '开幕式所有屏幕播放正常', 'AI 旁白引入已确认', '走到终点自动触发开幕式已测试'].map((text, index) => ({ id: `opening-${index}`, text, done: false })),
    },
    {
      id: 'check-shengcheng',
      title: 'Part 1《声成》内容',
      items: ['DJ / VJ 大屏展示内容已准备', '所有小电脑同步视觉画面已确认', '作品讲解 / 大屏幕展示内容已排列', '真人录音或弹奏素材已准备', '小屏幕交互待机（作品互动）已确认', '隆重激烈音乐段已准备', '放烟花互动已测试', '所有屏幕联动画面已确认'].map((text, index) => ({ id: `shengcheng-${index}`, text, done: false })),
    },
    {
      id: 'check-ending',
      title: '过渡 / 回响 / 谢幕内容',
      items: ['过渡 1 与过渡 2 的音乐、画面已准备', 'Part 2《回响》录音分享已准备', '内容回顾 / 素材回顾已准备', '字幕谢幕文件已准备', '结束后自由观看提示已准备', '屏幕联动与现场氛围统一已确认'].map((text, index) => ({ id: `ending-${index}`, text, done: false })),
    },
  ],
  audience: [
    { id: 'a1', time: '进场阶段', title: '入场预热' },
    { id: 'a2', time: '0:00-2:00', title: '开场引入' },
    { id: 'a3', time: '2:00-2:30', title: '开幕式' },
    { id: 'a4', time: '2:30-2:50', title: '过渡' },
    { id: 'a5', time: '2:50-17:50', title: 'Part 1《声成》' },
    { id: 'a6', time: '17:50-18:10', title: '过渡' },
    { id: 'a7', time: '18:10-21:10', title: 'Part 2《回响》' },
    { id: 'a8', time: '21:10-21:40', title: '字幕谢幕' },
    { id: 'a9', time: '结束后', title: '自由观看' },
  ],
};

function loadState(): MemoState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...defaultState, ...JSON.parse(saved) } : defaultState;
  } catch {
    return defaultState;
  }
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseDurationToSeconds(value?: string) {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw || raw.includes('自由') || raw.includes('待定')) return 0;

  const clock = raw.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    const first = Number(clock[1]);
    const second = Number(clock[2]);
    const third = Number(clock[3] ?? 0);
    return clock[3] ? first * 3600 + second * 60 + third : first * 60 + second;
  }

  let total = 0;
  const patterns: Array<[RegExp, number]> = [
    [/(\d+(?:\.\d+)?)\s*(?:h|hr|hour|hours|小时)/g, 3600],
    [/(\d+(?:\.\d+)?)\s*(?:min|mins|minute|minutes|m|分钟|分)/g, 60],
    [/(\d+(?:\.\d+)?)\s*(?:s|sec|second|seconds|秒)/g, 1],
  ];

  for (const [pattern, multiplier] of patterns) {
    for (const match of raw.matchAll(pattern)) {
      total += Number(match[1]) * multiplier;
    }
  }

  if (total > 0) return Math.round(total);
  const fallbackNumber = Number(raw.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(fallbackNumber) ? Math.round(fallbackNumber * 60) : 0;
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return '0 min';
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes === 0) return `${remainSeconds} s`;
  return remainSeconds ? `${minutes} min ${remainSeconds} s` : `${minutes} min`;
}

function formatClockTime(totalSeconds: number) {
  const normalized = ((Math.round(totalSeconds) % 86400) + 86400) % 86400;
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const seconds = normalized % 60;
  const base = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return seconds ? `${base}:${String(seconds).padStart(2, '0')}` : base;
}

function formatTimeRange(startSeconds: number, durationSeconds: number) {
  if (durationSeconds <= 0) return `${formatClockTime(startSeconds)} 起`;
  return `${formatClockTime(startSeconds)}-${formatClockTime(startSeconds + durationSeconds)}`;
}

function getStageDurationSeconds(stage: Stage) {
  if (stage.subStages?.length) {
    const subTotal = stage.subStages.reduce((sum, subStage) => sum + parseDurationToSeconds(subStage.duration), 0);
    return subTotal || parseDurationToSeconds(stage.duration);
  }
  return parseDurationToSeconds(stage.duration);
}

function getPreheatDurationSeconds(item: PreheatItem) {
  return parseDurationToSeconds(item.duration);
}

function buildTimeSlots<T>(items: T[], startSeconds: number, getDuration: (item: T) => number) {
  let cursor = startSeconds;
  return items.map((item) => {
    const durationSeconds = getDuration(item);
    const slot = {
      item,
      startSeconds: cursor,
      durationSeconds,
      range: formatTimeRange(cursor, durationSeconds),
    };
    cursor += durationSeconds;
    return slot;
  });
}

function App() {
  const [data, setData] = useState<MemoState>(loadState);
  const [activeTab, setActiveTab] = useState<TabKey>('timeline');
  const [isEditing, setIsEditing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(isFirebaseConfigured ? 'connecting' : 'local');
  const [syncMessage, setSyncMessage] = useState(isFirebaseConfigured ? '正在连接云端' : '本地模式');
  const [lastSavedAt, setLastSavedAt] = useState('');
  const hasMountedRef = useRef(false);
  const applyingRemoteRef = useRef(false);
  const isDirtyRef = useRef(false);
  const isEditingRef = useRef(false);

  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (applyingRemoteRef.current) {
      applyingRemoteRef.current = false;
      isDirtyRef.current = false;
      setIsDirty(false);
      return;
    }

    isDirtyRef.current = true;
    setIsDirty(true);
    setSyncStatus(isFirebaseConfigured ? 'dirty' : 'local');
    setSyncMessage(isFirebaseConfigured ? '有未保存修改' : '修改已保存在本机');
  }, [data]);

  useEffect(() => {
    if (!db) {
      setSyncStatus('local');
      setSyncMessage('本地模式：配置 Firebase 后可云端同步');
      return;
    }

    setSyncStatus('connecting');
    setSyncMessage('正在连接云端');
    const planRef = doc(db, PLAN_DOC_PATH[0], PLAN_DOC_PATH[1]);
    const unsubscribe = onSnapshot(
      planRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setSyncStatus('dirty');
          setSyncMessage('云端暂无数据，点击保存即可创建共享版本');
          return;
        }

        const remote = snapshot.data();
        const remoteData = remote.data as MemoState | undefined;
        const updatedAt = remote.updatedAt;
        if (updatedAt?.toDate) {
          setLastSavedAt(updatedAt.toDate().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        }

        if (!remoteData) {
          setSyncStatus('synced');
          setSyncMessage('已连接云端');
          return;
        }

        if (isDirtyRef.current || isEditingRef.current) {
          setSyncStatus('remote-pending');
          setSyncMessage('编辑中已暂停接收云端覆盖');
          return;
        }

        applyingRemoteRef.current = true;
        setData({ ...defaultState, ...remoteData });
        setSyncStatus('synced');
        setSyncMessage('已实时同步');
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, PLAN_DOC_PATH.join('/'));
        setSyncStatus('error');
        setSyncMessage('云端连接失败，仍可本地编辑');
      },
    );

    return () => unsubscribe();
  }, []);

  const checklistProgress = useMemo(() => {
    const items = data.checklist.flatMap((group) => group.items);
    const done = items.filter((item) => item.done).length;
    return { done, total: items.length, percent: Math.round((done / Math.max(items.length, 1)) * 100) };
  }, [data.checklist]);

  const resetAll = () => {
    if (!window.confirm('确定要重置为默认内容吗？当前编辑内容会被覆盖。')) return;
    setData(defaultState);
  };

  const saveToCloud = async () => {
    if (!db) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      isDirtyRef.current = false;
      setIsDirty(false);
      setSyncStatus('local');
      setSyncMessage('已保存到本机；配置 Firebase 后可共享');
      return;
    }

    setSyncStatus('saving');
    setSyncMessage('正在保存到云端');
    try {
      await setDoc(
        doc(db, PLAN_DOC_PATH[0], PLAN_DOC_PATH[1]),
        {
          data,
          updatedAt: serverTimestamp(),
          title: '《合奏 Ensemble》流程安排',
          schemaVersion: STORAGE_KEY,
        },
        { merge: true },
      );
      isDirtyRef.current = false;
      setIsDirty(false);
      setSyncStatus('synced');
      setSyncMessage('已保存，其他人会实时更新');
      setIsEditing(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, PLAN_DOC_PATH.join('/'));
      setSyncStatus('error');
      setSyncMessage('保存失败，请检查 Firebase 权限');
    }
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setSyncStatus('copied');
      setSyncMessage('已复制当前链接');
    } catch {
      setSyncStatus(isFirebaseConfigured ? (isDirty ? 'dirty' : 'synced') : 'local');
      setSyncMessage('复制失败，请手动复制浏览器地址');
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ensemble-field-manual.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f8f7ff] text-slate-900">
      <DecorativeBackground />
      <Header
        isEditing={isEditing}
        isDirty={isDirty}
        syncStatus={syncStatus}
        syncMessage={syncMessage}
        lastSavedAt={lastSavedAt}
        onEdit={() => setIsEditing(true)}
        onView={() => setIsEditing(false)}
        onSave={saveToCloud}
        onShare={copyShareLink}
        onReset={resetAll}
        onExport={exportJson}
        onPrint={() => window.print()}
        progress={checklistProgress}
      />
      <main className="relative z-10 mx-auto flex w-full max-w-[1540px] flex-col gap-6 px-4 pb-12 pt-4 sm:px-6 lg:px-8">
        <NavTabs activeTab={activeTab} onChange={setActiveTab} progress={checklistProgress} />
        {activeTab === 'timeline' && (
          <TimelineEditor
            preheat={data.preheat}
            stages={data.stages}
            isEditing={isEditing}
            onPreheatChange={(preheat) => setData((current) => ({ ...current, preheat }))}
            onStageChange={(stages) => setData((current) => ({ ...current, stages }))}
          />
        )}
        {activeTab === 'staff' && (
          <StaffSection
            staff={data.staff}
            isEditing={isEditing}
            onChange={(staff) => setData((current) => ({ ...current, staff }))}
          />
        )}
        {activeTab === 'checklist' && (
          <ChecklistSection
            groups={data.checklist}
            progress={checklistProgress}
            isEditing={isEditing}
            onChange={(checklist) => setData((current) => ({ ...current, checklist }))}
          />
        )}
        {activeTab === 'audience' && (
          <AudienceSchedule
            rows={data.audience}
            isEditing={isEditing}
            onChange={(audience) => setData((current) => ({ ...current, audience }))}
          />
        )}
      </main>
    </div>
  );
}

function DecorativeBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(168,85,247,0.18),transparent_28%),radial-gradient(circle_at_88%_18%,rgba(236,72,153,0.14),transparent_24%),linear-gradient(135deg,#fbfbff_0%,#f4f0ff_48%,#ffffff_100%)]" />
      <div className="absolute inset-0 opacity-[0.22] [background-image:linear-gradient(rgba(79,70,229,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(79,70,229,0.14)_1px,transparent_1px)] [background-size:44px_44px]" />
      <svg className="absolute left-0 top-28 h-36 w-full text-violet-300/35" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 88 C90 36 135 132 226 80 S382 28 486 86 653 131 746 74 906 27 1002 82 1114 121 1200 70" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M0 112 C124 56 162 142 262 96 S425 48 536 100 710 146 824 86 994 52 1092 104 1156 126 1200 96" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function Header({
  isEditing,
  isDirty,
  syncStatus,
  syncMessage,
  lastSavedAt,
  onEdit,
  onView,
  onSave,
  onShare,
  progress,
  onReset,
  onExport,
  onPrint,
}: {
  isEditing: boolean;
  isDirty: boolean;
  syncStatus: SyncStatus;
  syncMessage: string;
  lastSavedAt: string;
  progress: { done: number; total: number; percent: number };
  onEdit: () => void;
  onView: () => void;
  onSave: () => void;
  onShare: () => void;
  onReset: () => void;
  onExport: () => void;
  onPrint: () => void;
}) {
  const cloudConnected = syncStatus !== 'local' && syncStatus !== 'error';
  const SyncIcon = cloudConnected ? Cloud : CloudOff;

  return (
    <header className="relative z-10 border-b border-white/80 bg-white/70 backdrop-blur-xl print:border-b print:bg-white">
      <div className="mx-auto flex max-w-[1540px] flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-950 text-white shadow-lg shadow-blue-950/15">
            <Sparkles className="h-7 w-7" />
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-violet-600">Field Manual / Live Control</p>
            <h1 className="mt-1 text-2xl font-black text-blue-950 sm:text-4xl">《合奏 Ensemble》流程安排</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className={`mr-1 min-w-52 rounded-full border px-3 py-2 ${syncStatus === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : syncStatus === 'dirty' || syncStatus === 'remote-pending' ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-violet-200 bg-white text-slate-600'}`}>
            <div className="flex items-center gap-2 text-xs font-black">
              <SyncIcon className="h-4 w-4" />
              <span>{syncMessage}</span>
            </div>
            {lastSavedAt && <p className="mt-1 font-mono text-[11px] font-bold opacity-70">上次保存 {lastSavedAt}</p>}
          </div>
          <div className="mr-1 min-w-40 rounded-full border border-violet-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
              <span>内容自检</span>
              <span className="font-mono text-blue-950">{progress.done}/{progress.total}</span>
            </div>
            <ProgressBar percent={progress.percent} />
          </div>
          {isEditing ? (
            <>
              <button className="action-btn" onClick={onView}>
                <EyeOff className="h-4 w-4" />
                退出编辑
              </button>
              <button className="action-btn bg-blue-950 text-white hover:bg-blue-900" onClick={onSave}>
                <Save className="h-4 w-4" />
                {isDirty ? '保存' : '已保存'}
              </button>
            </>
          ) : (
            <button className="action-btn bg-blue-950 text-white hover:bg-blue-900" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              修改
            </button>
          )}
          <button className="action-btn" onClick={onShare}>
            <Share2 className="h-4 w-4" />
            共享链接
          </button>
          <button className="action-btn" onClick={onExport}>
            <Download className="h-4 w-4" />
            导出 JSON
          </button>
          <button className="action-btn" onClick={onPrint}>
            <Printer className="h-4 w-4" />
            打印 / PDF
          </button>
          <button className="action-btn text-rose-700" onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
            重置
          </button>
        </div>
      </div>
    </header>
  );
}

function NavTabs({
  activeTab,
  progress,
  onChange,
}: {
  activeTab: TabKey;
  progress: { done: number; total: number; percent: number };
  onChange: (tab: TabKey) => void;
}) {
  const tabs: { key: TabKey; label: string; Icon: typeof Clock; badge?: string }[] = [
    { key: 'timeline', label: '现场时间线', Icon: Clock },
    { key: 'staff', label: '工作人员', Icon: UserRound },
    { key: 'checklist', label: '内容自检', Icon: ClipboardCheck, badge: `${progress.percent}%` },
    { key: 'audience', label: '观众节目单', Icon: ListChecks },
  ];

  return (
    <nav className="sticky top-0 z-20 -mx-4 bg-[#f8f7ff]/80 px-4 py-3 backdrop-blur-xl print:hidden sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-white bg-white/70 p-2 shadow-sm">
        {tabs.map(({ key, label, Icon, badge }) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition ${
              activeTab === key ? 'bg-blue-950 text-white shadow-md shadow-blue-950/15' : 'text-slate-600 hover:bg-violet-50 hover:text-blue-950'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {badge && <span className={`rounded-full px-2 py-0.5 font-mono text-xs ${activeTab === key ? 'bg-white/15' : 'bg-violet-100 text-violet-700'}`}>{badge}</span>}
          </button>
        ))}
      </div>
    </nav>
  );
}

function TimelineEditor({
  preheat,
  stages,
  isEditing,
  onPreheatChange,
  onStageChange,
}: {
  preheat: PreheatItem[];
  stages: Stage[];
  isEditing: boolean;
  onPreheatChange: (items: PreheatItem[]) => void;
  onStageChange: (stages: Stage[]) => void;
}) {
  const [showOwners, setShowOwners] = useState(false);
  const preheatSlots = buildTimeSlots(preheat, PREHEAT_START_SECONDS, getPreheatDurationSeconds);
  const stageSlots = buildTimeSlots(stages, SHOW_START_SECONDS, getStageDurationSeconds);
  const preheatTotalSeconds = preheatSlots.reduce((sum, slot) => sum + slot.durationSeconds, 0);
  const showTotalSeconds = stageSlots.reduce((sum, slot) => sum + slot.durationSeconds, 0);

  const updateStage = (index: number, stage: Stage) => onStageChange(stages.map((item, currentIndex) => (currentIndex === index ? stage : item)));
  const addStage = () => {
    onStageChange([
      ...stages,
      {
        id: createId('stage'),
        number: String(stages.length + 1),
        title: '新增环节',
        duration: '待定',
        tasks: ['新增工作内容'],
        groups: ['all'],
        screen: 'onsite',
        groupScreens: { all: 'onsite' },
        owners: {},
      },
    ]);
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-white bg-white/70 p-4 shadow-lg shadow-blue-950/5 print:hidden">
        <TimelineLegend />
        <div className="flex flex-wrap gap-2">
          <button className={`action-btn ${!showOwners ? 'bg-blue-950 text-white hover:bg-blue-900' : ''}`} onClick={() => setShowOwners(false)}>流程内容</button>
          <button className={`action-btn ${showOwners ? 'bg-blue-950 text-white hover:bg-blue-900' : ''}`} onClick={() => setShowOwners(true)}>负责人名字</button>
          {isEditing && (
            <>
              <button className="action-btn" onClick={() => onPreheatChange([...preheat, { id: createId('preheat'), group: 'all', task: '新增预热事项', duration: '1 min', screen: 'onsite', owner: '' }])}>
                <Plus className="h-4 w-4" />
                加预热
              </button>
              <button className="action-btn" onClick={addStage}>
                <Plus className="h-4 w-4" />
                加环节
              </button>
            </>
          )}
        </div>
      </div>

      <div className="timeline-board overflow-hidden rounded-[28px] border border-violet-200 bg-white/90 shadow-xl shadow-blue-950/5">
        <div className="grid grid-cols-[320px_minmax(0,1fr)] bg-blue-950 text-white">
          <div className="border-r border-white/15 px-5 py-3 text-center">
            <div className="text-xl font-black">入场预热：{formatDuration(preheatTotalSeconds)}</div>
            <div className="mt-1 font-mono text-xs font-bold text-white/75">{formatClockTime(PREHEAT_START_SECONDS)} 开始 · {formatTimeRange(PREHEAT_START_SECONDS, preheatTotalSeconds)}</div>
          </div>
          <div className="px-5 py-3 text-center">
            <div className="text-xl font-black">正式 Show：{formatDuration(showTotalSeconds)}</div>
            <div className="mt-1 font-mono text-xs font-bold text-white/75">{formatClockTime(SHOW_START_SECONDS)} 开始 · {formatTimeRange(SHOW_START_SECONDS, showTotalSeconds)}</div>
          </div>
        </div>
        <div className="timeline-scroll overflow-x-auto p-5">
          <div className="flex min-w-max items-stretch gap-3">
            <PreheatTimeline
              slots={preheatSlots}
              isEditing={isEditing}
              showOwners={showOwners}
              onChange={onPreheatChange}
            />
            <div className="flex items-center px-1 text-3xl font-black text-violet-700">→</div>
            {stageSlots.map((slot, index) => (
              <TimelineStagePanel
                key={slot.item.id}
                stage={slot.item}
                timeRange={slot.range}
                durationSeconds={slot.durationSeconds}
                startSeconds={slot.startSeconds}
                isEditing={isEditing}
                showOwners={showOwners}
                isPartOne={Boolean(slot.item.subStages?.length)}
                onChange={(next) => updateStage(index, next)}
                onDelete={() => onStageChange(stages.filter((_, currentIndex) => currentIndex !== index))}
              />
            ))}
          </div>
          <div className="mt-4 rounded-2xl border border-dashed border-violet-200 bg-violet-50 px-4 py-3 font-mono text-xs font-bold text-violet-700">
            触发条件：完成虚拟展馆第一视角的沉浸体验，走到终点后，自动触发开幕式。
          </div>
        </div>
      </div>
    </section>
  );
}

function TimelineLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm font-black text-blue-950">
      {(['music', 'visual', 'interaction'] as GroupKey[]).map((group) => (
        <span key={group} className="inline-flex items-center gap-2">
          <span className={`h-4 w-4 rounded-full ${groupMeta[group].dot}`} />
          {groupMeta[group].label}
        </span>
      ))}
      <span className="hidden h-8 w-px bg-violet-200 sm:block" />
      <ScreenIcon type="all" />
      <ScreenIcon type="main" />
      <ScreenIcon type="laptop" />
    </div>
  );
}

function PreheatTimeline({
  slots,
  isEditing,
  showOwners,
  onChange,
}: {
  slots: Array<{ item: PreheatItem; startSeconds: number; durationSeconds: number; range: string }>;
  isEditing: boolean;
  showOwners: boolean;
  onChange: (items: PreheatItem[]) => void;
}) {
  const items = slots.map((slot) => slot.item);
  return (
    <aside className="w-[320px] shrink-0 overflow-hidden rounded-2xl border border-violet-300 bg-white shadow-sm">
      <div className="space-y-0 divide-y divide-dashed divide-violet-200 p-4">
        {slots.map((slot, index) => (
          <PreheatTimelineItem
            key={slot.item.id}
            item={slot.item}
            isEditing={isEditing}
            showOwners={showOwners}
            onChange={(next) => onChange(items.map((current, currentIndex) => (currentIndex === index ? next : current)))}
            onDelete={() => onChange(items.filter((_, currentIndex) => currentIndex !== index))}
          />
        ))}
      </div>
    </aside>
  );
}

function PreheatTimelineItem({
  item,
  isEditing,
  showOwners,
  onChange,
  onDelete,
}: {
  item: PreheatItem;
  isEditing: boolean;
  showOwners: boolean;
  onChange: (item: PreheatItem) => void;
  onDelete: () => void;
}) {
  const meta = groupMeta[item.group];
  const Icon = meta.Icon;

  return (
    <article className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${meta.chip}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="space-y-2">
              <select className="field" value={item.group} onChange={(event) => onChange({ ...item, group: event.target.value as GroupKey })}>
                {preheatGroups.map((group) => <option key={group} value={group}>{groupMeta[group].label}</option>)}
              </select>
              {!showOwners ? (
                <>
                  <EditableText value={item.duration} onChange={(duration) => onChange({ ...item, duration })} placeholder="时长，如 2 min / 30 s" compact />
                  <EditableText value={item.task} onChange={(task) => onChange({ ...item, task })} placeholder="工作内容" />
                  <select className="field" value={item.screen ?? 'onsite'} onChange={(event) => onChange({ ...item, screen: event.target.value as ScreenType })}>
                    {Object.entries(screenLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <EditableText value={item.note ?? ''} onChange={(note) => onChange({ ...item, note })} placeholder="备注" compact />
                </>
              ) : (
                <EditableText value={item.owner ?? ''} onChange={(owner) => onChange({ ...item, owner })} placeholder="负责人姓名" />
              )}
              <button className="delete-btn" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
                删除
              </button>
            </div>
          ) : (
            <div>
              <GroupTag group={item.group} />
              {!showOwners ? (
                <>
                  <p className="mt-2 font-black text-slate-900">{item.task}</p>
                  <p className="mt-1 font-mono text-xs font-bold text-violet-700">{item.duration}</p>
                  {item.note && <p className="mt-1 text-sm font-semibold text-slate-500">{item.note}</p>}
                  {item.screen && <div className="mt-2"><ScreenIcon type={item.screen} /></div>}
                </>
              ) : (
                <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 font-semibold text-slate-700">{item.owner || '负责人待填写'}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function TimelineStagePanel({
  stage,
  timeRange,
  durationSeconds,
  startSeconds,
  isEditing,
  showOwners,
  isPartOne,
  onChange,
  onDelete,
}: {
  stage: Stage;
  timeRange: string;
  durationSeconds: number;
  startSeconds: number;
  isEditing: boolean;
  showOwners: boolean;
  isPartOne: boolean;
  onChange: (stage: Stage) => void;
  onDelete: () => void;
}) {
  const subStageSlots = stage.subStages?.length ? buildTimeSlots(stage.subStages, startSeconds, getStageDurationSeconds) : [];

  return (
    <article className={`relative flex min-h-[560px] flex-col rounded-2xl border bg-white shadow-sm ${isPartOne ? 'w-[1080px] border-violet-400 bg-violet-50/30' : 'w-[340px] border-violet-200'}`}>
      <div className="flex items-start justify-center gap-2 px-3 pb-2 pt-5 text-center">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-700 font-mono text-sm font-black text-white">{stage.number}</span>
        <div className="min-w-0">
          {isEditing ? (
            <div className="space-y-2">
              <EditableText value={stage.title} onChange={(title) => onChange({ ...stage, title })} compact />
              {stage.subStages?.length ? (
                <div className="rounded-xl bg-violet-50 px-3 py-2 font-mono text-xs font-black text-violet-700">自动：{formatDuration(durationSeconds)}</div>
              ) : (
                <EditableText value={stage.duration} onChange={(duration) => onChange({ ...stage, duration })} compact />
              )}
            </div>
          ) : (
            <>
              <h3 className="text-base font-black leading-tight text-blue-950">{stage.title}</h3>
              <span className="mt-2 inline-flex rounded-full border border-violet-300 bg-white px-3 py-1 font-mono text-xs font-black text-violet-700">{formatDuration(durationSeconds)}</span>
            </>
          )}
          <div className="mt-2 rounded-full bg-blue-50 px-3 py-1 font-mono text-xs font-black text-blue-800">{timeRange}</div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-3 pb-4">
        {!showOwners ? (
          <>
            {stage.subStages?.length ? (
              <div className="grid flex-1 grid-cols-3 gap-2">
                {subStageSlots.map((slot, index) => (
                  <SubStagePanel
                    key={slot.item.id}
                    stage={slot.item}
                    timeRange={slot.range}
                    isEditing={isEditing}
                    onChange={(next) => onChange({ ...stage, subStages: stage.subStages?.map((item, currentIndex) => (currentIndex === index ? next : item)) })}
                    onDelete={() => onChange({ ...stage, subStages: stage.subStages?.filter((_, currentIndex) => currentIndex !== index) })}
                  />
                ))}
              </div>
            ) : (
              <StageContent stage={stage} isEditing={isEditing} onChange={onChange} />
            )}
          </>
        ) : (
          <OwnerEditor stage={stage} isEditing={isEditing} onChange={onChange} />
        )}

        {!showOwners && stage.subStages?.length && isEditing && (
          <button
            className="mini-add-btn"
            onClick={() => onChange({
              ...stage,
              subStages: [
                ...(stage.subStages ?? []),
                {
                  id: createId('substage'),
                  number: String((stage.subStages?.length ?? 0) + 1),
                  title: '新增子阶段',
                  duration: '待定',
                  tasks: ['新增工作内容'],
                  groups: ['all'],
                  screen: 'onsite',
                  groupScreens: { all: 'onsite' },
                  owners: {},
                },
              ],
            })}
          >
            <Plus className="h-4 w-4" />
            添加子阶段
          </button>
        )}

        <div className="mt-auto flex items-center justify-end gap-2 border-t border-dashed border-violet-100 pt-3">
          {isEditing && (
            <button className="icon-delete" onClick={onDelete} title="删除环节">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function SubStagePanel({
  stage,
  timeRange,
  isEditing,
  onChange,
  onDelete,
}: {
  stage: Stage;
  timeRange: string;
  isEditing: boolean;
  onChange: (stage: Stage) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex min-h-[470px] flex-col rounded-2xl border border-violet-200 bg-white p-3">
      <div className="mb-2 text-center">
        <span className="mx-auto grid h-7 w-7 place-items-center rounded-full bg-violet-700 font-mono text-xs font-black text-white">{stage.number}</span>
        {isEditing ? (
          <div className="mt-2 space-y-2">
            <EditableText value={stage.title} onChange={(title) => onChange({ ...stage, title })} compact />
            <EditableText value={stage.duration} onChange={(duration) => onChange({ ...stage, duration })} compact />
          </div>
        ) : (
          <>
            <h4 className="mt-2 font-black text-blue-950">{stage.title}</h4>
            <span className="mt-1 inline-flex rounded-full border border-violet-300 bg-white px-2 py-1 font-mono text-xs font-black text-violet-700">{stage.duration}</span>
          </>
        )}
        <div className="mt-2 rounded-full bg-blue-50 px-3 py-1 font-mono text-xs font-black text-blue-800">{timeRange}</div>
      </div>
      <StageContent stage={stage} isEditing={isEditing} onChange={onChange} compact />
      <div className="mt-auto flex items-center justify-end gap-2 pt-3">
        {isEditing && (
          <button className="icon-delete" onClick={onDelete} title="删除子阶段">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function StageContent({
  stage,
  isEditing,
  compact = false,
  onChange,
}: {
  stage: Stage;
  isEditing: boolean;
  compact?: boolean;
  onChange: (stage: Stage) => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-3">
      <GroupedTasks
        tasks={stage.tasks}
        defaultScreen={stage.screen}
        groupScreens={stage.groupScreens ?? {}}
        compact={compact}
        isEditing={isEditing}
        onChange={(tasks) => onChange({ ...stage, tasks, groups: getGroupsFromTasks(tasks) })}
        onGroupScreenChange={(group, screen) => onChange({ ...stage, groupScreens: { ...(stage.groupScreens ?? {}), [group]: screen } })}
      />
      {!isEditing && stage.note && <InfoBlock title="备注" text={stage.note} />}
    </div>
  );
}

function GroupedTasks({
  tasks,
  defaultScreen,
  groupScreens,
  compact,
  isEditing,
  onChange,
  onGroupScreenChange,
}: {
  tasks: string[];
  defaultScreen: ScreenType;
  groupScreens: Partial<Record<GroupKey, ScreenType>>;
  compact?: boolean;
  isEditing: boolean;
  onChange: (tasks: string[]) => void;
  onGroupScreenChange: (group: GroupKey, screen: ScreenType) => void;
}) {
  const entries = tasks.map((task, index) => ({ task, index, group: detectTaskGroup(task) }));
  const visibleGroups = timelineGroups.filter((group) => entries.some((entry) => entry.group === group));

  return (
    <div className="flex flex-1 flex-col gap-2">
      {visibleGroups.length === 0 && !isEditing && <p className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-400">暂无任务</p>}
      {visibleGroups.map((group) => {
        const groupEntries = entries.filter((entry) => entry.group === group);
        const Icon = groupMeta[group].Icon;
        const screen = groupScreens[group] ?? defaultScreen;
        return (
          <section key={group} className={`rounded-2xl border ${groupMeta[group].border} ${groupMeta[group].soft} p-3`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-black">
              <div className="flex items-center gap-1.5">
                <Icon className={`h-4 w-4 ${groupMeta[group].text}`} />
                <span className={groupMeta[group].text}>{groupMeta[group].label}</span>
              </div>
              {isEditing ? (
                <select className="field w-40 py-1.5 text-xs" value={screen} onChange={(event) => onGroupScreenChange(group, event.target.value as ScreenType)}>
                  {Object.entries(screenLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              ) : (
                <ScreenIcon type={screen} />
              )}
            </div>
            <div className="space-y-1.5">
              {groupEntries.map(({ task, index }) => (
                <TaskRow
                  key={`task-${index}`}
                  task={task}
                  group={group}
                  compact={compact}
                  isEditing={isEditing}
                  onChange={(text) => onChange(tasks.map((item, currentIndex) => (currentIndex === index ? text : item)))}
                  onDelete={() => onChange(tasks.filter((_, currentIndex) => currentIndex !== index))}
                />
              ))}
            </div>
          </section>
        );
      })}
      {isEditing && (
        <div className="grid grid-cols-2 gap-1">
          {timelineGroups.map((group) => (
            <button key={group} className="mini-add-btn !px-2 !py-1.5" onClick={() => onChange([...tasks, formatTaskForGroup(group, '新增工作内容')])}>
              <Plus className="h-3.5 w-3.5" />
              加{groupMeta[group].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  group,
  compact,
  isEditing,
  onChange,
  onDelete,
}: {
  task: string;
  group: GroupKey;
  compact?: boolean;
  isEditing: boolean;
  onChange: (task: string) => void;
  onDelete: () => void;
}) {
  const Icon = groupMeta[group].Icon;

  if (isEditing) {
    return (
      <div className="grid gap-2 rounded-xl border border-white/80 bg-white/70 p-2">
        <select
          className="field py-2 text-xs"
          value={group}
          onChange={(event) => onChange(formatTaskForGroup(event.target.value as GroupKey, stripTaskGroupPrefix(task)))}
        >
          {timelineGroups.map((item) => <option key={item} value={item}>{groupMeta[item].label}</option>)}
        </select>
        <AutoResizeTextarea
          className="field min-h-11 resize-none overflow-hidden py-2 text-xs leading-relaxed"
          value={stripTaskGroupPrefix(task)}
          onChange={(event) => onChange(formatTaskForGroup(group, event.target.value))}
        />
        <button className="delete-btn justify-center" onClick={onDelete} title="删除内容">
          <Trash2 className="h-4 w-4" />
          删除任务
        </button>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-violet-100 bg-white/80 p-3 ${compact ? 'text-sm' : 'text-[15px]'}`}>
      <div className="flex gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${groupMeta[group].text}`} />
        <span className="whitespace-pre-wrap leading-relaxed text-slate-700">{stripTaskGroupPrefix(task)}</span>
      </div>
    </div>
  );
}

function AutoResizeTextarea({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  className: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.max(44, textarea.scrollHeight)}px`;
  }, [value]);

  return <textarea ref={ref} rows={1} className={className} value={value} onChange={onChange} />;
}

function OwnerEditor({ stage, isEditing, onChange }: { stage: Stage; isEditing: boolean; onChange: (stage: Stage) => void }) {
  const ownerGroups = getGroupsFromTasks(stage.tasks);

  return (
    <div className="space-y-3">
      {ownerGroups.map((group) => (
        <label key={group} className={`block rounded-2xl border ${groupMeta[group].border} ${groupMeta[group].soft} p-3`}>
          <GroupTag group={group} />
          {isEditing ? (
            <input
              className="field mt-2"
              value={stage.owners?.[group] ?? ''}
              placeholder={`${groupMeta[group].label}负责人`}
              onChange={(event) => onChange({ ...stage, owners: { ...(stage.owners ?? {}), [group]: event.target.value } })}
            />
          ) : (
            <p className="mt-2 font-black text-slate-800">{stage.owners?.[group] || '待填写'}</p>
          )}
        </label>
      ))}
      {stage.subStages?.map((subStage, subIndex) => (
        <div key={subStage.id} className="rounded-2xl border border-dashed border-violet-200 bg-white/70 p-3">
          <p className="mb-2 font-black text-blue-950">{subStage.title}</p>
          {getGroupsFromTasks(subStage.tasks).map((group) => (
            <label key={group} className="mb-2 block">
              <span className="label">{groupMeta[group].label}</span>
              {isEditing ? (
                <input
                  className="field"
                  value={subStage.owners?.[group] ?? ''}
                  placeholder="负责人姓名"
                  onChange={(event) => {
                    const nextSub = { ...subStage, owners: { ...(subStage.owners ?? {}), [group]: event.target.value } };
                    onChange({ ...stage, subStages: stage.subStages?.map((item, index) => (index === subIndex ? nextSub : item)) });
                  }}
                />
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-2 font-semibold text-slate-700">{subStage.owners?.[group] || '待填写'}</p>
              )}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

function StaffSection({ staff, isEditing, onChange }: { staff: StaffGroup[]; isEditing: boolean; onChange: (staff: StaffGroup[]) => void }) {
  return (
    <section className="space-y-6">
      <SectionTitle eyebrow="Crew" title="工作人员分工" helper="这里是总分工表；时间线页也可以切换到负责人视图，为每个环节单独填写负责人。" />
      {isEditing && (
        <button
          className="action-btn"
          onClick={() => onChange([...staff, { id: createId('staff'), tone: 'control', title: '新增分组', fields: { 负责人姓名: '' } }])}
        >
          <Plus className="h-4 w-4" />
          添加分组
        </button>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {staff.map((group, index) => (
          <StaffCard
            key={group.id}
            group={group}
            isEditing={isEditing}
            onChange={(next) => onChange(staff.map((item, itemIndex) => (itemIndex === index ? next : item)))}
            onDelete={() => onChange(staff.filter((_, itemIndex) => itemIndex !== index))}
          />
        ))}
      </div>
    </section>
  );
}

function StaffCard({ group, isEditing, onChange, onDelete }: { group: StaffGroup; isEditing: boolean; onChange: (group: StaffGroup) => void; onDelete: () => void }) {
  const meta = groupMeta[group.tone];
  const Icon = meta.Icon;

  return (
    <article className={`rounded-[24px] border ${meta.border} bg-white/85 p-5 shadow-lg shadow-blue-950/5`}>
      <div className="mb-5 flex items-center gap-3">
        <div className={`grid h-11 w-11 place-items-center rounded-2xl ${meta.chip}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          {isEditing ? <EditableText value={group.title} onChange={(title) => onChange({ ...group, title })} compact /> : <h2 className="text-xl font-black text-blue-950">{group.title}</h2>}
        </div>
        {isEditing && (
          <button className="icon-delete" onClick={onDelete} title="删除分组">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {isEditing && (
        <select className="field mb-3" value={group.tone} onChange={(event) => onChange({ ...group, tone: event.target.value as GroupKey })}>
          {timelineGroups.map((tone) => <option key={tone} value={tone}>{groupMeta[tone].label}</option>)}
        </select>
      )}
      <div className="space-y-3">
        {Object.entries(group.fields).map(([label, value]) => (
          <label key={label} className="block">
            {isEditing ? (
              <div className="flex gap-2">
                <input
                  className="field w-32 shrink-0"
                  value={label}
                  onChange={(event) => onChange(renameStaffField(group, label, event.target.value))}
                />
                <input
                  className="field min-w-0 flex-1"
                  value={value}
                  placeholder="填写姓名"
                  onChange={(event) => onChange({ ...group, fields: { ...group.fields, [label]: event.target.value } })}
                />
                <button className="icon-delete shrink-0" onClick={() => onChange(removeStaffField(group, label))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <span className="label">{label}</span>
                <p className="min-h-10 rounded-xl bg-slate-50 px-3 py-2 font-semibold text-slate-700">{value || '待填写'}</p>
              </>
            )}
          </label>
        ))}
      </div>
      {isEditing && (
        <button className="mini-add-btn mt-4" onClick={() => onChange({ ...group, fields: { ...group.fields, 新增岗位: '' } })}>
          <Plus className="h-4 w-4" />
          添加岗位
        </button>
      )}
    </article>
  );
}

function renameStaffField(group: StaffGroup, oldLabel: string, newLabel: string) {
  const fields = Object.entries(group.fields).reduce<Record<string, string>>((next, [label, value]) => {
    next[label === oldLabel ? newLabel : label] = value;
    return next;
  }, {});
  return { ...group, fields };
}

function removeStaffField(group: StaffGroup, labelToRemove: string) {
  const fields = Object.entries(group.fields).reduce<Record<string, string>>((next, [label, value]) => {
    if (label !== labelToRemove) next[label] = value;
    return next;
  }, {});
  return { ...group, fields };
}

function ChecklistSection({
  groups,
  progress,
  isEditing,
  onChange,
}: {
  groups: ChecklistGroup[];
  progress: { done: number; total: number; percent: number };
  isEditing: boolean;
  onChange: (groups: ChecklistGroup[]) => void;
}) {
  return (
    <section className="space-y-6">
      <SectionTitle eyebrow="Content Checklist" title="内容自检表" helper={`暂时只保留内容检查。已完成 ${progress.done} / ${progress.total} 项，进度 ${progress.percent}%。`} />
      <div className="rounded-[28px] border border-violet-200 bg-white/80 p-5 shadow-xl shadow-violet-950/5">
        <div className="mb-5 flex items-center gap-3">
          <ProgressBar percent={progress.percent} large />
          <span className="font-mono text-sm font-black text-blue-950">{progress.percent}%</span>
          {isEditing && (
            <button
              className="action-btn ml-auto"
              onClick={() => onChange([...groups, { id: createId('check-group'), title: '新增检查分组', items: [{ id: createId('check-item'), text: '新增检查项', done: false }] }])}
            >
              <Plus className="h-4 w-4" />
              添加分组
            </button>
          )}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((group, groupIndex) => (
            <div key={group.id} className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="mb-3 flex items-center gap-2">
                {isEditing ? (
                  <EditableText value={group.title} onChange={(title) => onChange(groups.map((item, index) => (index === groupIndex ? { ...item, title } : item)))} />
                ) : (
                  <h2 className="text-lg font-black text-blue-950">{group.title}</h2>
                )}
                {isEditing && (
                  <button className="icon-delete ml-auto" onClick={() => onChange(groups.filter((_, index) => index !== groupIndex))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {group.items.map((item, itemIndex) => (
                  <ChecklistItem
                    key={item.id}
                    item={item}
                    isEditing={isEditing}
                    onToggle={(done) => onChange(updateChecklistItem(groups, groupIndex, itemIndex, { done }))}
                    onTextChange={(text) => onChange(updateChecklistItem(groups, groupIndex, itemIndex, { text }))}
                    onDelete={() => onChange(groups.map((currentGroup, index) => index === groupIndex ? { ...currentGroup, items: currentGroup.items.filter((_, currentIndex) => currentIndex !== itemIndex) } : currentGroup))}
                  />
                ))}
              </div>
              {isEditing && (
                <button className="mini-add-btn mt-3" onClick={() => onChange(groups.map((currentGroup, index) => index === groupIndex ? { ...currentGroup, items: [...currentGroup.items, { id: createId('check-item'), text: '新增检查项', done: false }] } : currentGroup))}>
                  <Plus className="h-4 w-4" />
                  添加检查项
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function updateChecklistItem(groups: ChecklistGroup[], groupIndex: number, itemIndex: number, patch: Partial<{ text: string; done: boolean }>) {
  return groups.map((group, currentGroupIndex) => {
    if (currentGroupIndex !== groupIndex) return group;
    return {
      ...group,
      items: group.items.map((item, currentItemIndex) => (currentItemIndex === itemIndex ? { ...item, ...patch } : item)),
    };
  });
}

function ChecklistItem({
  item,
  isEditing,
  onToggle,
  onTextChange,
  onDelete,
}: {
  item: { text: string; done: boolean };
  isEditing: boolean;
  onToggle: (done: boolean) => void;
  onTextChange: (text: string) => void;
  onDelete: () => void;
}) {
  return (
    <label className={`flex items-center gap-3 rounded-2xl border px-3 py-3 transition ${item.done ? 'border-emerald-200 bg-emerald-50 text-slate-400' : 'border-white bg-white text-slate-700'}`}>
      <input className="h-5 w-5 accent-violet-600" type="checkbox" checked={item.done} disabled={!isEditing} onChange={(event) => onToggle(event.target.checked)} />
      {isEditing ? (
        <>
          <input className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" value={item.text} onChange={(event) => onTextChange(event.target.value)} />
          <button type="button" className="icon-delete shrink-0" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      ) : (
        <span className={`text-sm font-semibold ${item.done ? 'line-through' : ''}`}>{item.text}</span>
      )}
    </label>
  );
}

function AudienceSchedule({ rows, isEditing, onChange }: { rows: AudienceRow[]; isEditing: boolean; onChange: (rows: AudienceRow[]) => void }) {
  return (
    <section className="space-y-6">
      <SectionTitle
        eyebrow="Public Program"
        title="观众节目单"
        helper="面向观众展示，只保留时间与环节。可根据现场节奏增删或修改。"
      />
      {isEditing && (
        <button className="action-btn" onClick={() => onChange([...rows, { id: createId('audience'), time: '新增时间', title: '新增环节' }])}>
          <Plus className="h-4 w-4" />
          添加节目
        </button>
      )}
      <div className="overflow-hidden rounded-[28px] border border-violet-200 bg-white/85 shadow-xl shadow-blue-950/5">
        <div className="grid grid-cols-[1fr_2fr_44px] bg-blue-950 px-4 py-3 text-sm font-black text-white">
          <span>时间</span>
          <span>环节</span>
          <span />
        </div>
        <div className="divide-y divide-violet-100">
          {rows.map((row, index) => (
            <div key={row.id} className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[1fr_2fr_44px] md:items-center">
              {isEditing ? (
                <>
                  <EditableText value={row.time} onChange={(time) => onChange(updateAudienceRow(rows, index, { time }))} compact />
                  <EditableText value={row.title} onChange={(title) => onChange(updateAudienceRow(rows, index, { title }))} compact />
                  <button className="icon-delete" onClick={() => onChange(rows.filter((_, currentIndex) => currentIndex !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="font-mono text-sm font-black text-violet-700">{row.time}</span>
                  <span className="font-black text-blue-950">{row.title}</span>
                  <span />
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function updateAudienceRow(rows: AudienceRow[], index: number, patch: Partial<AudienceRow>) {
  return rows.map((row, currentIndex) => (currentIndex === index ? { ...row, ...patch } : row));
}

function EditableText({ value, onChange, placeholder = '', compact = false }: { value: string; onChange: (value: string) => void; placeholder?: string; compact?: boolean }) {
  return (
    <input
      className={`field ${compact ? 'py-2 text-sm' : ''}`}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function ScreenIcon({ type }: { type: ScreenType }) {
  const Icon = type === 'none' ? MinusCircle : type === 'laptop' ? Laptop : type === 'main' ? Monitor : type === 'main-laptop' ? ScreenShare : Monitor;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black ring-1 ${type === 'none' ? 'bg-slate-50 text-slate-600 ring-slate-200' : 'bg-blue-50 text-blue-800 ring-blue-100'}`}>
      <Icon className="h-3.5 w-3.5" />
      {screenLabels[type]}
    </span>
  );
}

function GroupTag({ group }: { group: GroupKey }) {
  const meta = groupMeta[group];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black ring-1 ${meta.chip}`}>
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

function ProgressBar({ percent, large = false }: { percent: number; large?: boolean }) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-slate-100 ${large ? 'h-4' : 'mt-1.5 h-2'}`}>
      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-pink-500 to-orange-400 transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}

function SectionTitle({ eyebrow, title, helper }: { eyebrow: string; title: string; helper: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-[28px] border border-white bg-white/65 p-5 shadow-lg shadow-blue-950/5 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="font-mono text-xs font-black uppercase tracking-[0.24em] text-violet-600">{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-black text-blue-950">{title}</h2>
      </div>
      <p className="max-w-2xl text-sm font-medium leading-relaxed text-slate-500">{helper}</p>
    </div>
  );
}

function InfoBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p className="mb-1 font-mono text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{title}</p>
      <p className="text-sm leading-relaxed text-slate-600">{text}</p>
    </div>
  );
}

function getGroupsFromTasks(tasks: string[]): GroupKey[] {
  const groups = timelineGroups.filter((group) => tasks.some((task) => detectTaskGroup(task) === group));
  return groups.length ? groups : ['all'];
}

function stripTaskGroupPrefix(task: string) {
  return task
    .replace(/^(音乐组|视觉组|交互组|全员|总控|策划 \/ 总控)[：:]\s*/, '')
    .replace(/^AI\s*旁白[：:]?\s*/, '')
    .trim();
}

function formatTaskForGroup(group: GroupKey, text: string) {
  const body = text.trim() || '新增工作内容';
  const prefixes: Record<GroupKey, string> = {
    music: '音乐组',
    visual: '视觉组',
    interaction: '交互组',
    all: '全员',
    ai: 'AI 旁白',
    control: '总控',
  };
  return `${prefixes[group]}：${body}`;
}

function detectTaskGroup(task: string): GroupKey {
  const normalized = task.trim();
  if (/^(音乐组|Music)[：:]/i.test(normalized) || normalized.includes('DJ') || normalized.includes('VJ')) return 'music';
  if (/^(视觉组|Visual)[：:]/i.test(normalized) || normalized.includes('视觉') || normalized.includes('画面') || normalized.includes('字幕')) return 'visual';
  if (/^(交互组|Interaction)[：:]/i.test(normalized) || normalized.includes('交互') || normalized.includes('签到') || normalized.includes('烟花')) return 'interaction';
  if (/^AI\s*旁白[：:]?/i.test(normalized) || normalized.includes('AI')) return 'ai';
  if (/^(总控|策划 \/ 总控|Control)[：:]/i.test(normalized)) return 'control';
  return 'all';
}

export default App;
