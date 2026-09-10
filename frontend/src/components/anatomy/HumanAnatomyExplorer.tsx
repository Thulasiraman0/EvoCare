import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bone,
  Brain,
  HeartPulse,
  Activity,
  Utensils,
  Wind,
  Droplets,
  Fingerprint,
  Sparkles,
  Send,
  Loader2,
  Info,
  ShieldCheck,
  Maximize2,
  Minimize2,
  RefreshCw,
  Cpu,
} from 'lucide-react';
import { DashboardResponse, AnatomyAudience, AnatomyExplainResponse, AnatomySystem, AnatomyLLMStatus } from '../../types';
import { apiService } from '../../services/api';

/**
 * 3D Human Anatomy Explorer
 * -------------------------
 * Left  : Sketchfab "Animated Full Human Body Anatomy" viewer (real-time bone / muscle / nervous
 *         separation via the Sketchfab Viewer API — falls back to plain embed if the API is blocked).
 * Right : Taxonomy of body systems + MedGemma 1.5 explainer grounded in the active patient's record.
 *
 * Shared by Doctor, Patient and Caregiver pages; `audience` changes the tone of the explanation.
 */

const SKETCHFAB_MODEL_UID = '9b0b079953b840bc9a13f524b60041e4';
const SKETCHFAB_EMBED_URL =
  `https://sketchfab.com/models/${SKETCHFAB_MODEL_UID}/embed` +
  '?autostart=1&ui_infos=0&ui_animations=0&ui_controls=0&ui_stop=0&ui_watermark=0' +
  '&ui_hint=0&ui_help=0&ui_settings=0&ui_inspector=0&ui_vr=0&ui_ar=0&ui_fullscreen=0&transparent=0';

const SYSTEM_ICONS: Record<string, React.ReactNode> = {
  skeletal: <Bone size={16} />,
  muscular: <Activity size={16} />,
  nervous: <Brain size={16} />,
  cardiovascular: <HeartPulse size={16} />,
  digestive: <Utensils size={16} />,
  integumentary: <Fingerprint size={16} />,
  respiratory: <Wind size={16} />,
  urinary: <Droplets size={16} />,
};

const SYSTEM_COLORS: Record<string, string> = {
  skeletal: '#e8e2d2',
  muscular: '#d9665a',
  nervous: '#e6c34b',
  cardiovascular: '#c9403a',
  digestive: '#c98a4a',
  integumentary: '#d6a58c',
  respiratory: '#6fb3d9',
  urinary: '#7cc596',
};

/** Node-name keywords used to isolate a layer in the Sketchfab scene graph (real-time separation). */
const LAYER_MATCHERS: Record<string, string[]> = {
  skeletal: ['skelet', 'bone', 'skull', 'spine', 'rib', 'femur', 'tibia', 'pelvis', 'vertebra', 'cartilage'],
  muscular: ['muscle', 'muscul', 'tendon', 'biceps', 'triceps', 'deltoid', 'pectoral', 'glute', 'quadriceps', 'abdom'],
  nervous: ['nerv', 'brain', 'spinal', 'cord', 'neuro', 'plexus', 'cerebr'],
  cardiovascular: ['heart', 'artery', 'arter', 'vein', 'vascul', 'aorta', 'blood', 'circul'],
  digestive: ['stomach', 'intestin', 'liver', 'digest', 'colon', 'pancrea', 'esophag', 'bowel'],
  integumentary: ['skin', 'body', 'dermis', 'integument', 'epiderm'],
  respiratory: ['lung', 'trachea', 'bronch', 'respir', 'diaphragm'],
  urinary: ['kidney', 'bladder', 'ureter', 'urin', 'renal'],
};

interface SketchfabNode {
  instanceID: number;
  name?: string;
  type?: string;
  children?: SketchfabNode[];
}

interface HumanAnatomyExplorerProps {
  data: DashboardResponse;
  audience: AnatomyAudience;
  compact?: boolean;
  onSelectEvidence?: (code: string) => void;
}

const QUICK_QUESTIONS: Record<AnatomyAudience, string[]> = {
  doctor: [
    'Which structures are relevant to her orthostatic dizziness?',
    'How does knee osteoarthritis affect gait and fall risk here?',
    'Anatomical basis for near-falls vs completed falls in this patient',
  ],
  patient: [
    'Why do I feel dizzy when I stand up?',
    'What does my knee pain have to do with my bones?',
    'How do my medicines affect this part of my body?',
  ],
  caregiver: [
    'What should I watch for related to this system?',
    'Why does she need support when walking?',
    'How can I help protect her joints day to day?',
  ],
};

const renderMarkdownLite = (text: string) => {
  const lines = text.split('\n');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} style={{ height: '6px' }} />;
        const isH = trimmed.startsWith('###');
        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('• ');
        const isItalic = trimmed.startsWith('_') && trimmed.endsWith('_');
        const content = isH ? trimmed.replace(/^#+\s*/, '') : isBullet ? trimmed.slice(2) : isItalic ? trimmed.slice(1, -1) : trimmed;
        const parts = content.split(/(\*\*.*?\*\*)/g);
        const rendered = parts.map((p, j) =>
          p.startsWith('**') && p.endsWith('**') ? (
            <strong key={j} style={{ color: 'var(--color-text-main)' }}>{p.slice(2, -2)}</strong>
          ) : (
            <span key={j}>{p}</span>
          )
        );
        if (isH) {
          return (
            <div key={i} style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-accent-bright)', marginTop: '8px', letterSpacing: '0.01em' }}>
              {rendered}
            </div>
          );
        }
        if (isBullet) {
          return (
            <div key={i} style={{ display: 'flex', gap: '8px', paddingLeft: '4px', fontSize: '13px', lineHeight: 1.55 }}>
              <span style={{ color: 'var(--color-accent)' }}>•</span>
              <span>{rendered}</span>
            </div>
          );
        }
        return (
          <div key={i} style={{ fontSize: isItalic ? '12px' : '13px', lineHeight: 1.55, color: isItalic ? 'var(--color-text-muted)' : 'inherit', fontStyle: isItalic ? 'italic' : 'normal' }}>
            {rendered}
          </div>
        );
      })}
    </div>
  );
};

export const HumanAnatomyExplorer: React.FC<HumanAnatomyExplorerProps> = ({ data, audience, compact = false, onSelectEvidence }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sfApiRef = useRef<any>(null);
  const nodeMapRef = useRef<Record<number, SketchfabNode>>({});

  const [systems, setSystems] = useState<AnatomySystem[]>([]);
  const [selectedSystem, setSelectedSystem] = useState<string>('skeletal');
  const [layerMode, setLayerMode] = useState<'all' | 'isolate'>('all');
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerApiAvailable, setViewerApiAvailable] = useState<boolean | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const [llmStatus, setLlmStatus] = useState<AnatomyLLMStatus | null>(null);
  const [question, setQuestion] = useState('');
  const [structure, setStructure] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnatomyExplainResponse | null>(null);

  const patientCode = data.patient.patient_code;
  const firstName = data.patient.name.split(' ')[0];

  // Load taxonomy + LLM status
  useEffect(() => {
    apiService.getAnatomySystems().then(setSystems).catch(() => setSystems([]));
    apiService.getAnatomyStatus().then(setLlmStatus).catch(() => setLlmStatus(null));
  }, []);

  // Initialise Sketchfab Viewer API for real-time layer separation
  useEffect(() => {
    let cancelled = false;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const init = () => {
      const Sketchfab = (window as any).Sketchfab;
      if (!Sketchfab) {
        setViewerApiAvailable(false);
        return;
      }
      try {
        const client = new Sketchfab('1.12.1', iframe);
        client.init(SKETCHFAB_MODEL_UID, {
          autostart: 1,
          ui_infos: 0, ui_animations: 0, ui_controls: 0, ui_stop: 0, ui_watermark: 0,
          ui_hint: 0, ui_help: 0, ui_settings: 0, ui_inspector: 0, ui_vr: 0, ui_ar: 0, ui_fullscreen: 0,
          success: (api: any) => {
            if (cancelled) return;
            sfApiRef.current = api;
            api.start();
            api.addEventListener('viewerready', () => {
              if (cancelled) return;
              setViewerReady(true);
              setViewerApiAvailable(true);
              api.getNodeMap((err: any, nodes: Record<number, SketchfabNode>) => {
                if (!err && nodes) nodeMapRef.current = nodes;
              });
            });
          },
          error: () => {
            if (!cancelled) setViewerApiAvailable(false);
          },
        });
      } catch {
        setViewerApiAvailable(false);
      }
    };

    if ((window as any).Sketchfab) {
      init();
    } else {
      const script = document.createElement('script');
      script.src = 'https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js';
      script.async = true;
      script.onload = init;
      script.onerror = () => setViewerApiAvailable(false);
      document.head.appendChild(script);
    }
    return () => { cancelled = true; };
  }, []);

  // Apply layer isolation whenever selection / mode changes
  useEffect(() => {
    const api = sfApiRef.current;
    const nodes = nodeMapRef.current;
    if (!viewerReady || !api || !nodes || Object.keys(nodes).length === 0) return;

    const matchers = LAYER_MATCHERS[selectedSystem] || [];
    const isMatch = (n: SketchfabNode) => {
      const name = (n.name || '').toLowerCase();
      return matchers.some((m) => name.includes(m));
    };

    Object.values(nodes).forEach((n) => {
      if (n.type !== 'MatrixTransform' && n.type !== 'Geometry') return;
      if (!n.name) return;
      if (layerMode === 'all') {
        api.show(n.instanceID);
      } else {
        // Isolate: show only matching layers; if nothing matches keep everything visible
        const anyMatch = Object.values(nodes).some(isMatch);
        if (!anyMatch) { api.show(n.instanceID); return; }
        if (isMatch(n)) api.show(n.instanceID); else api.hide(n.instanceID);
      }
    });
  }, [selectedSystem, layerMode, viewerReady]);

  const currentSystem = useMemo(() => systems.find((s) => s.key === selectedSystem), [systems, selectedSystem]);

  const runExplain = async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiService.explainAnatomy(patientCode, {
        system: selectedSystem,
        structure: structure.trim() || undefined,
        question: (q ?? question).trim() || undefined,
        audience,
      });
      setResult(res);
    } catch (e: any) {
      setError(e?.message || 'Explanation failed');
    } finally {
      setLoading(false);
    }
  };

  // Auto-explain when the system changes (cached server-side, so cheap)
  useEffect(() => {
    if (!patientCode) return;
    setResult(null);
    runExplain('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSystem, patientCode, audience]);

  const tierBadge = (tier?: string) => {
    const map: Record<string, { label: string; bg: string; fg: string }> = {
      medgemma: { label: 'MedGemma 1.5', bg: 'var(--color-accent-soft)', fg: 'var(--color-accent-bright)' },
      gemini: { label: 'Gemini Flash', bg: 'var(--color-plum-soft)', fg: 'var(--color-plum)' },
      groq: { label: 'Groq', bg: 'var(--color-warning-soft)', fg: 'var(--color-warning)' },
      offline: { label: 'Offline engine', bg: 'var(--color-surface-alt)', fg: 'var(--color-text-muted)' },
    };
    const t = map[tier || 'offline'] || map.offline;
    return (
      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', backgroundColor: t.bg, color: t.fg, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <Cpu size={10} /> {t.label}
      </span>
    );
  };

  const viewerHeight = fullscreen ? 'calc(100vh - 40px)' : compact ? '420px' : '560px';

  return (
    <div
      style={{
        position: fullscreen ? 'fixed' : 'relative',
        inset: fullscreen ? 0 : undefined,
        zIndex: fullscreen ? 200 : undefined,
        backgroundColor: fullscreen ? 'var(--color-bg)' : 'transparent',
        padding: fullscreen ? '20px' : 0,
        display: 'grid',
        gridTemplateColumns: compact && !fullscreen ? '1fr' : 'minmax(0, 1.25fr) minmax(320px, 1fr)',
        gap: '16px',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* ------------------------------------------------------------ 3D viewer */}
      <div
        style={{
          position: 'relative',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          border: '1px solid var(--color-border)',
          backgroundColor: '#000',
          height: viewerHeight,
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <iframe
          ref={iframeRef}
          title="Animated Full Human Body Anatomy 3D model - Sketchfab"
          id="api-frame"
          src={SKETCHFAB_EMBED_URL}
          allow="autoplay; fullscreen; xr-spatial-tracking"
          allowFullScreen
          style={{
            position: 'absolute',
            top: '-45px',
            left: 0,
            width: '100%',
            height: 'calc(100% + 90px)',
            border: 'none',
            display: 'block',
          }}
        />

        {/* Layer legend / controls overlay */}
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            pointerEvents: 'none',
          }}
        >
          <div style={{ pointerEvents: 'auto', backgroundColor: 'rgba(20,18,15,0.78)', backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: SYSTEM_COLORS[selectedSystem] || '#fff', boxShadow: `0 0 10px ${SYSTEM_COLORS[selectedSystem] || '#fff'}` }} />
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#f2ede2' }}>{currentSystem?.label || 'Human Anatomy'}</span>
          </div>
          <div style={{ pointerEvents: 'auto', display: 'flex', gap: '4px' }}>
            {(['all', 'isolate'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setLayerMode(m)}
                disabled={!viewerReady}
                title={viewerApiAvailable === false ? 'Viewer API unavailable — showing full model' : m === 'isolate' ? 'Hide other layers in real time' : 'Show every layer'}
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '5px 10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.12)',
                  backgroundColor: layerMode === m ? 'var(--color-accent)' : 'rgba(20,18,15,0.78)',
                  color: layerMode === m ? '#fff' : '#cbc2b0',
                  cursor: viewerReady ? 'pointer' : 'not-allowed',
                  opacity: viewerReady ? 1 : 0.6,
                }}
              >
                {m === 'all' ? 'All layers' : 'Isolate layer'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '6px' }}>
          <button
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? 'Exit full screen' : 'Full screen'}
            style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'rgba(20,18,15,0.78)', color: '#f2ede2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>

        <div style={{ position: 'absolute', bottom: '10px', left: '12px', right: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', pointerEvents: 'none' }}>
          <span style={{ fontSize: '10px', color: 'rgba(242,237,226,0.6)' }}>
            {viewerApiAvailable === false ? 'Embedded viewer • drag to rotate, scroll to zoom' : viewerReady ? 'Real-time layer separation active • drag to rotate' : 'Loading 3D model…'}
          </span>
          <span style={{ fontSize: '10px', color: 'rgba(242,237,226,0.45)' }}>Sketchfab • Animated Full Human Body Anatomy</span>
        </div>
      </div>

      {/* ------------------------------------------------------------ Taxonomy + MedGemma explainer */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0, maxHeight: fullscreen ? 'calc(100vh - 40px)' : undefined, overflow: fullscreen ? 'auto' : undefined }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '30px', height: '30px', borderRadius: '8px', backgroundColor: 'var(--color-accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={16} style={{ color: 'var(--color-accent-bright)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '14px' }}>Human Anatomy Taxonomy</div>
              <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                Explained for {audience === 'patient' ? firstName : `${firstName}'s ${audience}`} • {llmStatus?.active_tier || 'connecting…'}
              </div>
            </div>
          </div>
          {llmStatus && !llmStatus.medgemma.configured && (
            <span title="Set MEDGEMMA_BASE_URL in .env to route through MedGemma 1.5" style={{ fontSize: '10px', color: 'var(--color-warning)', border: '1px solid var(--color-warning-border)', backgroundColor: 'var(--color-warning-soft)', borderRadius: '8px', padding: '3px 8px', whiteSpace: 'nowrap' }}>
              MedGemma not connected
            </span>
          )}
        </div>

        {/* System selector */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '6px' }}>
          {(systems.length ? systems : Object.keys(LAYER_MATCHERS).map((k) => ({ key: k, label: k, description: '', evocare_domains: [] }))).map((s) => {
            const active = s.key === selectedSystem;
            return (
              <button
                key={s.key}
                onClick={() => setSelectedSystem(s.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  borderRadius: '10px',
                  border: `1px solid ${active ? 'var(--color-accent-border)' : 'var(--color-border)'}`,
                  backgroundColor: active ? 'var(--color-accent-soft)' : 'var(--color-surface)',
                  color: active ? 'var(--color-accent-bright)' : 'var(--color-text-secondary)',
                  fontWeight: 600,
                  fontSize: '12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ color: SYSTEM_COLORS[s.key] || 'inherit', display: 'flex' }}>{SYSTEM_ICONS[s.key] || <Info size={16} />}</span>
                <span style={{ textTransform: 'capitalize' }}>{s.label.replace(' System', '')}</span>
              </button>
            );
          })}
        </div>

        {currentSystem && (
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
            <span>{currentSystem.description}</span>
            {currentSystem.evocare_domains.map((d) => (
              <span key={d} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '8px', backgroundColor: 'var(--color-surface-alt)', border: '1px solid var(--color-border)' }}>{d}</span>
            ))}
          </div>
        )}

        {/* Ask box */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              value={structure}
              onChange={(e) => setStructure(e.target.value)}
              placeholder="Structure (optional) e.g. left knee, inner ear"
              style={{ flex: '0 0 42%', fontSize: '12px', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-text-main)' }}
            />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !loading) runExplain(); }}
              placeholder={`Ask about the ${currentSystem?.label.toLowerCase() || 'body'}…`}
              style={{ flex: 1, fontSize: '12px', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-text-main)' }}
            />
            <button
              onClick={() => runExplain()}
              disabled={loading}
              style={{ width: '38px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--color-accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: loading ? 'wait' : 'pointer' }}
            >
              {loading ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {QUICK_QUESTIONS[audience].map((q) => (
              <button
                key={q}
                onClick={() => { setQuestion(q); runExplain(q); }}
                style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '10px', border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Result */}
        <div style={{ flex: 1, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '14px', minHeight: '180px', color: 'var(--color-text-secondary)' }}>
          {error && <div style={{ color: 'var(--color-danger)', fontSize: '13px' }}>{error}</div>}
          {!error && loading && !result && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
              <Loader2 size={15} className="spin" /> Grounding {currentSystem?.label.toLowerCase()} in {firstName}'s record…
            </div>
          )}
          {result && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {tierBadge(result.tier)}
                  {result.from_cache && <span style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>cached</span>}
                </div>
                <button onClick={() => runExplain()} title="Regenerate" style={{ border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex' }}>
                  <RefreshCw size={13} />
                </button>
              </div>
              <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s' }}>{renderMarkdownLite(result.explanation)}</div>

              {result.related_evidence.length > 0 && (
                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed var(--color-border)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: '6px' }}>LINKED RECORD ITEMS</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {result.related_evidence.map((ev, i) => (
                      <button
                        key={i}
                        onClick={() => ev.evidence_code && onSelectEvidence?.(ev.evidence_code)}
                        disabled={!ev.evidence_code || !onSelectEvidence}
                        title={ev.label}
                        style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '8px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-text-secondary)', cursor: ev.evidence_code && onSelectEvidence ? 'pointer' : 'default', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent-bright)', marginRight: '4px' }}>{ev.evidence_code || ev.type}</span>
                        {ev.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {result.fallback_notice && (
                <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--color-warning)', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  <Info size={12} style={{ marginTop: '2px', flexShrink: 0 }} /> <span>{result.fallback_notice}</span>
                </div>
              )}
              <div style={{ marginTop: '10px', fontSize: '11px', color: 'var(--color-text-faint)', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                <ShieldCheck size={12} style={{ marginTop: '2px', flexShrink: 0 }} /> <span>{result.disclaimer}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes evocare-spin { to { transform: rotate(360deg); } }
        .spin { animation: evocare-spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
};

export default HumanAnatomyExplorer;
