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
  min-height:100vh;overflow-x:clip;-webkit-font-smoothing:antialiased}
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
.side{position:sticky;top:18px;align-self:start;height:calc(100vh - 36px);padding:22px 16px;display:flex;flex-direction:column;gap:6px;animation:rise .6s both}
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
html,body{overflow-x:clip}
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
  ['bot', 'בוט AI', I.bot],
  ['news', 'חדשות', I.news],
  ['podcast', 'פודקאסט', I.mic],
  ['transit', 'תחבורה', I.route],
  ['voting', 'הצבעה', I.vote],
  ['systems', 'מערכות', I.grid],
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

  const Section = { overview: Overview, bot: BotTab, systems: SystemsTab,
    news: NewsTab, podcast: Podcast, transit: Transit, voting: Voting, system: System }[tab];

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
/* ============================ מערכות של משתמשים ============================ */
/* לשונית מערכות: המערכות שחוברו + התפריט הראשי של הקו */
function CfAccounts({ api }) {
  const [d] = useLoad(() => api('systems/cf'), [api]);
  if (!d) return null;
  return (
    <div className="card glass" style={{ marginBottom: 16 }}>
      <div className="ch"><div><h3>כתובות נפרדות (Cloudflare)</h3>
        <p>{!d.enabled ? 'לא מחובר - חסר CLOUDFLARE_API_TOKEN' : d.error ? d.error : `${d.accounts.length} חשבונות · כל מערכת מקבלת כתובת משלה`}</p></div></div>
      {d.enabled && d.accounts.length > 0 && (
        <div className="rows">
          {d.accounts.map((a) => (
            <div className="row" key={a.id}>
              <div className="av">☁️</div>
              <div style={{ flex: 1 }}>
                <div className="nm" style={{ direction: 'ltr', textAlign: 'right' }}>{a.subdomain ? `*.${a.subdomain}.workers.dev` : 'אין סיומת workers.dev - צריך להגדיר ב-Cloudflare'}</div>
                <div className="mt">{a.name} · {a.workers} מתוך 100 Workers</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SystemsTab(props) {
  const [sub, setSub] = useState('list');
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button className={`btn sm ${sub === 'list' ? '' : 'ghost'}`} onClick={() => setSub('list')}>מערכות שחוברו</button>
        <button className={`btn sm ${sub === 'menu' ? '' : 'ghost'}`} onClick={() => setSub('menu')}>התפריט הראשי</button>
      </div>
      {sub === 'list' ? <Systems {...props} /> : <MenuTab {...props} />}
    </>
  );
}

const SVC_NAMES = { yemot: 'בוטי', news: 'חדשות', transit: 'תחבורה', translate: 'תרגומון' };
const HEALTH = {
  ok: ['תקינה', 'var(--ok)'],
  warn: ['לבדיקה', 'var(--warn)'],
  bad: ['תקלה', 'var(--bad)'],
  unknown: ['לא נבדקה', 'var(--muted)'],
};
function Systems({ api, notify }) {
  const [d, reload, err] = useLoad(() => api('systems/monitor'), [api]);
  const [show, setShow] = useState({});
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const act = async (path, body, msg) => {
    try { await api(path, { method: 'POST', body }); notify(msg); reload(); } catch (e) { notify(e.message, 'err'); }
  };
  const check = async (did) => {
    setBusy(did || 'all');
    try {
      const r = await api('systems/check', { method: 'POST', body: did ? { did } : {} });
      notify(did ? `${did}: ${r.detail}` : `נבדקו ${r.results?.length || 0} מערכות`);
      reload();
    } catch (e) { notify(e.message, 'err'); }
    setBusy('');
  };
  const recent = (x) => x.last_seen && Date.now() - new Date(x.last_seen) < 7 * 864e5;
  const problem = (x) => x.status === 'active' && (x.health === 'bad' || x.errors24h >= 3 || x.last_error);
  const all = d?.systems || [];
  const list = all
    .filter((x) => !q || `${x.did} ${x.owner_name} ${x.owner_phone}`.includes(q.trim()))
    .filter((x) => filter === 'all' || (filter === 'problems' ? problem(x) : filter === 'active' ? x.status === 'active' && recent(x) : filter === 'idle' ? x.status === 'active' && !recent(x) : x.status !== 'active'));
  const t = d?.totals || {};
  const tiles = [
    ['מערכות', t.systems ?? 0, 'var(--a1)'],
    ['פעילות השבוע', t.active ?? 0, 'var(--ok)'],
    ['שיחות היום', t.today ?? 0, 'var(--a2)'],
    ['שיחות 7 ימים', t.week ?? 0, 'var(--a3)'],
    ['שגיאות 24ש׳', t.errors24h ?? 0, t.errors24h ? 'var(--warn)' : 'var(--muted)'],
    ['עם תקלה', t.problems ?? 0, t.problems ? 'var(--bad)' : 'var(--muted)'],
  ];
  const dayLabels = (t.days || []).map((x) => x.slice(8, 10) + '/' + x.slice(5, 7));
  return (
    <>
      <Head title="ניטור מערכות" sub="כל המערכות שהוקמו דרך שלוחת פתיחת המערכת"
        right={<div style={{ display: 'flex', gap: 6 }}>
          <button className="btn ghost sm" onClick={async () => {
            if (!confirm('לכתוב מחדש את התפריט, הודעת התפריט, שלוחות 1-4 ושלוחת הכוכבית בכל המערכות הפעילות?')) return;
            setBusy('refresh');
            try { const r = await api('systems/refresh-all', { method: 'POST', body: {} }); const bad = (r.results || []).filter((x) => !x.ok).length; notify(`עודכנו ${(r.results || []).length - bad} מערכות${bad ? `, ${bad} נכשלו` : ''}`); reload(); } catch (e) { notify(e.message, 'err'); }
            setBusy('');
          }} disabled={!!busy}>{busy === 'refresh' ? <span className="spin" /> : 'עדכון תפריט בכל המערכות'}</button>
          <button className="btn ghost sm" onClick={() => check()} disabled={!!busy}>{busy === 'all' ? <span className="spin" /> : 'בדיקת כל המערכות'}</button>
          <button className="btn ghost sm" onClick={reload}>רענון</button>
        </div>} />
      {err ? <div className="card glass"><Empty text={err} /></div> : !d ? <Loading /> : (
        <>
          <div className="grid stats" style={{ marginBottom: 16 }}>
            {tiles.map(([l, v, c], i) => (
              <div className="stat glass" key={l} style={{ animationDelay: `${i * 60}ms` }}>
                <div className="v" style={{ color: c }}>{v}</div><div className="l">{l}</div>
              </div>
            ))}
          </div>
          <CfAccounts api={api} />
          {all.length > 0 && (
            <div className="card glass" style={{ marginBottom: 16 }}>
              <div className="ch"><div><h3>שיחות בכל המערכות</h3><p>14 הימים האחרונים</p></div></div>
              <MiniBars data={t.byDay || []} labels={dayLabels} every={2} />
            </div>
          )}
          <div className="card glass">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <input className="inp" style={{ flex: 1, minWidth: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי מספר מערכת, שם או טלפון" />
              {[['all', 'הכול'], ['problems', 'עם תקלה'], ['active', 'פעילות'], ['idle', 'לא פעילות'], ['off', 'מושבתות']].map(([k, l]) => (
                <button key={k} className={`btn sm ${filter === k ? '' : 'ghost'}`} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            {!list.length ? <Empty icon="🏗️" text={all.length ? 'אין מערכות שמתאימות לסינון' : 'עוד לא הוקמו מערכות'} /> : (
              <div className="rows">
                {list.map((x) => {
                  const [hl, hc] = HEALTH[x.health || 'unknown'] || HEALTH.unknown;
                  const isOpen = open === x.did;
                  return (
                    <div key={x.did} className="row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', width: '100%', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : x.did)}>
                        <div className="av" style={{ background: x.status !== 'active' ? 'var(--muted)' : hc }}>{x.status !== 'active' ? '⏸' : x.health === 'bad' ? '!' : '✓'}</div>
                        <div style={{ flex: 1 }}>
                          <div className="nm">
                            {x.did}{' '}
                            {x.status !== 'active' ? <span className="tag bad">מושבתת</span> : <span className="tag" style={{ color: hc, borderColor: hc }}>{hl}</span>}{' '}
                            {x.status === 'active' && !recent(x) && <span className="tag" style={{ opacity: 0.6 }}>לא פעילה השבוע</span>}
                            {x.errors24h > 0 && <span className="tag" style={{ color: 'var(--warn)' }}>{x.errors24h} שגיאות היום</span>}
                          </div>
                          <div className="mt">
                            {x.owner_name || 'ללא שם'} · {x.owner_phone ? fmtPhone(x.owner_phone) : 'מספר חסוי'} ·
                            היום {x.today} · השבוע {x.week} · סה״כ {x.calls} שיחות ·
                            {x.last_seen ? ` שימוש אחרון ${timeAgo(x.last_seen)}` : ' עוד לא היו שיחות'}
                          </div>
                        </div>
                        <div className="mt" style={{ whiteSpace: 'nowrap' }}>{isOpen ? '▲' : '▼'}</div>
                      </div>
                      {isOpen && (
                        <div style={{ width: '100%', paddingInlineStart: 52 }}>
                          <div className="mt" style={{ marginBottom: 8 }}>
                            בדיקת תקינות: <b style={{ color: hc }}>{hl}</b>{x.health_detail ? ` — ${x.health_detail}` : ''}
                            {x.health_at ? ` (נבדקה ${timeAgo(x.health_at)})` : ''}
                          </div>
                          {x.last_error && <div className="mt" style={{ color: '#ff6b8b', marginBottom: 8 }}>שגיאה בהקמה: {x.last_error}</div>}
                          <div className="mt" style={{ marginBottom: 8 }}>
                            שירותים השבוע: {Object.keys(x.services || {}).length
                              ? Object.entries(x.services).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${SVC_NAMES[k] || k} ${v}`).join(' · ')
                              : 'אין שימוש'}
                          </div>
                          <MiniBars data={x.byDay || []} labels={dayLabels} every={2} />
                          {x.recentErrors?.length > 0 && (
                            <div style={{ marginTop: 10 }}>
                              <div className="mt" style={{ marginBottom: 4 }}>שגיאות אחרונות:</div>
                              {x.recentErrors.map((e, i) => (
                                <div key={i} className="mt" style={{ fontFamily: 'monospace', fontSize: 11, direction: 'ltr', textAlign: 'left', opacity: 0.85 }}>
                                  {new Date(e.created_at).toLocaleString('he-IL')} [{e.source}] {String(e.message).split('\n')[0]}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="mt" style={{ marginBottom: 8, direction: 'ltr', textAlign: 'right' }}>
                            כתובת: <span style={{ fontFamily: 'monospace' }}>{x.worker_url || 'כתובת משותפת'}</span>
                          </div>
                          <div className="mt" style={{ margin: '10px 0' }}>
                            הוקמה {new Date(x.created_at).toLocaleDateString('he-IL')} · סיסמה: <span style={{ fontFamily: 'monospace' }}>{show[x.did] ? x.password : '••••'}</span>{' '}
                            <a style={{ cursor: 'pointer', color: '#19d3ff' }} onClick={() => setShow((s) => ({ ...s, [x.did]: !s[x.did] }))}>{show[x.did] ? 'הסתר' : 'הצג'}</a>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button className="btn ghost sm" onClick={() => check(x.did)} disabled={!!busy}>{busy === x.did ? <span className="spin" /> : 'בדיקת תקינות'}</button>
                            <button className="btn ghost sm" disabled={!!busy} onClick={async () => {
                              if (!confirm(`לתת למערכת ${x.did} כתובת חדשה? הכתובת הנוכחית תפסיק לעבוד, והשלוחות יעודכנו לחדשה.`)) return;
                              setBusy('renew' + x.did);
                              try { const r = await api('systems/renew', { method: 'POST', body: { did: x.did } }); notify('כתובת חדשה: ' + (r.url || '')); reload(); } catch (e) { notify(e.message, 'err'); }
                              setBusy('');
                            }}>{busy === 'renew' + x.did ? <span className="spin" /> : 'כתובת חדשה'}</button>
                            <button className="btn ghost sm" onClick={() => act('systems/status', { did: x.did, status: x.status === 'active' ? 'disabled' : 'active' }, x.status === 'active' ? 'המערכת הושבתה' : 'המערכת הופעלה')}>
                              {x.status === 'active' ? 'השבתה' : 'הפעלה'}
                            </button>
                            <button className="btn danger sm" onClick={() => confirm(`למחוק את המערכת ${x.did} מהרשימה? השלוחות שלה יפסיקו לעבוד.`) && act('systems/delete', { did: x.did }, 'המערכת נמחקה')}>מחיקה</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

/* ============================ בוט AI: משתמשים + הגדרות ============================ */
function BotTab(props) {
  const [sub, setSub] = useState('users');
  return (
    <>
      <div className="seg" style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[['users', 'משתמשים'], ['settings', 'הגדרות']].map(([k, l]) => (
          <button key={k} className={`btn sm ${sub === k ? '' : 'ghost'}`} onClick={() => setSub(k)}>{l}</button>
        ))}
      </div>
      {sub === 'users' ? <BotUsers {...props} /> : <BotSettings {...props} />}
    </>
  );
}

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function MiniBars({ data, labels, every = 1 }) {
  const max = Math.max(1, ...data);
  return (
    <div>
      <div className="bars" style={{ height: 110 }}>
        {data.map((v, i) => (
          <div key={i} className="b" style={{ height: `${Math.max(3, (v / max) * 100)}%`, opacity: v ? 0.9 : 0.25 }}>
            <span className="t">{labels[i]}: {v}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 7, marginTop: 6 }}>
        {labels.map((l, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: 'var(--muted)' }}>{i % every === 0 ? l : ''}</div>
        ))}
      </div>
    </div>
  );
}

function LimitBox({ prof, onSave }) {
  const l = prof.limit || {};
  const [mode, setMode] = useState(l.custom == null ? 'default' : l.custom === 0 ? 'none' : 'custom');
  const [val, setVal] = useState(l.custom > 0 ? l.custom : (l.defaultLimit || 20));
  const eff = l.effective || 0;
  const pct = eff > 0 ? Math.min(100, (l.today / eff) * 100) : 0;
  const save = () => onSave(mode === 'default' ? null : mode === 'none' ? 0 : Math.max(1, Number(val) || 1));
  return (
    <div className="card glass" style={{ padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h4 style={{ margin: 0 }}>שאלות לבוט ביום</h4>
          <div className="mt">היום: {l.today ?? 0} {eff > 0 ? `מתוך ${eff}` : '· בלי הגבלה'}
            {' · '}{l.custom == null ? `ברירת מחדל${l.owner ? ' (בעל מערכת)' : ''}` : 'מגבלה אישית'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="inp" style={{ width: 'auto' }} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="default">ברירת מחדל ({l.defaultLimit || 'בלי הגבלה'})</option>
            <option value="custom">מספר אישי</option>
            <option value="none">בלי הגבלה</option>
          </select>
          {mode === 'custom' && <input className="inp" type="number" min="1" max="1000" style={{ width: 90 }} value={val} onChange={(e) => setVal(e.target.value)} />}
          <button className="btn sm" onClick={save}>שמור</button>
        </div>
      </div>
      {eff > 0 && <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,.08)', marginTop: 10, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#ff5c7a' : 'linear-gradient(90deg,#7c5cff,#3fd0ff)' }} />
      </div>}
    </div>
  );
}

function BotUsers({ api, notify }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const [prof, setProf] = useState(null);
  const [open, setOpen] = useState(null);
  const [msgs, setMsgs] = useState(null);
  useEffect(() => {
    const t = setTimeout(async () => {
      try { setList((await api(`users?q=${encodeURIComponent(q)}`)).users); } catch (e) { notify(e.message, 'err'); setList([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, api]);
  const pick = async (phone) => {
    setSel(phone); setProf(null); setOpen(null);
    try { setProf((await api(`users?phone=${encodeURIComponent(phone)}`)).profile); } catch (e) { notify(e.message, 'err'); }
  };
  const expand = async (id) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id); setMsgs(null);
    try { setMsgs((await api(`calls?id=${encodeURIComponent(id)}`)).messages); } catch { setMsgs([]); }
  };
  const rename = async () => {
    const name = prompt('שם המשתמש:', prof?.caller?.name || '');
    if (name == null) return;
    try { await api('callers', { method: 'POST', body: { phone: sel, name } }); notify('השם עודכן'); pick(sel); } catch (e) { notify(e.message, 'err'); }
  };
  const c = prof?.caller;
  const peak = prof ? prof.byHour.indexOf(Math.max(...prof.byHour)) : -1;
  return (
    <>
      <Head title="משתמשי הבוט" sub="שלוחה 1 · חיפוש לפי שם או מספר טלפון" />
      <div className="grid cols wide">
        <div className="card glass">
          {sel && prof === null ? <Loading /> : !sel ? <Empty icon="🔎" text="בחרו משתמש מהרשימה כדי לראות את הנתונים שלו" /> : !c ? <Empty text="המשתמש לא נמצא" /> : (
            <>
              <div className="ch">
                <div><h3>{c.name || 'ללא שם'} {c.blocked && <span className="tag bad">חסום</span>}</h3><p>{fmtPhone(c.phone)}</p></div>
                <button className="btn ghost sm" onClick={rename}>עריכת שם</button>
              </div>
              <div className="grid stats" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))" }}>
                <div className="stat glass" style={{ padding: 14 }}><div className="v" style={{ fontSize: 24 }}>{c.calls_count}</div><div className="l">שיחות</div></div>
                <div className="stat glass" style={{ padding: 14 }}><div className="v" style={{ fontSize: 24 }}>{prof.questions}</div><div className="l">שאלות</div></div>
                <div className="stat glass" style={{ padding: 14 }}><div className="v" style={{ fontSize: 15 }}>{new Date(c.first_call_at).toLocaleDateString('he-IL')}</div><div className="l">שיחה ראשונה</div></div>
                <div className="stat glass" style={{ padding: 14 }}><div className="v" style={{ fontSize: 15 }}>{timeAgo(c.last_call_at)}</div><div className="l">שיחה אחרונה</div></div>
              </div>
              <div className="swrow">
                <div className="tx"><b>מנהל</b><span>{c.is_admin ? 'מזוהה כמנהל לפי מספר הטלפון: בלי סינון, ויקבל יכולות ניהול בשיחה' : 'מתקשר רגיל'}</span></div>
                <button className={`sw ${c.is_admin ? 'on' : ''}`} onClick={async () => {
                  if (!c.is_admin && !confirm('להגדיר את המספר הזה כמנהל?')) return;
                  try { await api('callers', { method: 'POST', body: { phone: sel, is_admin: !c.is_admin } }); notify(c.is_admin ? 'הוסר מהמנהלים' : 'הוגדר כמנהל'); pick(sel); }
                  catch (e) { notify(e.message, 'err'); }
                }} />
              </div>
              <div className="swrow" style={{ marginBottom: 12 }}>
                <div className="tx"><b>בלי סינון תכנים</b><span>{c.no_filter ? 'המשתמש הזה מקבל תשובות בלי שום סינון' : 'המשתמש מסונן כמו כולם'}</span></div>
                <button className={`sw ${c.no_filter ? 'on' : ''}`} onClick={async () => {
                  if (!c.no_filter && !confirm('לבטל את כל הסינון למשתמש הזה?')) return;
                  try { await api('callers', { method: 'POST', body: { phone: sel, no_filter: !c.no_filter } }); notify(c.no_filter ? 'הסינון הופעל' : 'הסינון בוטל למשתמש'); pick(sel); }
                  catch (e) { notify(e.message, 'err'); }
                }} />
              </div>
              <LimitBox key={c.phone} prof={prof} onSave={async (v) => {
                try { await api('callers', { method: 'POST', body: { phone: sel, daily_limit: v } }); notify('המגבלה עודכנה'); pick(sel); }
                catch (e) { notify(e.message, 'err'); }
              }} />
              <h4 style={{ margin: '6px 0 4px' }}>באילו שעות הוא מתקשר {peak >= 0 && prof.byHour[peak] > 0 && <span className="mt">· הכי הרבה בשעה {peak}:00</span>}</h4>
              <MiniBars data={prof.byHour} labels={prof.byHour.map((_, i) => String(i))} every={3} />
              <h4 style={{ margin: '18px 0 4px' }}>באילו ימים</h4>
              <MiniBars data={prof.byDay} labels={DAYS} />
              <h4 style={{ margin: '18px 0 8px' }}>השיחות שלו</h4>
              <div className="rows">
                {prof.calls.map((x) => (
                  <div key={x.id}>
                    <div className="row" style={{ cursor: 'pointer' }} onClick={() => expand(x.id)}>
                      <div className="av">📞</div>
                      <div><div className="nm">{new Date(x.started_at).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                        <div className="mt">{new Date(x.started_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })} · {x.turns} הודעות</div></div>
                      <div className="end">{timeAgo(x.started_at)}</div>
                    </div>
                    {open === x.id && (
                      <div style={{ padding: '10px 14px 16px' }}>
                        {!msgs ? <Loading /> : !msgs.length ? <Empty text="אין תמלול לשיחה הזו" /> :
                          msgs.map((m, i) => (
                            <div className={`bub ${m.role === 'user' ? 'u' : 'a'}`} key={i}>
                              <div className="who">{m.role === 'user' ? (c.name || 'מתקשר') : 'בוט'}</div>{m.text}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="card glass">
          <input className="inp" style={{ marginBottom: 14 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם או מספר טלפון" />
          {!list ? <Loading /> : !list.length ? <Empty icon="👤" text="לא נמצאו משתמשים" /> : (
            <div className="rows">
              {list.map((u) => (
                <div key={u.phone} className="row" style={{ cursor: 'pointer', outline: sel === u.phone ? '1px solid rgba(124,92,255,.6)' : 'none' }} onClick={() => pick(u.phone)}>
                  <div className="av">{initials(u.name) || '•'}</div>
                  <div><div className="nm">{who(u)}</div><div className="mt">{whoSub(u)} · {u.calls_count} שיחות · {u.questions} שאלות</div></div>
                  <div className="end">{timeAgo(u.last_call_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function RegenVoice({ api, notify }) {
  const [st, setSt] = useState(null);
  const run = async () => {
    if (!confirm('ליצור מחדש את כל ההודעות בכל המערכות בקול שנבחר? (קודם לשמור את ההגדרות)')) return;
    let done = 0;
    try {
      for (let i = 0; i < 40; i++) {
        setSt({ msg: `יוצר הודעות בקול החדש... ${done} נוצרו` });
        const r = await api('voice/regen', { method: 'POST', body: { step: 'cache' } });
        done += r.done || 0;
        setSt({ msg: `יוצר הודעות בקול החדש... ${done} נוצרו, נשארו ${r.left}` });
        if (!r.left || (!r.done && r.failed)) break;
      }
      setSt({ msg: `${done} הודעות נוצרו. מעדכן את התפריטים בכל המערכות...` });
      const m = await api('voice/regen', { method: 'POST', body: { step: 'menus' } });
      const bad = (m.systems || []).filter((x) => !x.ok).length;
      setSt({ msg: `הסתיים: ${done} הודעות, התפריט הראשי ו-${(m.systems || []).length} מערכות${bad ? ` (${bad} עם תקלה)` : ''}` });
      notify('כל ההודעות נוצרו מחדש');
    } catch (e) { setSt({ msg: e.message }); notify(e.message, 'err'); }
  };
  return (
    <div style={{ margin: '4px 0 12px' }}>
      <button className="btn ghost sm" onClick={run}>יצירה מחדש של כל ההודעות בקול הזה</button>
      {st && <div className="mt" style={{ marginTop: 6 }}>{st.msg}</div>}
    </div>
  );
}

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
        'voice.rate': Number(s['voice.rate']) || 0, 'bot.niqqud': s['bot.niqqud'], 'voice.nakdan': s['voice.nakdan'] !== false,
        'bot.dailyLimit': Math.max(0, Number(s['bot.dailyLimit']) || 0),
        'bot.dailyLimitOwner': Math.max(0, Number(s['bot.dailyLimitOwner']) || 0),
        'bot.music': s['bot.music'] !== false,
        'bot.vertex': s['bot.vertex'] !== false,
        'bot.filter': s['bot.filter'] !== false, 'bot.filterSmart': s['bot.filterSmart'] !== false, 'bot.filterWords': s['bot.filterWords'] || '', 'bot.filterReply': s['bot.filterReply'] || '',
      } });
      notify('ההגדרות נשמרו');
    } catch (e) { notify(e.message, 'err'); }
  };
  if (err) return <><Head title="הגדרות הבוט" /><div className="card glass"><Empty text={err} /></div></>;
  if (!s) return <><Head title="הגדרות הבוט" /><Loading /></>;
  const voices = [
    ['he-IL-Chirp3-HD-Charon', 'Chirp 3 HD צ׳רון — גבר (Google Cloud)'],
    ['he-IL-Chirp3-HD-Orus', 'Chirp 3 HD אורוס — גבר (Google Cloud)'],
    ['he-IL-Chirp3-HD-Puck', 'Chirp 3 HD פאק — גבר (Google Cloud)'],
    ['he-IL-Chirp3-HD-Fenrir', 'Chirp 3 HD פנריר — גבר (Google Cloud)'],
    ['he-IL-Chirp3-HD-Zephyr', 'Chirp 3 HD זפיר — אישה (Google Cloud)'],
    ['he-IL-Chirp3-HD-Kore', 'Chirp 3 HD קורה — אישה (Google Cloud)'],
    ['he-IL-Chirp3-HD-Aoede', 'Chirp 3 HD אואדה — אישה (Google Cloud)'],
    ['google', 'גוגל (Google Translate) — גיבוי: אברי'],
    ['he-IL-AvriNeural', 'אברי — גבר'],
    ['he-IL-HilaNeural', 'הילה — אישה'],
  ];
  return (
    <>
      <Head title="הגדרות הבוט" sub="שלוחה 1 · התנהגות בוטי" right={<button className="btn" onClick={save}>שמירה</button>} />
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
            <div className="tx"><b>סינון תכנים (קהל חרדי)</b><span>בוטי לא עוסק בנושאים שאינם מתאימים, ושאלות עם מילה חסומה לא מגיעות ל-AI בכלל. אפשר לבטל סינון למשתמש מסוים בכרטיס שלו. כל חסימה נרשמת ביומן</span></div>
            <button className={`sw ${s['bot.filter'] !== false ? 'on' : ''}`} onClick={() => up('bot.filter', s['bot.filter'] === false)} />
          </div>
          {s['bot.filter'] !== false && <>
            <div className="swrow">
              <div className="tx"><b>בדיקה חכמה</b><span>מודל AI נפרד בודק כל שאלה וכל תשובה, ותופס גם ניסוחים עקיפים וניסיונות לעקוף את הבוט ("אני המפתח", "תעמיד פנים"...). אחרי 3 חסימות ביום המתקשר ננעל עד מחר</span></div>
              <button className={`sw ${s['bot.filterSmart'] !== false ? 'on' : ''}`} onClick={() => up('bot.filterSmart', s['bot.filterSmart'] === false)} />
            </div>
            <label className="fld"><span className="lb">מילים וביטויים חסומים (פסיק או שורה בין אחד לשני)</span>
              <textarea className="inp" rows={3} value={s['bot.filterWords'] || ''} onChange={(e) => up('bot.filterWords', e.target.value)} placeholder="למשל: קזינו, הימורים" />
            </label>
            <label className="fld"><span className="lb">מה בוטי עונה על נושא חסום (ריק = ברירת המחדל)</span>
              <input className="inp" value={s['bot.filterReply'] || ''} onChange={(e) => up('bot.filterReply', e.target.value)} placeholder="על הנושא הזה אני לא מדבר. אפשר לשאול אותי על משהו אחר." />
            </label>
          </>}
          <div className="swrow">
            <div className="tx"><b>Gemini המתקדם (Vertex)</b><span>גיבוי כשהחינמיים לא עונים, וראשון בשאלות עם חיפוש בגוגל. בערך עשירית סנט לתשובה מקרדיט הניסיון. כבוי = Gemini החינמי ו-Groq בלבד</span></div>
            <button className={`sw ${s['bot.vertex'] !== false ? 'on' : ''}`} onClick={() => up('bot.vertex', s['bot.vertex'] === false)} />
          </div>
          <div className="swrow">
            <div className="tx"><b>ניקוד אוטומטי (נקדן דיקטה)</b><span>כל טקסט מנוקד בנקדן של דיקטה לפני ההקראה בקול Chirp, כדי שיקרא נכון. כבוי = ה-AI מנקד בעצמו</span></div>
            <button className={`sw ${s['voice.nakdan'] !== false ? 'on' : ''}`} onClick={() => up('voice.nakdan', s['voice.nakdan'] === false)} />
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
          <RegenVoice api={api} notify={notify} />
          <label className="fld"><span className="lb">מקסימום שאלות לכל מתקשר ביום (0 = בלי הגבלה)</span>
            <input className="inp" type="number" min="0" max="500" value={s['bot.dailyLimit'] ?? 20} onChange={(e) => up('bot.dailyLimit', e.target.value)} />
          </label>
          <label className="fld"><span className="lb">מקסימום שאלות ביום למי שפתח מערכת אישית</span>
            <input className="inp" type="number" min="0" max="500" value={s['bot.dailyLimitOwner'] ?? 40} onChange={(e) => up('bot.dailyLimitOwner', e.target.value)} />
          </label>
          <div className="swrow">
            <div className="tx"><b>מנגינה בזמן ההמתנה</b><span>מוזיקה קצרה בין השאלה לתשובה של בוטי</span></div>
            <button className={`sw ${s['bot.music'] !== false ? 'on' : ''}`} onClick={() => up('bot.music', s['bot.music'] === false)} />
          </div>
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
  const [t, setT] = useState('שלום, כאן בוטי. אפשר לשאול אותי כל שאלה, ואני אשתדל לעזור.');
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
            placeholder={'שלום. לבוטי, העוזר החכם, הקישו 1. לפודקאסט הקישו 2...'} /></label>
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
      <Head title="חדשות" sub="שלוחה 2 · המהדורה הנוכחית" right={<button className="btn sm" onClick={refresh} disabled={busy}>{busy ? <span className="spin" /> : 'עדכן מהדורה'}</button>} />
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
      <NewsListens api={api} />
    </>
  );
}

function NewsListens({ api }) {
  const [days, setDays] = useState(14);
  const [q, setQ] = useState('');
  const [d, reload, err] = useLoad(() => api(`news/stats?days=${days}`), [api, days]);
  const st = d?.stats;
  const secs = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000));
  const dur = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} דק'` : `${s} שנ'`);
  const rows = (st?.recent || []).filter((r) => !q || (r.name || '').includes(q) || (r.phone || '').includes(q.replace(/\D/g, '') || '@@'));
  return (
    <div className="card glass" style={{ marginTop: 16 }}>
      <div className="ch">
        <div><h3>מי האזין לחדשות</h3><p>האזנות לשלוחת החדשות בכל המערכות</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select className="inp" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>היום ואתמול</option><option value={7}>שבוע</option><option value={14}>שבועיים</option><option value={30}>חודש</option><option value={90}>3 חודשים</option>
          </select>
          <button className="btn ghost sm" onClick={reload}>רענון</button>
        </div>
      </div>
      {err ? <Empty text={err} /> : !st ? <Loading /> : !st.listens ? <Empty icon="🎧" text="עוד אין האזנות בתקופה הזו. ההאזנות נספרות מהיום" /> : (
        <>
          <div className="grid stats" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
            <div className="stat glass" style={{ padding: 14 }}><div className="v" style={{ fontSize: 24 }}>{st.listens}</div><div className="l">האזנות</div></div>
            <div className="stat glass" style={{ padding: 14 }}><div className="v" style={{ fontSize: 24 }}>{st.people}</div><div className="l">מאזינים שונים</div></div>
            <div className="stat glass" style={{ padding: 14 }}><div className="v" style={{ fontSize: 24 }}>{st.today}</div><div className="l">היום</div></div>
            <div className="stat glass" style={{ padding: 14 }}><div className="v" style={{ fontSize: 20 }}>{dur(st.avg_secs)}</div><div className="l">זמן האזנה ממוצע</div></div>
          </div>
          {st.byDay.length > 1 && <>
            <h4 style={{ margin: '6px 0 4px' }}>האזנות לפי יום</h4>
            <MiniBars data={st.byDay.map((x) => x.c)} labels={st.byDay.map((x) => new Date(x.day).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }))} every={Math.ceil(st.byDay.length / 10)} />
          </>}
          <h4 style={{ margin: '18px 0 4px' }}>באילו שעות מאזינים</h4>
          <MiniBars data={st.byHour} labels={st.byHour.map((_, i) => String(i))} every={3} />
          {st.topItems.length > 0 && <div className="mt" style={{ margin: '14px 0 4px' }}>הידיעות שביקשו לשמוע בפירוט: {st.topItems.map((t) => `ידיעה ${t.item} (${t.c})`).join(' · ')}</div>}
          <h4 style={{ margin: '18px 0 8px' }}>האזנות אחרונות</h4>
          <input className="inp" style={{ marginBottom: 10 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם או טלפון" />
          <div className="rows">
            {rows.map((r) => (
              <div className="row" key={r.call_id}>
                <div className="av">{initials(r.name) || '🎧'}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{r.name || (r.phone ? fmtPhone(r.phone) : 'מספר חסוי')}</div>
                  <div className="mt">
                    {r.name && r.phone ? fmtPhone(r.phone) + ' · ' : ''}
                    {new Date(r.started_at).toLocaleString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {r.ended ? ` · ${dur(secs(r.started_at, r.last_at))}` : ''}
                    {r.items?.length ? ` · ביקש ידיעות ${[...new Set(r.items)].join(', ')}` : ''}
                    {r.replays ? ` · שמע שוב ${r.replays}` : ''}
                    {r.did ? ` · מערכת ${r.owner_name || r.did}` : ' · הקו הראשי'}
                  </div>
                </div>
                <div className="end">{timeAgo(r.started_at)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
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
      <Head title="פודקאסט" sub="שלוחה 8 · התוכנית המלאה של ינון ובן" right={
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
/* מפה (Leaflet + OpenStreetMap), נטענת פעם אחת מ-CDN */
function useLeaflet() {
  const [L, setL] = useState(typeof window !== 'undefined' ? window.L : null);
  useEffect(() => {
    if (window.L) { setL(window.L); return; }
    if (!document.getElementById('leaflet-css')) {
      const css = document.createElement('link');
      css.id = 'leaflet-css'; css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
    }
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = () => setL(window.L);
    document.body.appendChild(js);
  }, []);
  return L;
}

function TripMap({ items, focus }) {
  const L = useLeaflet();
  const box = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  useEffect(() => {
    if (!L || !box.current) return;
    if (!map.current) {
      map.current = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([31.7, 35.0], 8);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map.current);
    }
    if (layer.current) layer.current.remove();
    layer.current = L.layerGroup().addTo(map.current);
    const shown = (focus ? [focus] : items).filter((x) => x.from_lat && x.to_lat);
    const bounds = [];
    shown.forEach((x, i) => {
      const a = [x.from_lat, x.from_lon], b = [x.to_lat, x.to_lon];
      const hot = focus || i === 0;
      L.polyline([a, b], { color: hot ? '#7c5cff' : '#19d3ff', weight: hot ? 5 : 3, opacity: hot ? 0.95 : 0.45, dashArray: hot ? null : '6 6' }).addTo(layer.current);
      L.circleMarker(a, { radius: hot ? 8 : 5, color: '#22c55e', fillOpacity: 1 }).bindTooltip('מ: ' + x.from_name).addTo(layer.current);
      const eta = x.best_minutes ? `${x.best_minutes} דק'` : '';
      L.circleMarker(b, { radius: hot ? 8 : 5, color: '#ff4d8d', fillOpacity: 1 })
        .bindTooltip(`אל: ${x.to_name}${eta ? ' · ' + eta : ''}`, { permanent: !!focus, direction: 'top' }).addTo(layer.current);
      bounds.push(a, b);
    });
    if (bounds.length) map.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    setTimeout(() => map.current && map.current.invalidateSize(), 50);
  }, [L, items, focus]);
  return <div ref={box} style={{ height: 380, borderRadius: 16, overflow: 'hidden', background: 'var(--panel2)' }} />;
}

function Transit({ api }) {
  const [d, reload, err] = useLoad(() => api('transit/log'), [api]);
  const [focus, setFocus] = useState(null);
  const items = d?.log || [];
  const hhmm = (t) => (t ? new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '');
  const today = items.filter((x) => Date.now() - new Date(x.created_at) < 864e5).length;
  return (
    <>
      <Head title="תחבורה ציבורית" sub="שלוחה 3 · החיפושים האחרונים על המפה" right={<button className="btn ghost sm" onClick={reload}>רענון</button>} />
      {err ? <div className="card glass"><Empty text={err} /></div> : !d ? <Loading /> : (
        <>
          <div className="grid stats" style={{ marginBottom: 16 }}>
            <div className="stat glass"><div className="v" style={{ color: 'var(--a1)' }}>{today}</div><div className="l">חיפושים ב-24 שעות</div></div>
            <div className="stat glass"><div className="v" style={{ color: 'var(--a2)' }}>{items.length}</div><div className="l">בלוג</div></div>
            <div className="stat glass"><div className="v" style={{ color: 'var(--a3)' }}>{items.length ? Math.round(items.filter((x) => x.best_minutes).reduce((a, x) => a + x.best_minutes, 0) / Math.max(1, items.filter((x) => x.best_minutes).length)) : 0}</div><div className="l">דק' נסיעה בממוצע</div></div>
            <div className="stat glass"><div className="v" style={{ color: 'var(--ok)' }}>{new Set(items.map((x) => x.phone)).size}</div><div className="l">מתקשרים שונים</div></div>
          </div>
          <div className="card glass" style={{ marginBottom: 16 }}>
            <div className="ch"><div><h3>{focus ? `${focus.from_name} ← ${focus.to_name}` : 'מפת החיפושים'}</h3>
              <p>{focus ? `${focus.best_minutes ? `צפי ${focus.best_minutes} דק'` : ''}${focus.best_start ? ` · יציאה ${hhmm(focus.best_start)} · הגעה ${hhmm(focus.best_end)}` : ''}${focus.best_summary ? ` · ${focus.best_summary}` : ''}` : 'הקו הסגול - החיפוש האחרון. לחצו על חיפוש ברשימה כדי לראות אותו על המפה'}</p></div>
              {focus && <button className="btn ghost sm" onClick={() => setFocus(null)}>כל החיפושים</button>}</div>
            <TripMap items={items.slice(0, 30)} focus={focus} />
          </div>
          <div className="card glass">
            <div className="ch"><div><h3>חיפושים אחרונים</h3><p>מה המתקשרים ביקשו ומה הוצע להם</p></div></div>
            {!items.length ? <Empty icon="🚌" text="עוד אין חיפושים. החיפושים יופיעו כאן מהחיפוש הבא בשלוחה" /> : (
              <div className="rows">
                {items.map((x) => (
                  <div className="row" key={x.id} style={{ cursor: 'pointer', outline: focus?.id === x.id ? '2px solid #7c5cff' : 'none', borderRadius: 12 }} onClick={() => setFocus(x)}>
                    <div className="av" style={{ background: 'linear-gradient(135deg,#7c5cff,#19d3ff)' }}>🚌</div>
                    <div style={{ flex: 1 }}>
                      <div className="nm">{x.from_name} ← {x.to_name}</div>
                      <div className="mt">
                        {x.best_minutes ? <b style={{ color: '#19d3ff' }}>{x.best_minutes} דק' </b> : 'לא נמצא מסלול '}
                        {x.best_start ? `· יציאה ${hhmm(x.best_start)} · הגעה ${hhmm(x.best_end)} ` : ''}
                        {x.best_summary ? `· ${x.best_summary} ` : ''}{x.options_count > 1 ? `· ${x.options_count} אפשרויות` : ''}
                      </div>
                      <div className="mt" style={{ opacity: 0.75 }}>{x.caller_name || fmtPhone(x.phone)} · {timeAgo(x.created_at)}{x.said ? ` · "${x.said}"` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
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
      <Voters api={api} />
    </>
  );
}

/* מי הצביע למי - לפי סבב (כולל סבבים קודמים שאופסו) */
function Voters({ api }) {
  const [round, setRound] = useState('');
  const [d, reload, err] = useLoad(() => api(`voting/voters${round ? '?round=' + round : ''}`), [api, round]);
  const [q, setQ] = useState('');
  const [cand, setCand] = useState('');
  const list = (d?.voters || [])
    .filter((v) => !cand || String(v.candidate_num) === cand)
    .filter((v) => !q || `${v.phone} ${v.voter_name} ${v.candidate_name}`.includes(q.trim()));
  const cands = [...new Map((d?.voters || []).map((v) => [v.candidate_num, v.candidate_name])).entries()].sort((a, b) => a[0] - b[0]);
  const csv = () => {
    const rows = [['זמן', 'טלפון', 'שם המצביע', 'מספר מתמודד', 'מתמודד'],
      ...list.map((v) => [new Date(v.created_at).toLocaleString('he-IL'), v.phone, v.voter_name, v.candidate_num, v.candidate_name])];
    const text = '\uFEFF' + rows.map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `votes-round-${d?.round || ''}.csv`;
    a.click();
  };
  return (
    <div className="card glass" style={{ marginTop: 16 }}>
      <div className="ch">
        <div><h3>מי הצביע למי</h3><p>{d ? `סבב ${d.round}${d.round === d.currentRound ? ' (נוכחי)' : ''} · ${list.length} קולות` : ''}</p></div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn ghost sm" onClick={reload}>רענון</button>
          <button className="btn sm" onClick={csv} disabled={!list.length}>הורדה לאקסל</button>
        </div>
      </div>
      {err ? <Empty text={err} /> : !d ? <Loading /> : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <select className="inp" style={{ width: 'auto' }} value={round || d.round} onChange={(e) => setRound(e.target.value)}>
              {(d.rounds.length ? d.rounds : [{ round: d.round, votes: 0 }]).map((r) => (
                <option key={r.round} value={r.round}>
                  סבב {r.round}{r.round === d.currentRound ? ' (נוכחי)' : ''} · {r.votes} קולות{r.last_at ? ` · ${new Date(r.last_at).toLocaleDateString('he-IL')}` : ''}
                </option>
              ))}
            </select>
            <select className="inp" style={{ width: 'auto' }} value={cand} onChange={(e) => setCand(e.target.value)}>
              <option value="">כל המתמודדים</option>
              {cands.map(([n, name]) => <option key={n} value={n}>{n}. {name}</option>)}
            </select>
            <input className="inp" style={{ flex: 1, minWidth: 180 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי טלפון או שם" />
          </div>
          {!list.length ? <Empty icon="🗳️" text="אין קולות בסבב הזה" /> : (
            <div className="rows" style={{ maxHeight: 480, overflowY: 'auto' }}>
              {list.map((v) => (
                <div className="row" key={v.phone}>
                  <div className="av">{v.candidate_num}</div>
                  <div style={{ flex: 1 }}>
                    <div className="nm">{v.voter_name || fmtPhone(v.phone)} → {v.candidate_name || `מתמודד ${v.candidate_num}`}</div>
                    <div className="mt">{v.voter_name ? fmtPhone(v.phone) + ' · ' : ''}{new Date(v.created_at).toLocaleString('he-IL')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ============================ מערכת ============================ */
const SRC = { news: 'חדשות', transit: 'תחבורה', podcast: 'פודקאסט', vote: 'הצבעה', 'vote-admin': 'ניהול הצבעה', 'ai-call': 'בוט AI', 'ai-busy': 'עומס AI', 'admin-api': 'אתר ניהול', cleanup: 'ניקוי', translate: 'תרגומון', setup: 'פתיחת מערכת', filter: 'סינון תכנים', 'voice-late': 'קול באיחור', 'voice-fail': 'קול נכשל', 'chirp-fail': 'Chirp נכשל', 'voice-pause': 'קול מושבת' };
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
          <div className="ch"><div><h3>שימוש בספקי AI היום</h3><p>כמה פעמים כל ספק עבד{u ? ` · ${u.geminiKeys || 0} מפתחות Gemini פעילים${u.groq ? ` · ${u.groq} מפתחות Groq` : ''}${u.tts?.keys ? ` · קול Chirp החודש: ${u.tts.chars.map((c, i) => `מפתח ${i + 1}: ${Math.round((c || 0) / 1000)} אלף תווים (${Math.round((u.tts.free || 0) / 1000)} אלף חינם)`).join(', ')}` : ''}${u.tts?.credit?.on ? ` · קרדיט Google Cloud: נוצלו ${u.tts.credit.spentUsd.toFixed(2)}$ מתוך ${u.tts.credit.capUsd}$` : ''}` : ''}</p></div></div>
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
