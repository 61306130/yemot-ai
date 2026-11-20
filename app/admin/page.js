'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

/* ============================ עיצוב ============================ */
const CSS = `
:root{
  --bg:#070a16; --panel:rgba(255,255,255,.045); --panel2:rgba(255,255,255,.07);
  --line:rgba(255,255,255,.09); --line2:rgba(255,255,255,.14);
  --txt:#eef1fb; --muted:#9aa0bd; --muted2:#6b7194;
  --a1:#7c5cff; --a2:#19d3ff; --a3:#ff5c9d; --ok:#2ee6a8; --warn:#ffd166; --bad:#ff5c6c;
  --grad:linear-gradient(135deg,var(--a1),var(--a2));
  --radius:22px; --shadow:0 20px 60px rgba(0,0,0,.45);
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0}
body{font-family:'Heebo',system-ui,sans-serif;background:var(--bg);color:var(--txt);
  min-height:100vh;overflow-x:hidden;-webkit-font-smoothing:antialiased}
button{font-family:inherit;cursor:pointer}
input,textarea,select{font-family:inherit}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:10px}
::selection{background:rgba(124,92,255,.4)}

/* רקע אורורה חי */
.aurora{position:fixed;inset:0;z-index:-2;overflow:hidden;background:
  radial-gradient(1200px 800px at 85% -10%,rgba(124,92,255,.18),transparent 60%),
  radial-gradient(1000px 700px at 0% 100%,rgba(25,211,255,.14),transparent 55%),
  var(--bg)}
.orb{position:fixed;border-radius:50%;filter:blur(70px);opacity:.5;z-index:-1;animation:float 22s ease-in-out infinite}
.orb.o1{width:420px;height:420px;background:radial-gradient(circle,#7c5cff,transparent 70%);top:-80px;right:-60px}
.orb.o2{width:380px;height:380px;background:radial-gradient(circle,#19d3ff,transparent 70%);bottom:-120px;left:-80px;animation-delay:-7s}
.orb.o3{width:300px;height:300px;background:radial-gradient(circle,#ff5c9d,transparent 70%);top:40%;left:55%;animation-delay:-13s;opacity:.3}
@keyframes float{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(-40px,30px) scale(1.08)}66%{transform:translate(30px,-25px) scale(.95)}}

/* כניסה */
.login-wrap{min-height:100vh;display:grid;place-items:center;padding:24px}
.login{width:100%;max-width:420px;padding:38px 30px;animation:rise .7s cubic-bezier(.2,.8,.2,1)}
.login .logo{width:72px;height:72px;border-radius:22px;background:var(--grad);display:grid;place-items:center;
  margin:0 auto 20px;box-shadow:0 12px 40px rgba(124,92,255,.5);animation:pulse 3s ease-in-out infinite}
.login h1{text-align:center;margin:0 0 6px;font-weight:800;font-size:26px;letter-spacing:-.5px}
.login p{text-align:center;color:var(--muted);margin:0 0 26px;font-size:14px}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}

/* זכוכית */
.glass{background:var(--panel);backdrop-filter:blur(26px) saturate(140%);-webkit-backdrop-filter:blur(26px) saturate(140%);
  border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}

/* פריסה */
.shell{display:grid;grid-template-columns:260px 1fr;min-height:100vh;gap:18px;padding:18px}
.side{position:sticky;top:18px;height:calc(100vh - 36px);padding:22px 16px;display:flex;flex-direction:column;gap:6px;animation:rise .6s both}
.brand{display:flex;align-items:center;gap:12px;padding:6px 10px 20px}
.brand .mark{width:42px;height:42px;border-radius:13px;background:var(--grad);display:grid;place-items:center;flex:0 0 auto;box-shadow:0 8px 24px rgba(124,92,255,.45)}
.brand b{font-size:18px;font-weight:800;letter-spacing:-.3px;display:block;line-height:1.1}
.brand span{font-size:11.5px;color:var(--muted)}
.nav{display:flex;flex-direction:column;gap:3px;overflow-y:auto;flex:1;margin:0 -4px;padding:0 4px}
.nav button{display:flex;align-items:center;gap:12px;width:100%;padding:11px 13px;border:none;border-radius:13px;
  background:transparent;color:var(--muted);font-size:14.5px;font-weight:500;text-align:right;transition:.18s;position:relative}
.nav button:hover{background:var(--panel2);color:var(--txt)}
.nav button.on{background:var(--panel2);color:var(--txt)}
.nav button.on::before{content:'';position:absolute;right:-4px;top:50%;transform:translateY(-50%);width:3.5px;height:22px;border-radius:4px;background:var(--grad)}
.nav button .ic{width:20px;height:20px;flex:0 0 auto;opacity:.9}
.nav .badge{margin-inline-start:auto;background:var(--a3);color:#fff;font-size:11px;font-weight:700;padding:1px 7px;border-radius:9px}
.side .foot{padding:12px 10px 2px;border-top:1px solid var(--line);margin-top:6px}
.side .foot button{width:100%;padding:10px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--muted);font-size:13px;transition:.18s}
.side .foot button:hover{color:var(--bad);border-color:rgba(255,92,108,.4)}

.main{padding:8px 10px 40px;min-width:0;animation:fade .5s both}
@keyframes fade{from{opacity:0}to{opacity:1}}
.head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:6px 4px 22px;flex-wrap:wrap}
.head h2{margin:0;font-size:27px;font-weight:800;letter-spacing:-.6px}
.head .sub{color:var(--muted);font-size:13.5px;margin-top:2px}
.live{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted);background:var(--panel);
  border:1px solid var(--line);padding:7px 13px;border-radius:30px}
.live .dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 rgba(46,230,168,.6);animation:ping 2s infinite}
@keyframes ping{0%{box-shadow:0 0 0 0 rgba(46,230,168,.5)}70%{box-shadow:0 0 0 9px rgba(46,230,168,0)}100%{box-shadow:0 0 0 0 rgba(46,230,168,0)}}

/* כרטיסים וסטטים */
.grid{display:grid;gap:16px}
.grid.cols{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.grid.cols.wide{grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)}
html,body{overflow-x:hidden}
.stats{grid-template-columns:repeat(auto-fit,minmax(165px,1fr))}
.stat{padding:20px;border-radius:var(--radius);position:relative;overflow:hidden;transition:.25s;animation:rise .5s both}
.stat:hover{transform:translateY(-4px)}
.stat .ic{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;margin-bottom:14px;background:var(--panel2)}
.stat .v{font-size:32px;font-weight:800;letter-spacing:-1px;line-height:1}
.stat .l{color:var(--muted);font-size:13px;margin-top:6px}
.stat .spark{position:absolute;left:0;bottom:0;height:3px;background:var(--grad);opacity:.8}

.card{padding:22px;border-radius:var(--radius);animation:rise .5s both}
.card h3{margin:0 0 4px;font-size:17px;font-weight:700}
.card .ch{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.card .ch p{margin:2px 0 0;color:var(--muted);font-size:13px}

/* תרשים עמודות */
.bars{display:flex;align-items:flex-end;gap:7px;height:140px;padding-top:10px}
.bars .b{flex:1;background:var(--grad);border-radius:7px 7px 3px 3px;min-height:4px;position:relative;transition:.6s cubic-bezier(.2,.8,.2,1);opacity:.85}
.bars .b:hover{opacity:1;filter:brightness(1.15)}
.bars .b .t{position:absolute;top:-22px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--muted);opacity:0;transition:.2s;white-space:nowrap}
.bars .b:hover .t{opacity:1}
.bars .b .d{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:10px;color:var(--muted2);white-space:nowrap}

/* טבלאות ורשימות */
.rows{display:flex;flex-direction:column;gap:2px}
.row{display:flex;align-items:center;gap:14px;padding:13px 14px;border-radius:14px;transition:.15s;background:transparent}
.row:hover{background:var(--panel2)}
.row .av{width:38px;height:38px;border-radius:12px;background:var(--grad);display:grid;place-items:center;font-weight:700;flex:0 0 auto;font-size:14px;color:#fff}
.row .nm{font-weight:600;font-size:14.5px}
.row .mt{color:var(--muted);font-size:12.5px;margin-top:1px}
.row .end{margin-inline-start:auto;text-align:left;color:var(--muted);font-size:12.5px;white-space:nowrap}
.tag{font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:20px;background:var(--panel2);color:var(--muted)}
.tag.ok{background:rgba(46,230,168,.14);color:var(--ok)}
.tag.bad{background:rgba(255,92,108,.14);color:var(--bad)}
.tag.warn{background:rgba(255,209,102,.14);color:var(--warn)}

/* פקדים */
.btn{border:none;border-radius:13px;padding:11px 18px;font-size:14px;font-weight:600;background:var(--grad);color:#fff;transition:.2s;box-shadow:0 8px 24px rgba(124,92,255,.32)}
.btn:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(124,92,255,.45)}
.btn:active{transform:translateY(0)}
.btn:disabled{opacity:.5;cursor:default;transform:none;box-shadow:none}
.btn.ghost{background:var(--panel2);color:var(--txt);box-shadow:none;border:1px solid var(--line)}
.btn.ghost:hover{background:var(--panel);border-color:var(--line2)}
.btn.sm{padding:8px 14px;font-size:13px}
.btn.danger{background:linear-gradient(135deg,#ff5c6c,#ff2d55);box-shadow:0 8px 24px rgba(255,45,85,.3)}
label.fld{display:block;margin-bottom:16px}
label.fld .lb{font-size:13px;color:var(--muted);margin-bottom:7px;display:block;font-weight:500}
.inp,textarea.inp,select.inp{width:100%;padding:12px 14px;border-radius:13px;border:1px solid var(--line);
  background:rgba(0,0,0,.2);color:var(--txt);font-size:14.5px;transition:.18s;outline:none}
.inp:focus,textarea.inp:focus,select.inp:focus{border-color:var(--a1);background:rgba(0,0,0,.3);box-shadow:0 0 0 4px rgba(124,92,255,.14)}
textarea.inp{resize:vertical;min-height:90px;line-height:1.6}
.sw{position:relative;width:50px;height:28px;border-radius:30px;background:rgba(255,255,255,.12);transition:.25s;flex:0 0 auto;border:none}
.sw.on{background:var(--grad)}
.sw::after{content:'';position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:.25s;box-shadow:0 2px 6px rgba(0,0,0,.3)}
.sw.on::after{right:25px}
.swrow{display:flex;align-items:center;gap:14px;padding:14px;border-radius:14px;background:var(--panel2);margin-bottom:12px}
.swrow .tx{flex:1}
.swrow .tx b{font-size:14.5px;font-weight:600;display:block}
.swrow .tx span{font-size:12.5px;color:var(--muted)}

/* בועות שיחה */
.bub{max-width:78%;padding:11px 15px;border-radius:17px;font-size:14px;line-height:1.55;margin-bottom:9px;animation:rise .35s both}
.bub.u{background:var(--panel2);border-top-right-radius:5px;margin-inline-start:auto}
.bub.a{background:var(--grad);color:#fff;border-top-left-radius:5px;margin-inline-end:auto}
.bub .who{font-size:11px;opacity:.7;margin-bottom:3px;font-weight:600}

/* הצבעה */
.cand{display:flex;align-items:center;gap:12px;padding:10px;border-radius:13px;background:var(--panel2);margin-bottom:8px}
.cand .num{width:30px;height:30px;border-radius:9px;background:rgba(255,255,255,.08);display:grid;place-items:center;font-weight:700;font-size:13px;flex:0 0 auto}
.resbar{height:34px;border-radius:10px;background:var(--grad);display:flex;align-items:center;padding:0 12px;color:#fff;font-weight:600;font-size:13px;min-width:44px;transition:.8s cubic-bezier(.2,.8,.2,1);box-shadow:0 4px 14px rgba(124,92,255,.3)}
.resrow{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.resrow .rn{width:120px;font-size:13.5px;font-weight:600;flex:0 0 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.resrow .rt{min-width:0;flex:1}
.crown{filter:drop-shadow(0 0 6px rgba(255,209,102,.7))}

/* הודעות */
.toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);padding:13px 22px;border-radius:14px;
  font-size:14px;font-weight:600;z-index:99;animation:rise .4s both;box-shadow:var(--shadow);border:1px solid var(--line)}
.toast.ok{background:rgba(46,230,168,.15);color:var(--ok);border-color:rgba(46,230,168,.3)}
.toast.err{background:rgba(255,92,108,.15);color:var(--bad);border-color:rgba(255,92,108,.3)}
.empty{text-align:center;padding:50px 20px;color:var(--muted2)}
.empty .big{font-size:40px;margin-bottom:10px;opacity:.5}
.spin{width:18px;height:18px;border:2.5px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite;display:inline-block;vertical-align:middle}
@keyframes sp{to{transform:rotate(360deg)}}
.loading{display:grid;place-items:center;padding:60px;color:var(--muted)}

@media(max-width:860px){
  .shell{grid-template-columns:1fr;padding:12px;gap:12px}
  .side{position:fixed;top:12px;bottom:12px;right:12px;left:auto;z-index:50;width:260px;height:auto;max-height:calc(100vh - 24px);transform:translateX(calc(100% + 30px));transition:transform .35s cubic-bezier(.2,.8,.2,1);animation:none}
  .side.open{transform:none}
  .menu-btn{display:grid!important}
  .head h2{font-size:22px}
  .grid.cols,.grid.cols.wide{grid-template-columns:minmax(0,1fr)}
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
}
.menu-btn{display:none;width:44px;height:44px;border-radius:13px;place-items:center;background:var(--panel);border:1px solid var(--line);color:var(--txt)}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:40;backdrop-filter:blur(2px)}
`;

/* ============================ אייקונים ============================ */
const I = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  phone: 'M4 4h5l2 5-3 2a14 14 0 006 6l2-3 5 2v5a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z',
  users: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM3 21a7 7 0 0118 0',
  bot: 'M12 2v3M7 8h10a2 2 0 012 2v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7a2 2 0 012-2zM9 13v2M15 13v2',
  menu: 'M4 6h16M4 12h16M4 18h16',
  news: 'M4 5h16v14H4zM8 9h8M8 13h8M8 17h5',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h7a3 3 0 003-3V9',
  vote: 'M9 11l3 3 8-8M4 12v7a1 1 0 001 1h14',
  pulse: 'M3 12h4l3 8 4-16 3 8h4',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
};
const Icon = ({ d, s = 20 }) => (
  <svg className="ic" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/* ============================ בסיס API ============================ */
const KEY = 'yemot_admin_key';
function useApi() {
  const keyRef = useRef(typeof window !== 'undefined' ? sessionStorage.getItem(KEY) || '' : '');
  return useCallback(async (path, opts = {}) => {
    const [pp, qs] = path.split('?');
      const r = await fetch(`/api/admin?p=${encodeURIComponent(pp)}${qs ? '&' + qs : ''}`, {
      method: opts.method || 'GET',
      headers: { 'x-admin-key': keyRef.current, 'content-type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `שגיאה ${r.status}`);
    return data;
  }, []);
}

/* ============================ קומפוננטה ראשית ============================ */
export default function Admin() {
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setAuthed(!!sessionStorage.getItem(KEY));
    setReady(true);
  }, []);
  if (!ready) return <><style>{CSS}</style><div className="aurora" /></>;
  return (
    <>
      <style>{CSS}</style>
      <div className="aurora" />
      <div className="orb o1" /><div className="orb o2" /><div className="orb o3" />
      {authed ? <Dash onLogout={() => { sessionStorage.removeItem(KEY); setAuthed(false); }} />
        : <Login onIn={() => setAuthed(true)} />}
    </>
  );
}

/* ---------------- כניסה ---------------- */
function Login({ onIn }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/admin?p=login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) { sessionStorage.setItem(KEY, pw); onIn(); }
      else setErr(d.error || 'סיסמה שגויה');
    } catch { setErr('תקלת תקשורת'); }
    setBusy(false);
  };
  return (
    <div className="login-wrap">
      <form className="login glass" onSubmit={submit}>
        <div className="logo">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d={I.phone} />
          </svg>
        </div>
        <h1>מרכז הניהול</h1>
        <p>קו פתוח — מערכת הטלפוניה החכמה</p>
        <label className="fld">
          <span className="lb">סיסמת ניהול</span>
          <input className="inp" type="password" value={pw} autoFocus
            onChange={(e) => setPw(e.target.value)} placeholder="••••••••" />
        </label>
        {err && <div style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 14, textAlign: 'center' }}>{err}</div>}
        <button className="btn" style={{ width: '100%' }} disabled={busy || !pw}>
          {busy ? <span className="spin" /> : 'כניסה'}
        </button>
      </form>
    </div>
  );
}

/* ---------------- לוח ---------------- */
const TABS = [
  ['overview', 'סקירה', I.grid],
  ['calls', 'שיחות', I.phone],
  ['callers', 'מתקשרים', I.users],
  ['bot', 'הגדרות הבוט', I.bot],
  ['menu', 'תפריט ראשי', I.menu],
  ['news', 'חדשות', I.news],
  ['podcast', 'פודקאסט', I.mic],
  ['transit', 'תחבורה', I.route],
  ['voting', 'הצבעה', I.vote],
  ['system', 'מערכת', I.pulse],
];

function Dash({ onLogout }) {
  const [tab, setTab] = useState('overview');
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [errCount, setErrCount] = useState(0);
  const api = useApi();
  const notify = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => {
    api('overview').then((d) => setErrCount(d?.totals?.errors24h || 0)).catch(() => {});
  }, [api]);

  const Section = { overview: Overview, calls: Calls, callers: Callers, bot: BotSettings,
    menu: MenuTab, news: NewsTab, podcast: Podcast, transit: Transit, voting: Voting, system: System }[tab];

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`side glass ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="mark">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={I.phone} /></svg>
          </div>
          <div><b>קו פתוח</b><span>מרכז ניהול</span></div>
        </div>
        <nav className="nav">
          {TABS.map(([id, label, d]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setOpen(false); }}>
              <Icon d={d} />{label}
              {id === 'system' && errCount > 0 && <span className="badge">{errCount}</span>}
            </button>
          ))}
        </nav>
        <div className="foot">
          <button onClick={onLogout}><Icon d={I.logout} s={16} /> יציאה</button>
        </div>
      </aside>
      <main className="main">
        <button className="menu-btn" onClick={() => setOpen(true)} style={{ marginBottom: 14 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={I.menu} /></svg>
        </button>
        <Section api={api} notify={notify} />
      </main>
      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

/* ============================ כלים משותפים ============================ */
function Head({ title, sub, right }) {
  return (
    <div className="head">
      <div><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
      {right}
    </div>
  );
}
function Loading() { return <div className="loading"><span className="spin" /></div>; }
function Empty({ icon = '∅', text }) { return <div className="empty"><div className="big">{icon}</div>{text}</div>; }
const initials = (s) => (s || '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '•';
const timeAgo = (d) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'עכשיו';
  if (s < 3600) return `לפני ${Math.floor(s / 60)} דק'`;
  if (s < 86400) return `לפני ${Math.floor(s / 3600)} שע'`;
  const n = Math.floor(s / 86400);
  return n === 1 ? 'אתמול' : n === 2 ? 'שלשום' : `לפני ${n} ימים`;
};
const fmtPhone = (p) => (p || '').startsWith('hidden') ? 'מספר חסוי' : p;
const who = (c) => c.name || fmtPhone(c.phone);
const whoSub = (c) => (c.name ? fmtPhone(c.phone) : 'ללא שם');
function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const reload = useCallback(() => {
    setErr('');
    fn().then(setData).catch((e) => setErr(e.message));
  }, deps); // eslint-disable-line
  useEffect(() => { reload(); }, [reload]);
  return [data, reload, err];
}

/* ============================ סקירה ============================ */
function Overview({ api }) {
  const [d, reload, err] = useLoad(() => api('overview'), [api]);
  if (err) return <><Head title="סקירה" /><div className="card glass"><Empty text={err} /></div></>;
  if (!d) return <><Head title="סקירה" /><Loading /></>;
  if (!d.ok) return <><Head title="סקירה" /><div className="card glass"><Empty icon="🗄️" text="מסד הנתונים לא מחובר עדיין" /></div></>;
  const t = d.totals;
  const max = Math.max(1, ...d.byDay.map((x) => x.c));
  const tiles = [
    ['שיחות היום', t.today, I.phone, 'var(--a1)'],
    ['סך שיחות', t.calls, I.pulse, 'var(--a2)'],
    ['מתקשרים', t.callers, I.users, 'var(--ok)'],
    ['חסומים', t.blocked, I.users, 'var(--bad)'],
    ['הודעות', t.messages, I.bot, 'var(--a3)'],
    ['שגיאות 24ש׳', t.errors24h, I.pulse, t.errors24h ? 'var(--warn)' : 'var(--muted)'],
  ];
  return (
    <>
      <Head title="סקירה כללית" sub="תמונת מצב של המערכת" right={<span className="live"><span className="dot" /> המערכת פעילה</span>} />
      <div className="grid stats" style={{ marginBottom: 16 }}>
        {tiles.map(([l, v, ic, c], i) => (
          <div className="stat glass" key={l} style={{ animationDelay: `${i * 60}ms` }}>
            <div className="ic" style={{ color: c }}><Icon d={ic} /></div>
            <div className="v">{v ?? 0}</div><div className="l">{l}</div>
            <div className="spark" style={{ width: `${30 + (i * 11) % 60}%` }} />
          </div>
        ))}
      </div>
      <div className="grid cols wide">
        <div className="card glass">
          <div className="ch"><div><h3>שיחות ב-14 הימים האחרונים</h3></div></div>
          {d.byDay.length ? (
            <div className="bars">
              {d.byDay.map((x) => (
                <div className="b" key={x.day} style={{ height: `${(x.c / max) * 100}%` }}>
                  <span className="t">{x.c} שיחות</span>
                  <span className="d">{x.day.slice(8)}/{x.day.slice(5, 7)}</span>
                </div>
              ))}
            </div>
          ) : <Empty text="אין נתונים עדיין" />}
        </div>
        <div className="card glass">
          <div className="ch"><h3>המתקשרים המובילים</h3></div>
          {d.topCallers.length ? (
            <div className="rows">
              {d.topCallers.map((c, i) => (
                <div className="row" key={c.phone}>
                  <div className="av">{i === 0 ? '👑' : initials(c.name) }</div>
                  <div><div className="nm">{who(c)}</div><div className="mt">{whoSub(c)}</div></div>
                  <div className="end">{c.calls_count} שיחות</div>
                </div>
              ))}
            </div>
          ) : <Empty text="אין עדיין" />}
        </div>
      </div>
    </>
  );
}

/* ============================ שיחות ============================ */
function Calls({ api }) {
  const [d, reload, err] = useLoad(() => api('calls'), [api]);
  const [open, setOpen] = useState(null);
  const [msgs, setMsgs] = useState(null);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(20);
  const list = (d?.calls || []).filter((c) => !q || `${c.name} ${c.phone}`.includes(q.trim()));
  const expand = async (id) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setMsgs(null);
    try { const r = await api(`calls?id=${encodeURIComponent(id)}`); setMsgs(r.messages); } catch { setMsgs([]); }
  };
  return (
    <>
      <Head title="שיחות" sub="תמלול מלא של כל שיחה" right={<button className="btn ghost sm" onClick={reload}>רענון</button>} />
      <div className="card glass">
        {d?.calls?.length > 0 && (
          <input className="inp" style={{ marginBottom: 14 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם או מספר טלפון" />
        )}
        {err ? <Empty text={err} /> : !d ? <Loading /> : !list.length ? <Empty icon="📞" text={q ? 'לא נמצאו שיחות' : 'אין שיחות עדיין'} /> : (
          <div className="rows">
            {list.slice(0, limit).map((c) => (
              <div key={c.id}>
                <div className="row" style={{ cursor: 'pointer' }} onClick={() => expand(c.id)}>
                  <div className="av">{initials(c.name) || '📞'}</div>
                  <div>
                    <div className="nm">{who(c)}</div>
                    <div className="mt">{whoSub(c)} · {c.turns} הודעות</div>
                  </div>
                  <div className="end">{timeAgo(c.started_at)}<br />{new Date(c.started_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                {open === c.id && (
                  <div style={{ padding: '10px 14px 16px' }}>
                    {!msgs ? <Loading /> : !msgs.length ? <Empty text="אין תמלול" /> :
                      msgs.map((m, i) => (
                        <div className={`bub ${m.role === 'user' ? 'u' : 'a'}`} key={i}>
                          <div className="who">{m.role === 'user' ? 'מתקשר' : 'בוט'}</div>{m.text}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
            {list.length > limit && (
              <button className="btn ghost sm" style={{ margin: '12px auto 0' }} onClick={() => setLimit((x) => x + 20)}>
                הצג עוד ({list.length - limit})
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ============================ מתקשרים ============================ */
function Callers({ api, notify }) {
  const [d, reload, err] = useLoad(() => api('callers'), [api]);
  const save = async (phone, fields) => {
    try { await api('callers', { method: 'POST', body: { phone, ...fields } }); notify('נשמר'); reload(); }
    catch (e) { notify(e.message, 'err'); }
  };
  return (
    <>
      <Head title="מתקשרים" sub="שמות, חסימות והערות" right={<button className="btn ghost sm" onClick={reload}>רענון</button>} />
      <div className="card glass">
        {err ? <Empty text={err} /> : !d ? <Loading /> : !d.callers.length ? <Empty icon="👤" text="אין מתקשרים" /> : (
          <div className="rows">
            {d.callers.map((c) => <CallerRow key={c.phone} c={c} onSave={save} />)}
          </div>
        )}
      </div>
    </>
  );
}
function CallerRow({ c, onSave }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(c.name);
  const [notes, setNotes] = useState(c.notes);
  return (
    <div className="row" style={{ alignItems: edit ? 'flex-start' : 'center', flexWrap: 'wrap' }}>
      <div className="av">{initials(c.name) || '👤'}</div>
      {edit ? (
        <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="שם" />
          <input className="inp" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערה" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn sm" onClick={() => { onSave(c.phone, { name, notes }); setEdit(false); }}>שמור</button>
            <button className="btn ghost sm" onClick={() => setEdit(false)}>ביטול</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ minWidth: 0 }}>
            <div className="nm">{who(c)} {c.blocked && <span className="tag bad">חסום</span>}</div>
            <div className="mt">{whoSub(c)} · {c.calls_count} שיחות{c.notes ? ` · ${c.notes}` : ''}</div>
          </div>
          <div className="end" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn ghost sm" onClick={() => setEdit(true)}>ערוך</button>
            <button className={`btn sm ${c.blocked ? 'ghost' : 'danger'}`} onClick={() => onSave(c.phone, { blocked: !c.blocked })}>
              {c.blocked ? 'בטל חסימה' : 'חסום'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ============================ הגדרות הבוט ============================ */
function BotSettings({ api, notify }) {
  const [d, reload, err] = useLoad(() => api('settings'), [api]);
  const [s, setS] = useState(null);
  useEffect(() => { if (d?.settings) setS(d.settings); }, [d]);
  const up = (k, v) => setS((p) => ({ ...p, [k]: v }));
  const save = async () => {
    try {
      await api('settings', { method: 'POST', body: {
        'bot.greeting': s['bot.greeting'], 'bot.prompt': s['bot.prompt'], 'bot.search': s['bot.search'],
        'voice.name': s['voice.name'], 'voice.enabled': s['voice.enabled'],
        'voice.rate': Number(s['voice.rate']) || 0, 'bot.niqqud': s['bot.niqqud'],
        'bot.dailyLimit': Math.max(0, Number(s['bot.dailyLimit']) || 0),
      } });
      notify('ההגדרות נשמרו');
    } catch (e) { notify(e.message, 'err'); }
  };
  if (err) return <><Head title="הגדרות הבוט" /><div className="card glass"><Empty text={err} /></div></>;
  if (!s) return <><Head title="הגדרות הבוט" /><Loading /></>;
  const voices = [
    ['google', 'גוגל (Google Translate) — גיבוי: אברי'],
    ['he-IL-AvriNeural', 'אברי — גבר'],
    ['he-IL-HilaNeural', 'הילה — אישה'],
  ];
  return (
    <>
      <Head title="הגדרות הבוט" sub="התנהגות העוזר החכם" right={<button className="btn" onClick={save}>שמירה</button>} />
      <div className="grid cols">
        <div className="card glass">
          <h3 style={{ marginBottom: 16 }}>טקסטים</h3>
          <label className="fld"><span className="lb">הודעת פתיחה</span>
            <textarea className="inp" value={s['bot.greeting'] || ''} onChange={(e) => up('bot.greeting', e.target.value)} /></label>
          <label className="fld"><span className="lb">הוראות ל-AI (אישיות, סגנון, נושאים אסורים)</span>
            <textarea className="inp" style={{ minHeight: 160 }} value={s['bot.prompt'] || ''} onChange={(e) => up('bot.prompt', e.target.value)}
              placeholder="לדוגמה: ענה בעברית בלבד, בקצרה ובנימוס. אל תענה על שאלות פוליטיות." /></label>
        </div>
        <div className="card glass">
          <h3 style={{ marginBottom: 16 }}>קול והתנהגות</h3>
          <div className="swrow">
            <div className="tx"><b>חיפוש באינטרנט</b><span>עונה על שאלות עדכניות (חדשות, מזג אוויר)</span></div>
            <button className={`sw ${s['bot.search'] ? 'on' : ''}`} onClick={() => up('bot.search', !s['bot.search'])} />
          </div>
          <div className="swrow">
            <div className="tx"><b>ניקוד בתשובות</b><span>ה-AI מנקד מילים שעלולות להיקרא לא נכון</span></div>
            <button className={`sw ${s['bot.niqqud'] ? 'on' : ''}`} onClick={() => up('bot.niqqud', !s['bot.niqqud'])} />
          </div>
          <div className="swrow">
            <div className="tx"><b>קול טבעי</b><span>הקראה בקול אנושי במקום הקול של ימות</span></div>
            <button className={`sw ${s['voice.enabled'] ? 'on' : ''}`} onClick={() => up('voice.enabled', !s['voice.enabled'])} />
          </div>
          <label className="fld" style={{ marginTop: 6 }}><span className="lb">קול</span>
            <select className="inp" value={s['voice.name']} onChange={(e) => up('voice.name', e.target.value)}>
              {voices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="fld"><span className="lb">מקסימום שאלות לכל מתקשר ביום (0 = בלי הגבלה)</span>
            <input className="inp" type="number" min="0" max="500" value={s['bot.dailyLimit'] ?? 40} onChange={(e) => up('bot.dailyLimit', e.target.value)} />
          </label>
          <label className="fld"><span className="lb">מהירות דיבור: {Number(s['voice.rate']) > 0 ? '+' : ''}{Number(s['voice.rate']) || 0}%</span>
            <input type="range" min="-20" max="50" step="5" value={Number(s['voice.rate']) || 0}
              onChange={(e) => up('voice.rate', Number(e.target.value))} style={{ width: '100%', accentColor: '#7c5cff' }} />
          </label>
          <VoicePreview api={api} notify={notify} voice={s["voice.name"]} rate={Number(s['voice.rate']) || 0} />
        </div>
      </div>
    </>
  );
}
function VoicePreview({ api, notify, voice, rate }) {
  const [t, setT] = useState('ברוכים הבאים להצבעה של המוכשר, תוכנית הכישרונות של הישיבה');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api('voice/preview', { method: 'POST', body: { text: t, voice, rate } });
      new Audio('data:audio/mpeg;base64,' + r.audio).play().catch(() => {});
      if (r.engine === 'fallback') notify('גוגל לא זמין כרגע — מושמע קול הגיבוי (אברי)', 'err');
    } catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <label className="fld" style={{ marginBottom: 0 }}><span className="lb">בדיקת קול</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="inp" value={t} onChange={(e) => setT(e.target.value)} />
        <button className="btn ghost sm" onClick={go} disabled={busy} style={{ whiteSpace: 'nowrap' }}>{busy ? <span className="spin" /> : '▶ השמע'}</button>
      </div>
    </label>
  );
}

/* ============================ תפריט ראשי ============================ */
function MenuTab({ api, notify }) {
  const [d] = useLoad(() => api('settings'), [api]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (d?.settings) setText(d.settings['menu.text'] || ''); }, [d]);
  const publish = async () => {
    setBusy(true);
    try { await api('menu/publish', { method: 'POST', body: { text } }); notify('הודעת התפריט נוצרה ועלתה לימות ✓'); }
    catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <>
      <Head title="תפריט ראשי" sub="הודעת הפתיחה של השלוחה הראשית, בקול טבעי" />
      <div className="card glass" style={{ maxWidth: 680 }}>
        <label className="fld"><span className="lb">טקסט התפריט</span>
          <textarea className="inp" style={{ minHeight: 170 }} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'שלום. לעוזר החכם הקישו 1. לפודקאסט הקישו 2...'} /></label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn" onClick={publish} disabled={busy || !text.trim()}>{busy ? <span className="spin" /> : 'צור והעלה לימות'}</button>
          <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>נשמר כקובץ M1000 בשלוחה הראשית</span>
        </div>
      </div>
    </>
  );
}

/* ============================ חדשות ============================ */
function NewsTab({ api, notify }) {
  const [d, reload, err] = useLoad(() => api('news'), [api]);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try { await api('news/refresh', { method: 'POST' }); notify('המהדורה עודכנה'); reload(); }
    catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };
  const b = d?.bulletin;
  return (
    <>
      <Head title="חדשות" sub="המהדורה הנוכחית" right={<button className="btn sm" onClick={refresh} disabled={busy}>{busy ? <span className="spin" /> : 'עדכן מהדורה'}</button>} />
      <div className="card glass">
        {err ? <Empty text={err} /> : !d ? <Loading /> : !b ? <Empty icon="📰" text="אין מהדורה שמורה — לחצו 'עדכן מהדורה'" /> : (
          <>
            <div className="mt" style={{ marginBottom: 14, color: 'var(--muted)' }}>
              עודכן {timeAgo(b.createdAt)} · {b.items.length} ידיעות
            </div>
            <div className="rows">
              {b.items.map((it, i) => (
                <div className="row" key={i} style={{ alignItems: 'flex-start' }}>
                  <div className="av">{i + 1}</div>
                  <div><div className="nm">{it.title}</div><div className="mt">{it.summary}</div></div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ============================ פודקאסט ============================ */
function Podcast({ api, notify }) {
  const [d, reload, err] = useLoad(() => api('podcast'), [api]);
  const [busy, setBusy] = useState(false);
  const run = async (force) => {
    setBusy(true);
    try { const r = await api('podcast/run', { method: 'POST', body: { force } });
      notify(r.status === 'ok' ? 'הורד והועלה לימות ✓' : r.status === 'skip' ? 'הפרק כבר קיים' : 'תקלה — ראו יומן', r.status === 'error' ? 'err' : 'ok'); reload(); }
    catch (e) { notify(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <>
      <Head title="פודקאסט" sub="התוכנית המלאה של ינון ובן" right={
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost sm" onClick={() => run(false)} disabled={busy}>בדוק פרק חדש</button>
          <button className="btn sm" onClick={() => run(true)} disabled={busy}>{busy ? <span className="spin" /> : 'הורד עכשיו'}</button>
        </div>} />
      <div className="card glass">
        {err ? <Empty text={err} /> : !d ? <Loading /> : !d.history.length ? <Empty icon="🎙️" text="אין הורדות עדיין" /> : (
          <div className="rows">
            {d.history.map((h, i) => (
              <div className="row" key={i}>
                <div className="av">🎙️</div>
                <div><div className="nm">{h.title}</div>
                  <div className="mt">{new Date(h.started_at).toLocaleString('he-IL')}{h.seconds ? ` · ${h.seconds} שנ'` : ''}{h.bytes ? ` · ${(h.bytes / 1048576).toFixed(0)}MB` : ''}</div></div>
                <div className="end"><span className={`tag ${h.status === 'ok' ? 'ok' : h.status === 'error' ? 'bad' : ''}`}>
                  {h.status === 'ok' ? 'הצליח' : h.status === 'error' ? 'נכשל' : h.status}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ============================ תחבורה ============================ */
function Transit() {
  return (
    <>
      <Head title="תחבורה ציבורית" sub="שלוחה 4" />
      <div className="card glass">
        <div className="rows">
          <div className="row"><div className="av">🗺️</div><div><div className="nm">תכנון מסלולים</div><div className="mt">מקור: Transitous (נתוני משרד התחבורה)</div></div><div className="end"><span className="tag ok">פעיל</span></div></div>
          <div className="row"><div className="av">⏱️</div><div><div className="nm">זמני הגעה בזמן אמת</div><div className="mt">מקור: curlbus · גיבוי: לוח זמנים</div></div><div className="end"><span className="tag ok">פעיל</span></div></div>
          <div className="row"><div className="av">⭐</div><div><div className="nm">מקומות שמורים</div><div className="mt">המתקשרים שומרים כתובות בעצמם בשיחה</div></div><div className="end"><span className="tag ok">פעיל</span></div></div>
        </div>
        <div style={{ marginTop: 16, padding: 14, borderRadius: 14, background: 'var(--panel2)', color: 'var(--muted)', fontSize: 13, lineHeight: 1.7 }}>
          השלוחה מזהה מקומות לפי שם ועיר, מציעה עד 4 מסלולים ממוינים לפי נוחות, מלווה שלב אחר שלב עם זמני הגעה,
          ומאפשרת לנתק ולחזור באמצע הנסיעה. בסיום מוצעת נסיעה חזרה.
        </div>
      </div>
    </>
  );
}

/* ============================ הצבעה ============================ */
function Voting({ api, notify }) {
  const [d, reload, err] = useLoad(() => api('voting'), [api]);
  const [cands, setCands] = useState([]);
  const [title, setTitle] = useState('');
  useEffect(() => {
    if (d) {
      const arr = Array.from({ length: 10 }, (_, i) => {
        const found = d.candidates.find((c) => c.num === i + 1);
        return { num: i + 1, name: found?.name || '' };
      });
      // הרחבה אם יש מעל 10 מוגדרים
      const maxNum = Math.max(10, ...d.candidates.map((c) => c.num));
      for (let i = 11; i <= maxNum; i++) {
        const f = d.candidates.find((c) => c.num === i);
        arr.push({ num: i, name: f?.name || '' });
      }
      setCands(arr);
      setTitle(d.config.title);
    }
  }, [d]);

  const saveCands = async () => {
    try { await api('voting/candidates', { method: 'POST', body: { candidates: cands.filter((c) => c.name.trim()) } });
      await api('voting/title', { method: 'POST', body: { title } });
      notify('המתמודדים נשמרו'); reload(); } catch (e) { notify(e.message, 'err'); }
  };
  const toggle = async () => {
    try { await api('voting/open', { method: 'POST', body: { open: !d.config.is_open } }); notify(d.config.is_open ? 'ההצבעה נסגרה' : 'ההצבעה נפתחה'); reload(); }
    catch (e) { notify(e.message, 'err'); }
  };
  const reset = async (all) => {
    const q = all
      ? 'איפוס מלא: למחוק את כל הקולות וגם את כל שמות המתמודדים?'
      : 'לאפס את הקולות בלבד? שמות המתמודדים יישארו.';
    if (!confirm(q)) return;
    try {
      await api('voting/reset', { method: 'POST', body: { all: !!all } });
      notify(all ? 'בוצע איפוס מלא' : 'הקולות אופסו');
      reload();
    } catch (e) { notify(e.message, 'err'); }
  };
  const addRow = () => setCands((p) => p.length >= 30 ? p : [...p, { num: p.length + 1, name: '' }]);

  if (err) return <><Head title="הצבעה" /><div className="card glass"><Empty text={err} /></div></>;
  if (!d) return <><Head title="הצבעה" /><Loading /></>;
  const maxV = Math.max(1, ...d.results.map((r) => r.votes));
  const leader = d.results[0];

  return (
    <>
      <Head title="הצבעה · המוכשר" sub="תוכנית הכישרונות של הישיבה · עד 30 מתמודדים · קול אחד לכל מתקשר"
        right={<div style={{ display: 'flex', gap: 8 }}>
          <span className="live" style={{ background: d.config.is_open ? 'rgba(46,230,168,.12)' : 'var(--panel)' }}>
            <span className="dot" style={{ background: d.config.is_open ? 'var(--ok)' : 'var(--muted2)', animation: d.config.is_open ? '' : 'none' }} />
            {d.config.is_open ? 'פתוחה' : 'סגורה'}</span>
          <button className={`btn sm ${d.config.is_open ? 'danger' : ''}`} onClick={toggle}>{d.config.is_open ? 'סגור הצבעה' : 'פתח הצבעה'}</button>
        </div>} />
      <div className="grid cols">
        {/* תוצאות */}
        <div className="card glass">
          <div className="ch"><div><h3>תוצאות חיות</h3><p>סך הכל {d.total} קולות</p></div>
            <button className="btn ghost sm" onClick={reload}>רענן</button></div>
          {!d.total ? <Empty icon="🗳️" text="אין קולות עדיין" /> : (
            <div>
              {d.results.filter((r) => r.votes > 0 || d.candidates.length <= 8).map((r) => (
                <div className="resrow" key={r.num}>
                  <div className="rn">{r === leader && r.votes > 0 && <span className="crown">👑 </span>}{r.name}</div>
                  <div className="rt"><div className="resbar" style={{ width: `${Math.max(12, (r.votes / maxV) * 100)}%` }}>{r.votes}</div></div>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <button className="btn ghost sm" onClick={() => reset(false)}>איפוס קולות בלבד</button>
            <button className="btn danger sm" onClick={() => reset(true)}>איפוס מלא (כולל שמות)</button>
          </div>
        </div>
        {/* מועמדים */}
        <div className="card glass">
          <div className="ch"><div><h3>מתמודדים והגדרות</h3><p>{cands.filter((c) => c.name.trim()).length} מוגדרים</p></div>
            <button className="btn sm" onClick={saveCands}>שמור</button></div>
          <label className="fld"><span className="lb">כותרת ההצבעה</span>
            <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="למשל: הצבעה לוועד" /></label>
          <div style={{ maxHeight: 340, overflowY: 'auto', margin: '0 -4px', padding: '0 4px' }}>
            {cands.map((c, i) => (
              <div className="cand" key={c.num}>
                <div className="num">{c.num}</div>
                <input className="inp" style={{ padding: '9px 12px' }} value={c.name} placeholder={`מתמודד ${c.num}`}
                  onChange={(e) => setCands((p) => p.map((x) => x.num === c.num ? { ...x, name: e.target.value } : x))} />
              </div>
            ))}
          </div>
          {cands.length < 30 && <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={addRow}>+ הוסף מתמודד</button>}
        </div>
      </div>
    </>
  );
}

/* ============================ מערכת ============================ */
const SRC = { news: 'חדשות', transit: 'תחבורה', podcast: 'פודקאסט', vote: 'הצבעה', 'vote-admin': 'ניהול הצבעה', 'ai-call': 'בוט AI', 'ai-busy': 'עומס AI', 'admin-api': 'אתר ניהול', cleanup: 'ניקוי', translate: 'תרגומון' };
function System({ api, notify }) {
  const [e, reloadE, errE] = useLoad(() => api('errors'), [api]);
  const [u, reloadU] = useLoad(() => api('usage'), [api]);
  const [cl, reloadC] = useLoad(() => api('cleanup'), [api]);
  const [cleaning, setCleaning] = useState(false);
  const runClean = async () => {
    setCleaning(true);
    try { await api('cleanup/run', { method: 'POST' }); notify('הניקוי הסתיים'); reloadC(); } catch (ex) { notify(ex.message, 'err'); }
    setCleaning(false);
  };
  const clear = async () => {
    try { await api('errors', { method: 'DELETE' }); notify('היומן נוקה'); reloadE(); } catch (ex) { notify(ex.message, 'err'); }
  };
  const byKind = {};
  (u?.usage || []).forEach((x) => { (byKind[x.kind] ||= []).push(x); });
  const kindName = { tts: 'תמלול', answer: 'תשובות', search: 'חיפוש', תמלול: 'תמלול', תשובה: 'תשובות', חיפוש: 'חיפוש' };
  return (
    <>
      <Head title="מצב המערכת" sub="שגיאות וצריכת ספקים" right={<button className="btn ghost sm" onClick={() => { reloadE(); reloadU(); }}>רענון</button>} />
      <div className="grid cols">
        <div className="card glass">
          <div className="ch"><div><h3>שימוש בספקי AI היום</h3><p>כמה פעמים כל ספק עבד</p></div></div>
          {!u ? <Loading /> : !u.usage.length ? <Empty icon="📊" text="אין נתונים היום" /> : (
            Object.entries(byKind).map(([k, arr]) => (
              <div key={k} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>{kindName[k] || k}</div>
                {arr.map((x) => (
                  <div className="resrow" key={x.provider}>
                    <div className="rn" style={{ width: 150, fontSize: 12.5 }}>{x.provider}</div>
                    <div className="rt"><div className="resbar" style={{ width: `${Math.max(14, (x.count / Math.max(...arr.map((a) => a.count))) * 100)}%`, height: 26 }}>{x.count}</div></div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="card glass">
          <div className="ch"><div><h3>יומן שגיאות</h3><p>24 השעות האחרונות</p></div>
            {e?.errors?.length ? <button className="btn danger sm" onClick={clear}>נקה</button> : null}</div>
          {errE ? <Empty text={errE} /> : !e ? <Loading /> : !e.errors.length ? <Empty icon="✓" text="אין שגיאות — הכל תקין" /> : (
            <div className="rows" style={{ maxHeight: 420, overflowY: 'auto' }}>
              {e.errors.map((x, i) => (
                <div className="row" key={i} style={{ alignItems: 'flex-start' }}>
                  <span className="tag bad" style={{ flex: '0 0 auto' }}>{SRC[x.source.split(':')[0]] || x.source}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="mt" style={{ color: 'var(--txt)', fontSize: 13, wordBreak: 'break-word' }}>{x.message.split('\n')[0].slice(0, 180)}</div>
                    <div className="mt">{timeAgo(x.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="card glass" style={{ marginTop: 16 }}>
        <div className="ch"><div><h3>ניקוי אוטומטי</h3>
          <p>רץ כל לילה: קבצי קול ישנים בימות, ושמירת 30 השיחות האחרונות של כל מתקשר</p></div>
          <button className="btn ghost sm" disabled={cleaning} onClick={runClean}>{cleaning ? <span className="spin" /> : 'הרץ עכשיו'}</button></div>
        {!cl ? <Loading /> : !cl.last ? <Empty icon="🧹" text="הניקוי עוד לא רץ" /> : (
          <div className="rows">
            <div className="row"><div className="nm">ריצה אחרונה</div><div className="mt">{timeAgo(cl.last.at)} · {cl.last.seconds} שניות</div></div>
            <div className="row"><div className="nm">תמלולים שנמחקו</div><div className="mt">{cl.last.db?.calls || 0} שיחות · {cl.last.db?.messages || 0} הודעות</div></div>
            {(cl.last.yemot || []).map((y) => (
              <div className="row" key={y.system}><div className="nm">קבצי קול · מערכת {y.system}</div>
                <div className="mt">{y.error ? `שגיאה: ${y.error}` : `${y.deleted} נמחקו מתוך ${y.files}${y.left ? ` · ${y.left} יימחקו בריצה הבאה` : ''}`}</div></div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
