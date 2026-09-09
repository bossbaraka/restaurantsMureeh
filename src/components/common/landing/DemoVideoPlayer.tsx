import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from 'react';
import {
  BarChart3,
  CheckCircle2,
  ChefHat,
  CreditCard,
  Maximize2,
  Pause,
  Play,
  QrCode,
  RotateCcw,
  ScanLine,
  ShoppingCart,
  UtensilsCrossed,
} from 'lucide-react';
import { MiniQr } from './mockups';

/**
 * Platform explainer "video"
 * ==========================
 * If the deployment provides a real recording through VITE_DEMO_VIDEO_URL it is
 * embedded (YouTube / Vimeo / direct mp4). Otherwise the platform ships with a
 * self-contained, timed walkthrough rendered from real UI shapes — so the
 * landing page always has a working demo and never depends on a third-party
 * asset that can go offline.
 */
const DEMO_VIDEO_URL = (import.meta.env.VITE_DEMO_VIDEO_URL as string | undefined)?.trim() || '';

interface SceneProps {
  /** 0..1 progress through the scene, drives deterministic animation. */
  progress: number;
}

const stageBase =
  'absolute inset-0 flex items-center justify-center gap-4 sm:gap-8 px-4 sm:px-8 animate-saas-pop';

/* ---------------------------------------------------------------- scenes -- */

const ScanScene: FC<SceneProps> = ({ progress }) => (
  <div className={stageBase}>
    <div className="relative shrink-0 rounded-3xl border border-[#004B87] bg-[#04121F] p-3 shadow-[0_20px_60px_-30px_rgba(0,114,188,0.9)]">
      <MiniQr size={92} />
      <span
        className="pointer-events-none absolute inset-x-3 h-[2px] bg-[#38BDF8] shadow-[0_0_12px_2px_rgba(56,189,248,0.8)]"
        style={{ top: `${8 + progress * 84}%` }}
      />
      <ScanLine className="absolute -top-2 -right-2 w-5 h-5 text-[#38BDF8]" />
    </div>
    <div className="text-start space-y-2.5 min-w-0">
      <p className="text-[13px] sm:text-lg font-black text-white leading-tight">
        الزبون يمسح الرمز…
      </p>
      <p className="text-[11px] sm:text-sm text-slate-300 leading-relaxed">
        بدون تطبيق ولا انتظار — القائمة الرقمية تفتح على هاتفه خلال ثانية، مرتبطة
        بطاولته تلقائياً.
      </p>
      <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-[#38BDF8]">
        <QrCode className="w-3.5 h-3.5" /> رمز QR لكل طاولة
      </span>
    </div>
  </div>
);

const MenuScene: FC<SceneProps> = ({ progress }) => {
  const rows = [
    { name: 'منسف الديوان الملكي', price: '₪89', hot: true },
    { name: 'مشاوي مشكلة على الفحم', price: '₪118' },
    { name: 'كنافة نابلسية بالجبن', price: '₪34' },
    { name: 'ليموناضة بالنعناع', price: '₪18' },
  ];
  const visible = Math.ceil(progress * rows.length * 1.25);
  return (
    <div className={stageBase}>
      <div className="w-[190px] sm:w-[230px] rounded-3xl border border-[#004B87] bg-[#04121F] p-3 shadow-[0_20px_60px_-30px_rgba(0,114,188,0.9)]">
        <div className="h-14 rounded-xl bg-gradient-to-l from-[#0072BC] to-[#003865] mb-2.5 flex items-end p-2">
          <span className="text-[9px] font-black text-white">قائمة المطعم</span>
        </div>
        <div className="space-y-1.5">
          {rows.map((row, i) => (
            <div
              key={row.name}
              className="flex items-center justify-between gap-2 rounded-xl bg-[#071B2E] border border-[#0B3C63] px-2 py-1.5 transition-all duration-500"
              style={{
                opacity: i < visible ? 1 : 0,
                transform: i < visible ? 'translateY(0)' : 'translateY(8px)',
              }}
            >
              <span className="text-[9px] font-bold text-slate-200 truncate">{row.name}</span>
              <span className="text-[9px] font-black text-[#38BDF8] shrink-0">{row.price}</span>
            </div>
          ))}
        </div>
        <div className="mt-2.5 rounded-xl bg-[#0072BC] py-1.5 text-center text-[9px] font-black text-white flex items-center justify-center gap-1">
          <ShoppingCart className="w-3 h-3" /> إرسال الطلب
        </div>
      </div>
      <div className="text-start space-y-2.5 min-w-0">
        <p className="text-[13px] sm:text-lg font-black text-white leading-tight">
          قائمة بهوية المطعم… وطلب بضغطة
        </p>
        <p className="text-[11px] sm:text-sm text-slate-300 leading-relaxed">
          مقاسات وإضافات واستبعاد مكونات، مع صورة وسعر لكل طبق — بألوان المطعم نفسه.
        </p>
        <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-[#38BDF8]">
          <UtensilsCrossed className="w-3.5 h-3.5" /> منيو غير تفاعلي للعرض متاح أيضاً
        </span>
      </div>
    </div>
  );
};

const KitchenScene: FC<SceneProps> = ({ progress }) => {
  const stage = progress < 0.45 ? 'استلام' : progress < 0.8 ? 'قيد التحضير' : 'جاهز';
  const color =
    progress < 0.45 ? 'text-amber-300' : progress < 0.8 ? 'text-[#38BDF8]' : 'text-emerald-300';
  return (
    <div className={stageBase}>
      <div className="w-[210px] sm:w-[250px] rounded-2xl border border-[#004B87] bg-[#04121F] p-3 shadow-[0_20px_60px_-30px_rgba(0,114,188,0.9)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] font-black text-slate-200 flex items-center gap-1">
            <ChefHat className="w-3.5 h-3.5 text-[#38BDF8]" /> شاشة المطبخ
          </span>
          <span className={`text-[9px] font-black ${color}`}>{stage}</span>
        </div>
        <div className="rounded-xl bg-[#071B2E] border border-[#0B3C63] p-2 space-y-1.5">
          <div className="text-[9px] font-black text-white">طلب #1042 · طاولة 07</div>
          {['2× منسف الديوان', '1× مشاوي مشكلة', '1× كنافة'].map((line) => (
            <div key={line} className="text-[9px] text-slate-300">
              {line}
            </div>
          ))}
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-[#0B3C63] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-l from-[#38BDF8] to-emerald-400 transition-[width] duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </div>
      <div className="text-start space-y-2.5 min-w-0">
        <p className="text-[13px] sm:text-lg font-black text-white leading-tight">
          المطبخ يستقبل الطلب لحظياً
        </p>
        <p className="text-[11px] sm:text-sm text-slate-300 leading-relaxed">
          بدون ورق ولا نداء — التذكرة تظهر فوراً مع تنبيه صوتي وتتحدث حالتها أمام
          الزبون.
        </p>
        <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-[#38BDF8]">
          <CheckCircle2 className="w-3.5 h-3.5" /> تحديث مباشر عبر WebSocket
        </span>
      </div>
    </div>
  );
};

const PosScene: FC<SceneProps> = ({ progress }) => (
  <div className={stageBase}>
    <div className="w-[190px] sm:w-[220px] rounded-2xl border border-[#004B87] bg-[#04121F] p-3 shadow-[0_20px_60px_-30px_rgba(0,114,188,0.9)]">
      <div className="text-[9px] font-black text-slate-200 mb-2 flex items-center gap-1">
        <CreditCard className="w-3.5 h-3.5 text-[#38BDF8]" /> تصفية الحساب · طاولة 07
      </div>
      <div className="space-y-1 text-[9px] text-slate-300">
        <div className="flex justify-between">
          <span>المجموع</span>
          <span className="font-bold text-slate-100">₪241</span>
        </div>
        <div className="flex justify-between">
          <span>الضريبة 16%</span>
          <span className="font-bold text-slate-100">₪38.5</span>
        </div>
        <div className="flex justify-between border-t border-[#0B3C63] pt-1 text-[10px] font-black text-white">
          <span>الإجمالي</span>
          <span>₪279.5</span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        {['نقدي', 'بطاقة', 'محفظة'].map((m) => (
          <span
            key={m}
            className="rounded-lg bg-[#071B2E] border border-[#0B3C63] py-1 text-center text-[8px] font-bold text-slate-300"
          >
            {m}
          </span>
        ))}
      </div>
      <div
        className="mt-2 rounded-xl py-1.5 text-center text-[9px] font-black transition-all duration-500"
        style={{
          background: progress > 0.7 ? '#059669' : '#0B3C63',
          color: '#fff',
          transform: progress > 0.7 ? 'scale(1)' : 'scale(0.96)',
        }}
      >
        {progress > 0.7 ? '✓ تم الدفع' : 'بانتظار الدفع'}
      </div>
    </div>
    <div className="text-start space-y-2.5 min-w-0">
      <p className="text-[13px] sm:text-lg font-black text-white leading-tight">
        الكاشير يصفّي ويربط كل شيء
      </p>
      <p className="text-[11px] sm:text-sm text-slate-300 leading-relaxed">
        دفع نقدي أو بطاقة أو محفظة، فاتورة مرقمة، وتحرير الطاولة تلقائياً في نفس
        اللحظة.
      </p>
      <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-[#38BDF8]">
        <CreditCard className="w-3.5 h-3.5" /> نقطة بيع متكاملة (POS)
      </span>
    </div>
  </div>
);

const AnalyticsScene: FC<SceneProps> = ({ progress }) => {
  const bars = [42, 68, 55, 88, 74, 96];
  return (
    <div className={stageBase}>
      <div className="w-[210px] sm:w-[250px] rounded-2xl border border-[#004B87] bg-[#04121F] p-3 shadow-[0_20px_60px_-30px_rgba(0,114,188,0.9)]">
        <div className="text-[9px] font-black text-slate-200 mb-2 flex items-center gap-1">
          <BarChart3 className="w-3.5 h-3.5 text-[#38BDF8]" /> مبيعات اليوم
        </div>
        <div className="flex items-end gap-1.5 h-20">
          {bars.map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-md bg-gradient-to-t from-[#003865] to-[#38BDF8] transition-[height] duration-500"
              style={{ height: `${Math.max(6, h * Math.min(1, progress * 1.6 - i * 0.12))}%` }}
            />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {[
            { k: 'الإيراد', v: '₪12,480' },
            { k: 'متوسط الفاتورة', v: '₪184' },
          ].map((kpi) => (
            <div key={kpi.k} className="rounded-lg bg-[#071B2E] border border-[#0B3C63] p-1.5">
              <div className="text-[8px] text-slate-400">{kpi.k}</div>
              <div className="text-[10px] font-black text-white">{kpi.v}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="text-start space-y-2.5 min-w-0">
        <p className="text-[13px] sm:text-lg font-black text-white leading-tight">
          ولوحة المدير تعرف كل شيء
        </p>
        <p className="text-[11px] sm:text-sm text-slate-300 leading-relaxed">
          إيراد لحظي، أعلى الأطباق مبيعاً، أداء الطاولات والورديات — وتصدير تقارير
          بلمسة.
        </p>
        <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-[#38BDF8]">
          <BarChart3 className="w-3.5 h-3.5" /> تحليلات وتقارير CSV
        </span>
      </div>
    </div>
  );
};

/* ---------------------------------------------------------------- player -- */

interface Scene {
  id: string;
  chapter: string;
  caption: string;
  duration: number;
  Stage: FC<SceneProps>;
}

const SCENES: Scene[] = [
  {
    id: 'scan',
    chapter: 'المسح',
    caption: 'الزبون يمسح رمز QR على طاولته فتفتح القائمة الرقمية فوراً.',
    duration: 8,
    Stage: ScanScene,
  },
  {
    id: 'menu',
    chapter: 'الطلب',
    caption: 'يختار أطباقه بمقاساتها وإضافاتها، ويرسل الطلب من هاتفه.',
    duration: 9,
    Stage: MenuScene,
  },
  {
    id: 'kitchen',
    chapter: 'المطبخ',
    caption: 'التذكرة تصل شاشة المطبخ لحظياً وتتحدث حالتها أمام الزبون.',
    duration: 9,
    Stage: KitchenScene,
  },
  {
    id: 'pos',
    chapter: 'الدفع',
    caption: 'الكاشير يصفّي الحساب ويحرر الطاولة في نفس اللحظة.',
    duration: 8,
    Stage: PosScene,
  },
  {
    id: 'analytics',
    chapter: 'الإدارة',
    caption: 'ولوحة المدير تعرض الإيراد والأطباق الأعلى مبيعاً لحظياً.',
    duration: 10,
    Stage: AnalyticsScene,
  },
];

const TOTAL = SCENES.reduce((sum, s) => sum + s.duration, 0);
const TICK_MS = 100;

/** Which scene is on screen at `elapsed`, and how far through it we are. */
function resolveScene(elapsed: number): { index: number; sceneProgress: number } {
  let acc = 0;
  for (let i = 0; i < SCENES.length; i += 1) {
    const scene = SCENES[i]!;
    if (elapsed < acc + scene.duration) {
      return { index: i, sceneProgress: (elapsed - acc) / scene.duration };
    }
    acc += scene.duration;
  }
  return { index: SCENES.length - 1, sceneProgress: 1 };
}

const Stage = memo(({ index, progress }: { index: number; progress: number }) => {
  const Active = SCENES[index]?.Stage ?? ScanScene;
  return <Active progress={progress} />;
});
Stage.displayName = 'DemoStage';

function embedUrl(url: string): { kind: 'iframe' | 'video'; src: string } | null {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0` };
  if (url.includes('vimeo.com/')) {
    const id = url.split('/').pop();
    return { kind: 'iframe', src: `https://player.vimeo.com/video/${id}` };
  }
  return { kind: 'video', src: url };
}

export const DemoVideoPlayer: FC = () => {
  const embed = useMemo(() => embedUrl(DEMO_VIDEO_URL), []);
  const [elapsed, setElapsed] = useState(0);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [rate, setRate] = useState(1);
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  // Only tick while the player is actually on screen.
  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(!!entry?.isIntersecting),
      { threshold: 0.35 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  // Playback is derived, not stored: it follows the viewport, and the only
  // piece of state is the guest's explicit pause — so no effect has to sync it.
  const playing = !embed && !reducedMotion && inView && !pausedByUser;

  useEffect(() => {
    if (!playing || embed) return;
    const id = window.setInterval(() => {
      setElapsed((prev) => {
        const next = prev + (TICK_MS / 1000) * rate;
        return next >= TOTAL ? 0 : next; // loop
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, rate, embed]);

  const { index, sceneProgress } = resolveScene(elapsed);

  const activeScene = SCENES[index]!;

  const seekTo = useCallback((seconds: number) => {
    setElapsed(Math.max(0, Math.min(TOTAL - 0.001, seconds)));
  }, []);

  const togglePlay = useCallback(() => setPausedByUser((p) => !p), []);

  const restart = useCallback(() => {
    setElapsed(0);
    setPausedByUser(false);
  }, []);

  const cycleRate = useCallback(() => setRate((r) => (r === 1 ? 1.5 : r === 1.5 ? 2 : 1)), []);

  const openFullscreen = useCallback(() => {
    const node = frameRef.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void node.requestFullscreen?.();
  }, []);

  const formatTime = (seconds: number) => {
    const total = Math.max(0, Math.floor(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  return (
    <div ref={rootRef} className="relative" dir="rtl">
      <div
        ref={frameRef}
        className="relative overflow-hidden rounded-3xl border border-[#004B87]/70 bg-[#020A14] shadow-[0_40px_120px_-50px_rgba(0,114,188,0.9)]"
      >
        {/* screen */}
        <div className="relative aspect-video w-full">
          <div className="absolute inset-0 saas-grid-bg opacity-40 pointer-events-none" />

          {embed ? (
            embed.kind === 'iframe' ? (
              <iframe
                src={embed.src}
                title="فيديو تعريفي بمنصة مُريح"
                className="absolute inset-0 w-full h-full"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <video
                src={embed.src}
                className="absolute inset-0 w-full h-full object-cover"
                controls
                playsInline
                preload="metadata"
              />
            )
          ) : (
            <>
              {/* active scene */}
              <Stage key={activeScene.id} index={index} progress={sceneProgress} />

              {/* caption bar */}
              <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4 bg-gradient-to-t from-[#020A14] via-[#020A14]/85 to-transparent">
                <p className="text-[11px] sm:text-sm font-bold text-slate-100 text-center leading-relaxed">
                  <span className="text-[#38BDF8] font-black">{activeScene.chapter} · </span>
                  {activeScene.caption}
                </p>
              </div>

              {/* paused veil */}
              {!playing && (
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label="تشغيل الفيديو التعريفي"
                  className="absolute inset-0 grid place-items-center bg-[#020A14]/45 backdrop-blur-[2px] cursor-pointer"
                >
                  <span className="grid place-items-center w-16 h-16 rounded-full bg-[#0072BC] text-white shadow-[0_0_40px_rgba(0,114,188,0.8)]">
                    <Play className="w-7 h-7 fill-current" />
                  </span>
                </button>
              )}
            </>
          )}
        </div>

        {/* controls */}
        {!embed && (
          <div className="border-t border-[#004B87]/60 bg-[#031326] px-3 sm:px-4 py-2.5 space-y-2">
            {/* timeline with chapter segments */}
            <div className="flex items-center gap-1" dir="ltr">
              {SCENES.map((scene, i) => {
                const start = SCENES.slice(0, i).reduce((sum, s) => sum + s.duration, 0);
                const fill =
                  i < index ? 100 : i === index ? Math.round(sceneProgress * 100) : 0;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => seekTo(start)}
                    title={scene.chapter}
                    aria-label={`الانتقال إلى فصل ${scene.chapter}`}
                    className="relative flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden cursor-pointer"
                  >
                    <span
                      className="absolute inset-y-0 left-0 bg-[#38BDF8] transition-[width] duration-100"
                      style={{ width: `${fill}%` }}
                    />
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? 'إيقاف مؤقت' : 'تشغيل'}
                  className="grid place-items-center w-9 h-9 rounded-lg relative before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-w-[44px] before:min-h-[44px] bg-[#0072BC] text-white cursor-pointer hover:brightness-110"
                >
                  {playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                </button>
                <button
                  type="button"
                  onClick={restart}
                  aria-label="إعادة من البداية"
                  className="grid place-items-center w-9 h-9 rounded-lg relative before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-w-[44px] before:min-h-[44px] bg-white/5 border border-white/10 text-slate-300 cursor-pointer hover:text-white"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={cycleRate}
                  aria-label="سرعة التشغيل"
                  className="px-2 h-8 rounded-lg bg-white/5 border border-white/10 text-[11px] font-black text-slate-200 cursor-pointer hover:text-white"
                >
                  {rate}×
                </button>
                <span className="text-[11px] font-bold text-slate-400 font-mono tabular-nums" dir="ltr">
                  {formatTime(elapsed)} / {formatTime(TOTAL)}
                </span>
              </div>

              <button
                type="button"
                onClick={openFullscreen}
                aria-label="ملء الشاشة"
                className="grid place-items-center w-9 h-9 rounded-lg relative before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-w-[44px] before:min-h-[44px] bg-white/5 border border-white/10 text-slate-300 cursor-pointer hover:text-white"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const DEMO_SCENES = SCENES;
export const DEMO_TOTAL_SECONDS = TOTAL;
