import { scopes } from "./config.js";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? "",
  );
const labels: Record<string, string> = {
  "account:read": "读取账户昵称",
  "ips:read": "查看可用的已购 IP 和三图清单",
  "assets:download": "获取创作用图的短期下载链接",
};
export function connectPage(
  clientName: string,
  redirectUri: string,
  requested: string[],
  request: string,
) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>连接 NiegeIP · 账户授权</title><link rel="stylesheet" href="/connect.css"><script src="/connect.js" defer></script></head><body><main>
<header><a class="wordmark" href="/">NiegeIP<span>创作资产连接</span></a></header>
<section class="intro"><p class="eyebrow">你的 IP，进入新的创作</p><h1>连接你的<br>NiegeIP 资产</h1><p>登录并授权后，即可在当前应用中选择已购 IP，获取半身图、三视图和表情图。</p><div class="triptych" aria-label="三种创作用图"><span>半身图</span><span>三视图</span><span>表情图</span></div></section>
<section class="panel" aria-labelledby="connect-title"><h2 id="connect-title">授权给 ${escape(clientName)}</h2><p class="muted">回到应用：<strong>${escape(new URL(redirectUri).origin)}</strong></p><ul>${requested
    .filter((s) => scopes.includes(s))
    .map((s) => `<li>${escape(labels[s] ?? s)}</li>`)
    .join("")}</ul>
<form id="connect" novalidate><input type="hidden" name="request" value="${escape(request)}">
<label for="phone">NiegeIP 账户手机号</label><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" maxlength="11" aria-describedby="phone-error" required><p id="phone-error" class="field-error"></p>
<label for="code">短信验证码</label><div class="code-row"><input id="code" name="code" type="password" inputmode="numeric" autocomplete="one-time-code" maxlength="8" aria-describedby="code-error" required><button id="toggle-code" type="button" class="secondary" aria-pressed="false">显示</button><button id="sms" type="button" class="secondary">获取验证码</button></div><p id="code-error" class="field-error"></p>
<label class="consent"><input id="consent" type="checkbox" aria-describedby="consent-error">我同意向上述应用开放所列权限。</label><p id="consent-error" class="field-error"></p>
<p id="status" role="status" aria-live="polite"></p><button id="submit" type="submit">登录并授权</button><button id="deny" type="button" class="secondary full">取消连接</button></form>
<p class="footnote">仅提供已获准对外使用的素材。撤销连接将停止后续访问，已下载的文件无法收回。请仅在 NiegeIP 官方授权页面输入验证码。</p></section></main></body></html>`;
}
export const stylesheet = `:root{color-scheme:light;--ink:#141414;--muted:#686b73;--paper:#fff;--ground:#f6f7f9;--line:#eceef2;--blue:#345fce;--blue-hover:#294ea9;--danger:#b62132;--focus:#4b7dff;font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:var(--ink);background:var(--ground);scrollbar-color:var(--muted) var(--ground);scrollbar-width:thin}*{box-sizing:border-box}body{margin:0}main{max-width:1080px;margin:auto;padding:40px 32px 64px;display:grid;grid-template-columns:1fr 440px;gap:40px 64px}header{grid-column:1/-1}.wordmark{color:var(--ink);font-size:27px;font-weight:750;text-decoration:none;letter-spacing:-1px}.wordmark span{display:block;font-size:12px;font-weight:500;letter-spacing:2px;margin-top:8px;color:var(--muted)}h1{font-size:clamp(40px,5vw,64px);line-height:1.2;letter-spacing:-2px;margin:18px 0 28px}h2{font-size:23px;margin:0 0 10px;overflow-wrap:anywhere}.intro{padding-top:45px}.intro p{font-size:16px;line-height:1.8;max-width:360px}.eyebrow{color:var(--blue);font-weight:650}.triptych{display:flex;gap:10px;margin-top:44px}.triptych span{display:flex;align-items:end;border:1px solid var(--line);border-top:4px solid var(--blue);background:var(--paper);padding:16px 10px;height:110px;flex:1;font-size:14px;border-radius:8px;max-width:110px}.panel{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:28px}.muted,.footnote{color:var(--muted);font-size:13px;line-height:1.7;overflow-wrap:anywhere}ul{padding-left:22px;font-size:14px;line-height:1.9;margin:20px 0 26px}label{display:block;font-size:14px;margin-bottom:8px}input{font:inherit;min-width:0}input:not([type=checkbox],[type=hidden]){width:100%;height:46px;border:1px solid #a9adb6;border-radius:8px;padding:0 12px;background:var(--paper)}input[aria-invalid=true]{border-color:var(--danger)}.code-row{display:flex;gap:8px}.code-row input{flex:1;width:80px}button{border:0;border-radius:8px;min-height:44px;padding:0 14px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;background:var(--blue);color:var(--paper)}button:hover{background:var(--blue-hover)}button:active{transform:translateY(1px)}button:disabled{opacity:.55;cursor:wait}.secondary{color:var(--ink);background:var(--ground);border:1px solid var(--line)}.secondary:hover{background:var(--line)}#submit,.full{width:100%}.full{margin-top:10px}.consent{display:flex;align-items:flex-start;gap:8px;line-height:1.7}.consent input{width:18px;height:18px;flex-shrink:0;margin:3px 0}.field-error{min-height:20px;line-height:20px;font-size:12px;margin:4px 0 10px;color:var(--danger)}#status{min-height:44px;font-size:13px;line-height:1.6;color:var(--muted);margin:0 0 10px}#status[data-error=true]{color:var(--danger)}:focus-visible{outline:3px solid var(--focus);outline-offset:3px}.footnote{margin-bottom:0}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:var(--ground)}::-webkit-scrollbar-thumb{background:var(--muted);border:2px solid var(--ground);border-radius:6px}@media(max-width:760px){main{grid-template-columns:1fr;padding:24px 18px;gap:24px}.intro{padding:0}h1{font-size:36px;letter-spacing:-1px;margin:10px 0}.intro p:not(.eyebrow),.triptych{display:none}.panel{padding:22px}.code-row{gap:6px}.code-row button{padding:0 9px;font-size:13px}}`;
export const browserScript = `'use strict';
const form=document.querySelector('#connect'),status=document.querySelector('#status'),phone=document.querySelector('#phone'),code=document.querySelector('#code'),consent=document.querySelector('#consent');
let busy=false,cooldown=0;
const buttons=[...form.querySelectorAll('button')];
function update(){buttons.forEach(b=>b.disabled=busy);document.querySelector('#sms').disabled=busy||cooldown>0;form.setAttribute('aria-busy',String(busy));}
function message(text,error=false){status.textContent=text;status.dataset.error=String(error);}
function invalid(field,text){field.setAttribute('aria-invalid',text?'true':'false');document.querySelector('#'+field.id+'-error').textContent=text;if(text)field.focus();return !!text;}
function phoneValid(){return !invalid(phone,/^1[3-9][0-9]{9}$/.test(phone.value.trim())?'':'请输入 11 位中国大陆手机号。');}
async function post(path,data){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request:form.elements.request.value,...data}),signal:AbortSignal.timeout(20000)});const result=await response.json();if(!response.ok)throw new Error(result.message||'请求失败，请重试。');return result;}
async function run(task){if(busy)return;busy=true;update();message('正在处理，请稍候…');try{await task();}catch(e){message(e.name==='TimeoutError'?'请求超时，请返回应用检查连接状态后重试。':e.message||'网络连接失败，请稍后重试。',true);}finally{busy=false;update();}}
document.querySelector('#toggle-code').addEventListener('click',e=>{const show=code.type==='password';code.type=show?'text':'password';e.currentTarget.textContent=show?'隐藏':'显示';e.currentTarget.setAttribute('aria-pressed',String(show));});
document.querySelector('#sms').addEventListener('click',()=>{if(!phoneValid())return;run(async()=>{await post('/connect/sms',{phone:phone.value.trim()});message('验证码已发送，请查看短信。');cooldown=60;const button=document.querySelector('#sms');button.textContent='60 秒后重发';const timer=setInterval(()=>{cooldown--;button.textContent=cooldown>0?cooldown+' 秒后重发':'获取验证码';update();if(!cooldown)clearInterval(timer);},1000);code.focus();});});
form.addEventListener('submit',e=>{e.preventDefault();if(!phoneValid())return;if(invalid(code,/^[0-9]{4,8}$/.test(code.value)?'':'请输入短信中的验证码。'))return;if(invalid(consent,consent.checked?'':'请确认是否同意向此应用开放所列权限。'))return;run(async()=>{const result=await post('/connect/complete',{phone:phone.value.trim(),code:code.value,consent:true});code.value='';message('授权完成，正在返回应用…');location.assign(result.redirect);});});
document.querySelector('#deny').addEventListener('click',()=>run(async()=>{const result=await post('/connect/deny',{});location.assign(result.redirect);}));
`;
