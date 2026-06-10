export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const db = env.DB;
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // 注册
    if (url.pathname === '/api/register' && request.method === 'POST') {
      const { qq, pwd, nickname } = await request.json();
      if (!/^\d{5,13}$/.test(qq)) return new Response(JSON.stringify({err:'QQ号格式错误'}),{headers:cors});
      const exists = await db.prepare('SELECT qq FROM users WHERE qq=?').bind(qq).first();
      if (exists) return new Response(JSON.stringify({err:'QQ已注册'}),{headers:cors});
      const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwd + '_salt'));
      const hash = [...new Uint8Array(hashBuf)].map(b=>b.toString(16).padStart(2,'0')).join('');
      await db.prepare('INSERT INTO users(qq,password_hash,nickname) VALUES(?,?,?)')
        .bind(qq, hash, nickname||qq).run();
      return new Response(JSON.stringify({ok:true}),{headers:cors});
    }

    // 登录
    if (url.pathname === '/api/login' && request.method === 'POST') {
      const { qq, pwd } = await request.json();
      const u = await db.prepare('SELECT * FROM users WHERE qq=?').bind(qq).first();
      if(!u) return new Response(JSON.stringify({err:'用户不存在'}),{headers:cors});
      const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwd+'_salt'));
      const hash = [...new Uint8Array(hashBuf)].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(u.password_hash!==hash) return new Response(JSON.stringify({err:'密码错误'}),{headers:cors});
      return new Response(JSON.stringify({ok:true,qq:u.qq,nickname:u.nickname}),{headers:cors});
    }

    // 修改昵称
    if (url.pathname === '/api/profile' && request.method === 'POST') {
      const { qq, pwd, nickname } = await request.json();
      const u = await db.prepare('SELECT * FROM users WHERE qq=?').bind(qq).first();
      if(!u) return new Response(JSON.stringify({err:'用户不存在'}),{headers:cors});
      const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwd+'_salt'));
      const hash = [...new Uint8Array(hashBuf)].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(u.password_hash!==hash) return new Response(JSON.stringify({err:'密码错误'}),{headers:cors});
      await db.prepare('UPDATE users SET nickname=? WHERE qq=?').bind(nickname,qq).run();
      return new Response(JSON.stringify({ok:true,nickname}),{headers:cors});
    }

    // 发消息
    if (url.pathname === '/api/send' && request.method === 'POST') {
      const { qq, nickname, content } = await request.json();
      await db.prepare('INSERT INTO messages(qq,nickname,content) VALUES(?,?,?)')
        .bind(qq, nickname, content.trim().slice(0,500)).run();
      return new Response(JSON.stringify({ok:true}),{headers:cors});
    }

    // 拉消息
    if (url.pathname === '/api/messages') {
      const msgs = await db.prepare(
        'SELECT * FROM messages ORDER BY id DESC LIMIT 50'
      ).all();
      return new Response(JSON.stringify(msgs.results.reverse()),{headers:cors});
    }

    // 返回前端页面
    return new Response(HTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  }
}

const HTML = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QQ群聊</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f0f2f5;display:flex;justify-content:center}
#app{width:100%;max-width:420px;height:100vh;display:flex;flex-direction:column;background:#fff}
header{padding:10px 12px;background:#0088ff;color:#fff;font-size:15px;display:flex;align-items:center;gap:8px}
header img{width:32px;height:32px;border-radius:50%}
#box{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px}
.msg{display:flex;gap:6px;align-items:flex-start}
.msg img{width:36px;height:36px;border-radius:50%;flex-shrink:0}
.bubble{max-width:75%;background:#f0f0f0;padding:6px 10px;border-radius:0 10px 10px 10px;font-size:14px}
.bubble .nm{font-size:12px;color:#0088ff;margin-bottom:2px}
input,button{font-size:14px;padding:8px 10px;border:1px solid #ddd;border-radius:6px}
button{background:#0088ff;color:#fff;border:none;cursor:pointer}
#login,#chat{display:none;flex-direction:column;flex:1}
#login{padding:20px;gap:10px}
#bar{display:flex;padding:8px 10px;gap:6px;border-top:1px solid #eee}
#bar input{flex:1}
#set{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;place-items:center}
#set>div{background:#fff;padding:18px;border-radius:10px;display:flex;flex-direction:column;gap:8px;width:90%;max-width:320px}
</style></head><body>
<div id="app">
 <div id="login">
  <h3 style="text-align:center">QQ号登录/注册</h3>
  <input id="iqq" placeholder="QQ号（纯数字）" inputmode="numeric">
  <input id="ipwd" type="password" placeholder="⚠️ 不要填真实QQ密码，仅作本网站登录用">
  <input id="iname" placeholder="自定义昵称（注册时填，登录时可不填）">
  <button onclick="reg()">注 册</button>
  <button onclick="login()">登 录</button>
  <div id="lerr" style="color:red;font-size:13px"></div>
 </div>
 <header id="hdr" style="display:none"><img id="himg"><span id="hnm"></span>
  <button style="margin-left:auto;font-size:12px;padding:4px 8px" onclick="showSet()">改昵称</button>
  <button style="font-size:12px;padding:4px 8px" onclick="logout()">退出</button>
 </header>
 <div id="box"></div>
 <div id="bar" style="display:none"><input id="itxt" placeholder="说点什么…" onkeydown="if(event.key==='Enter')send()"><button onclick="send()">发送</button></div>
</div>
<div id="set"><div>
  <h4>修改昵称（需验证密码）</h4>
  <input id="soldpwd" type="password" placeholder="当前密码">
  <input id="snewname" placeholder="新昵称">
  <button onclick="chgName()">保存</button>
  <button onclick="closeSet()">取消</button>
  <div id="serr" style="color:red;font-size:12px"></div>
</div></div>
<script>
const API=''; // 同域无需填
let _qq='',_nm='';
const $ = s=>document.querySelector(s);
function show(id){document.querySelectorAll('#login,#chat,#hdr,#bar').forEach(e=>e.style.display='none');$(id).style.display='flex'}
if(localStorage.qq) autoLogin(); else show('#login');

async function reg(){
 const qq=$('#iqq').value.trim(), pwd=$('#ipwd').value, nm=$('#iname').value.trim()||qq;
 if(!qq||!pwd) return $('#lerr').textContent='请填QQ号和密码';
 const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qq,pwd,nickname:nm})});
 const j=await r.json(); if(j.err) return $('#lerr').textContent=j.err;
 enter(qq,nm);
}
async function login(){
 const qq=$('#iqq').value.trim(), pwd=$('#ipwd').value;
 if(!qq||!pwd) return $('#lerr').textContent='请填QQ号和密码';
 const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qq,pwd})});
 const j=await r.json(); if(j.err) return $('#lerr').textContent=j.err;
 enter(j.qq,j.nickname);
}
function autoLogin(){ const qq=localStorage.qq,nm=localStorage.nm; if(qq) enter(qq,nm,false); }
function enter(qq,nm,save=true){
 _qq=qq;_nm=nm;
 if(save){localStorage.qq=qq;localStorage.nm=nm}
 $('#himg').src='https://q.qlogo.cn/headimg_dl?dst_uin='+qq+'&spec=100';
 $('#hnm').textContent=nm;
 $('#login').style.display='none'; $('#hdr').style.display='flex'; $('#bar').style.display='flex';
 load();
 setInterval(load,3000);
}
async function load(){
 const r=await fetch('/api/messages'), j=await r.json();
 $('#box').innerHTML=j.map(m=>`<div class="msg">
  <img src="https://q.qlogo.cn/headimg_dl?dst_uin=${m.qq}&spec=100" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22/>'">
  <div class="bubble"><div class="nm">${esc(m.nickname)}</div>${esc(m.content)}</div>
 </div>`).join('');
 $('#box').scrollTop=$('#box').scrollHeight;
}
async function send(){
 const t=$('#itxt').value.trim(); if(!t)return;
 await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qq:_qq,nickname:_nm,content:t})});
 $('#itxt').value=''; load();
}
function showSet(){$('#set').style.display='grid';$('#snewname').value=_nm}
function closeSet(){$('#set').style.display='none';$('#serr').textContent=''}
async function chgName(){
 const r=await fetch('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({qq:_qq,pwd:$('#soldpwd').value,nickname:$('#snewname').value.trim()||_nm})});
 const j=await r.json(); if(j.err) return $('#serr').textContent=j.err;
 _nm=j.nickname; localStorage.nm=_nm; $('#hnm').textContent=_nm; closeSet(); load();
}
function logout(){ localStorage.clear(); location.reload() }
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
</script></body></html>`;
