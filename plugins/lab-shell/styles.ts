/** Prompt Lab's look, from the mockup: a soft lavender lab surface, purple controls, a paper-like editor and output cards. Light, with dark following the system. */
export const STYLES = `*{box-sizing:border-box}html,body{margin:0;min-height:100%}
:root{--ink:#222532;--muted:#7d8194;--faint:#a09cac;--line:#e4e2ec;--violet:#7356d8;--violet-ink:#6547c3;--violet-soft:#ece6ff;--page:#f6f5fa;--rail:#f0eff6;--paper:#fff;--selected:#e3def5;--top:#201c32;--top-ink:#f1efff;--top-muted:#aaa6be;--green:#2c9c74;--green-soft:#e2f4ec;--red:#c2483d;--red-soft:#fbeae8;--amber:#a86f00;--amber-soft:#fbf1da;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--ink:#ebe9f5;--muted:#a19db5;--faint:#7c7892;--line:#322e45;--violet:#a48bf0;--violet-ink:#c4b4fa;--violet-soft:#2e2748;--page:#15131f;--rail:#1b1827;--paper:#201d2e;--selected:#2e2748;--top:#100e18;--green:#62cfa4;--green-soft:#17352a;--red:#f0897e;--red-soft:#3a1f1d;--amber:#e6b552;--amber-soft:#35290f;color-scheme:dark}}
body{font:13px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--page);color:var(--ink)}
a{color:inherit;text-decoration:none}button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer}
:focus-visible{outline:2px solid var(--violet);outline-offset:1px}
.kicker{font:750 10px ui-monospace,monospace;letter-spacing:.1em;color:var(--faint);text-transform:uppercase}
.top{min-height:55px;background:var(--top);color:var(--top-ink);display:flex;align-items:center;flex-wrap:wrap;gap:8px 28px;padding:8px 20px}
.logo{font-weight:800;font-size:16px;letter-spacing:-.02em}.logo span{color:#b69dfb;font-size:19px;margin-right:5px}
.project{font-size:12px;color:var(--top-muted)}.project b{color:#eeebf8;margin-left:8px}
.top nav{display:flex;gap:4px}.top nav a{padding:6px 10px;border-radius:6px;color:var(--top-muted);font-size:12px}.top nav a:hover{color:var(--top-ink)}.top nav a.on{background:#3a3354;color:var(--top-ink);font-weight:700}
.meta{margin-left:auto;display:flex;align-items:center;gap:18px}.meta>span{font:10px ui-monospace,monospace;color:#83c8a7;letter-spacing:.04em}
.avatar{width:30px;height:30px;border-radius:50%;background:#544c70;color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700}
.layout{display:grid;grid-template-columns:262px minmax(0,1fr) 368px;max-width:1680px;margin:auto;min-height:calc(100vh - 55px)}
.layout.single{grid-template-columns:minmax(0,1fr);max-width:1080px}
.library{background:var(--rail);border-right:1px solid var(--line);padding:18px 14px}
.lib-head{display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:750}
.lib-head a{background:var(--paper);border:1px solid var(--line);border-radius:6px;color:var(--violet-ink);padding:1px 11px;font-size:15px}
.search{display:flex;margin:14px 0}.search input{width:100%;border:1px solid var(--line);background:var(--paper);border-radius:6px;padding:9px 10px}
.filter{display:flex;justify-content:space-between;padding:8px}
.library article a{display:block;padding:11px 10px;border-radius:6px;border-left:2px solid transparent;margin-bottom:3px}.library article a:hover{background:var(--selected)}
.library article a.on{background:var(--selected);border-left-color:var(--violet)}
.library article b{display:block;font-size:13px}.library article small{display:block;color:var(--muted);font-size:11px;margin-top:3px}
.empty{color:var(--muted);padding:16px 8px}
.tags{border-top:1px solid var(--line);margin-top:22px;padding:14px 8px}.tags a{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;padding:4px 0}.tags a.on,.tags a:hover{color:var(--violet-ink)}
.work{padding:18px 24px;min-width:0}
.title{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.title h1{font-size:24px;letter-spacing:-.02em;margin:3px 0}.title p{color:var(--muted);margin:0}
.btn{display:inline-block;background:var(--paper);border:1px solid var(--line);border-radius:6px;padding:8px 12px;font-size:12px;color:var(--violet-ink);white-space:nowrap}.btn:hover{border-color:var(--violet)}
.btn.primary{background:var(--violet);border-color:var(--violet);color:#fff;font-weight:700}.btn.danger{color:var(--red)}.btn.small{padding:5px 8px;font-size:11px}
@media (prefers-color-scheme:dark){.btn.primary{color:#15131f}}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.tabs{display:flex;gap:20px;border-bottom:1px solid var(--line);margin-top:13px}.tabs a{padding:0 0 9px;font-size:12px;color:var(--muted);border-bottom:2px solid transparent}.tabs a.on{border-color:var(--violet);color:var(--violet-ink);font-weight:750}
.notice{margin:12px 0 0;padding:9px 12px;border-radius:6px;font-size:12px}.notice.ok{background:var(--green-soft);color:var(--green)}.notice.error{background:var(--red-soft);color:var(--red)}.notice.warn{background:var(--amber-soft);color:var(--amber)}
.field-head{display:flex;justify-content:space-between;align-items:flex-end;margin-top:13px}.field-head b{display:block;font-size:13px}.field-head small{display:block;color:var(--muted);font-size:11px}
.token{font:11px ui-monospace,monospace;color:var(--faint)}.token.warn{color:var(--amber)}.token.over{color:var(--red)}
textarea.paper{display:block;width:100%;border:1px solid var(--line);background:var(--paper);border-radius:7px;padding:12px 14px;line-height:1.6;margin-top:6px;resize:vertical}
.chips{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}.chips code{background:var(--violet-soft);color:var(--violet-ink);padding:2px 6px;border-radius:4px;font-size:11px}
.vars{margin-top:12px}.vars>div{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:9px;margin-top:8px}.vars label{display:block}
input.field,select.field{display:block;width:100%;margin-top:5px;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:6px;padding:8px 10px;font:400 13px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0;text-transform:none}
input.field[aria-invalid=true]{border-color:var(--amber)}
.modelbar{display:flex;align-items:flex-end;flex-wrap:wrap;gap:10px;border-top:1px solid var(--line);margin-top:12px;padding-top:10px}.modelbar>.kicker{width:100%}.modelbar label{font-size:11px;color:var(--muted);min-width:150px}.modelbar label.narrow{min-width:80px;width:80px}.modelbar .go{margin-left:auto}
.results{background:var(--rail);border-left:1px solid var(--line);padding:18px 15px;min-width:0}
.results-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:13px;font-size:14px;font-weight:750}.results-head span{font-size:11px;color:var(--muted);font-weight:400}
.card{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:13px;margin-bottom:11px}.card.won{border-color:var(--violet)}
.card header{display:flex;align-items:center;gap:8px}.card header b{width:23px;height:23px;display:grid;place-items:center;background:var(--violet-soft);color:var(--violet-ink);border-radius:5px}.card header span{font-weight:750;font-size:12px}.card header i{font:11px ui-monospace,monospace;color:var(--faint);margin-left:auto;font-style:normal}
.output h3{font-size:17px;margin:13px 0 6px}.output p,.output li{font-size:12px;line-height:1.6;color:var(--muted);overflow-wrap:anywhere}.output ul{padding-left:18px}
.card footer{display:flex;justify-content:space-between;align-items:center;gap:8px;border-top:1px solid var(--line);padding-top:9px;margin-top:10px;color:var(--faint);font:11px ui-monospace,monospace}
.card footer button{font-family:inherit}
.pending{color:var(--violet-ink);padding:18px 0}.failed{color:var(--red);padding:12px 0 2px;overflow-wrap:anywhere}
.quick{border:1px dashed var(--line);background:var(--page);border-radius:7px;padding:12px}.quick p{margin:6px 0 9px;color:var(--muted);font-size:12px}
.history{list-style:none;padding:0;margin:14px 0 0}.history li{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line)}.history small{display:block;color:var(--muted)}
table{width:100%;border-collapse:collapse;margin-top:12px;background:var(--paper);border:1px solid var(--line);border-radius:8px}th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);font-size:12px;vertical-align:top}th{font:750 10px ui-monospace,monospace;letter-spacing:.08em;color:var(--faint);text-transform:uppercase}
.scroll{overflow-x:auto}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:16px}.stats div{background:var(--paper);border:1px solid var(--line);border-radius:7px;padding:10px}.stats strong{display:block;font-size:15px;margin-top:3px}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-top:16px}.panel h1{font-size:18px;margin:0 0 8px}.panel h2{font-size:14px;margin:0 0 8px}.panel pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:12px/1.6 ui-monospace,monospace;color:var(--muted)}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;align-items:end}.row label{font-size:11px;color:var(--muted)}
.badge{display:inline-block;padding:2px 7px;border-radius:9px;font-size:11px;background:var(--green-soft);color:var(--green)}.badge.off{background:var(--amber-soft);color:var(--amber)}
details.more{margin-top:10px}details.more summary{cursor:pointer;color:var(--muted);font-size:12px}
.foot{margin-top:24px;font-size:12px;color:var(--muted)}
@media(max-width:1100px){.layout{grid-template-columns:220px minmax(0,1fr)}.results{grid-column:1/-1;border-left:0;border-top:1px solid var(--line)}}
@media(max-width:750px){.layout{grid-template-columns:minmax(0,1fr)}.library{border-right:0;border-bottom:1px solid var(--line);max-height:260px;overflow-y:auto}.results{grid-column:auto}.work{padding:18px 16px}.title{flex-direction:column}.meta>span,.project{display:none}.modelbar .go{margin-left:0;width:100%}.modelbar label{flex:1}}`
