export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- API ----
    if (path === '/api/send-code' && request.method === 'POST') {
      const { email } = await request.json();
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.KV.put('code:' + email, code, { expirationTtl: 300 });
      console.log(`LOGIN CODE for ${email}: ${code}`); // 替换为真实邮件发送
      return new Response(JSON.stringify({ ok: true }));
    }

    if (path === '/api/login' && request.method === 'POST') {
      const { email, code, nickname, qq } = await request.json();
      const saved = await env.KV.get('code:' + email);
      if (saved !== code) return new Response(JSON.stringify({ err: '验证码错误' }), { status: 400 });

      let user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
      let isNew = false;
      if (!user) {
        const isFirst = !(await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first());
        const result = await env.DB.prepare(
          'INSERT INTO users(email,nickname,qq,is_admin) VALUES(?,?,?,?)'
        ).bind(email, nickname || email.split('@')[0], qq || '', isFirst ? 1 : 0).run();
        user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
        isNew = true;
      }
      const token = btoa(JSON.stringify({ uid: user.id, email: user.email }));
      return new Response(JSON.stringify({
        token,
        user: { ...user, is_admin: !!user.is_admin }
      }));
    }

    // 解析token中间件
    const auth = (req) => {
      const h = req.headers.get('Authorization') || '';
      try { return JSON.parse(atob(h.replace('Bearer ', ''))); } catch { return null; }
    };

    if (path === '/api/announce') {
      const row = await env.DB.prepare("SELECT value FROM config WHERE key='announcement'").first();
      return new Response(JSON.stringify({ announcement: row?.value || '' }));
    }

    if (path === '/api/announce' && request.method === 'POST') {
      const me = auth(request);
      if (!me) return new Response('', { status: 401 });
      const u = await env.DB.prepare('SELECT is_admin FROM users WHERE id=?').bind(me.uid).first();
      if (!u?.is_admin) return new Response('', { status: 403 });
      const { announcement } = await request.json();
      await env.DB.prepare("UPDATE config SET value=? WHERE key='announcement'").bind(announcement).run();
      return new Response(JSON.stringify({ ok: true }));
    }

    if (path === '/api/msgs') {
      const msgs = await env.DB.prepare(
        'SELECT m.*, u.qq FROM messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 200'
      ).all();
      return new Response(JSON.stringify(msgs.results.reverse()));
    }

    if (path === '/api/msgs' && request.method === 'POST') {
      const me = auth(request);
      if (!me) return new Response('请登录', { status: 401 });
      const { content } = await request.json();
      const u = await env.DB.prepare('SELECT nickname,qq FROM users WHERE id=?').bind(me.uid).first();
      const avatar = u.qq ? `http://q.qlogo.cn/headimg/${u.qq}/100` : '';
      await env.DB.prepare(
        'INSERT INTO messages(user_id,nickname,avatar,content) VALUES(?,?,?,?)'
      ).bind(me.uid, u.nickname, avatar, content.trim()).run();
      return new Response(JSON.stringify({ ok: true }));
    }

    if (path.startsWith('/api/msg/') && request.method === 'DELETE') {
      const me = auth(request);
      if (!me) return new Response('', { status: 401 });
      const u = await env.DB.prepare('SELECT is_admin FROM users WHERE id=?').bind(me.uid).first();
      if (!u?.is_admin) return new Response('', { status: 403 });
      const msgId = path.split('/')[3];
      await env.DB.prepare('DELETE FROM messages WHERE id=?').bind(msgId).run();
      return new Response(JSON.stringify({ ok: true }));
    }

    if (path === '/api/me') {
      const me = auth(request);
      if (!me) return new Response(JSON.stringify({}));
      const u = await env.DB.prepare('SELECT id,email,nickname,qq,is_admin FROM users WHERE id=?').bind(me.uid).first();
      return new Response(JSON.stringify(u ? { ...u, is_admin: !!u.is_admin } : {}));
    }

    // ---- SPA HTML ----
    return new Response(HTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
  }
};

// ======================= SPA =======================
const HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>邮箱聊天室</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font:14px/1.6 sans-serif;background:#f5f7fa;display:flex;flex-direction:column;height:100vh}
#banner{background:#fffbdd;border-bottom:1px solid #e6d96b;padding:6px 12px;font-size:13px;color:#7a6300;cursor:pointer}
#login-wrap{margin:auto;background:#fff;padding:24px 28px;border-radius:8px;box-shadow:0 2px 12px #0001;width:340px}
#login-wrap h2{margin-bottom:12px} #login-wrap input,#login-wrap button{width:100%;margin:6px 0;padding:8px}
button{cursor:pointer;border:none;border-radius:4px;background:#4f6ef7;color:#fff;font-size:14px}
button.secondary{background:#aaa}
#app{flex:1;display:none;flex-direction:column;max-width:720px;margin:0 auto;width:100%}
#chat{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:6px}
.msg{display:flex;gap:8px;align-items:flex-start}
.msg img{width:36px;height:36px;border-radius:50%}
.msg .body{flex:1}
.msg .meta{font-size:12px;color:#888}
.msg .del{color:#f44;cursor:pointer;font-size:12px;margin-left:4px}
#input-bar{display:flex;gap:6px;padding:8px 12px;border-top:1px solid #ddd;background:#fff}
#input-bar input{flex:1;padding:8px}
#userbar{padding:4px 12px;font-size:12px;color:#666;border-bottom:1px solid #eee;background:#fff;display:flex;justify-content:space-between}
</style></head><body>
<div id="banner">加载公告...</div>
<div id="login-wrap">
 <h2>邮箱登录/注册</h2>
 <input id="lemail" placeholder="邮箱">
 <input id="lnick" placeholder="昵称（首次注册填）">
 <input id="lqq" placeholder="QQ号（可选，用于头像）">
 <button onclick="sendCode()">发送验证码</button>
 <input id="lcode" placeholder="6位验证码">
 <button onclick="doLogin()">登录 / 注册</button>
 <p id="lerr" style="color:red;font-size:12px"></p>
</div>
<div id="app">
 <div id="userbar"><span id="uname"></span><a href="#" class="secondary" onclick="logout()">退出</a></div>
 <div id="chat"></div>
 <div id="input-bar">
  <input id="txt" placeholder="按Enter发送…" onkeydown="if(event.key==='Enter')sendMsg()">
  <button onclick="sendMsg()">发送</button>
 </div>
</div>
<script>
let token='',me={},pollTimer;
const $=(s)=>document.querySelector(s);
async function api(path,opt={}){
 const h={'Content-Type':'application/json'};
 if(token)h['Authorization']='Bearer '+token;
 const r=await fetch(path,{...opt,headers:h});
 return r.json();
}
async function sendCode(){
 const email=$('#lemail').value.trim();
 if(!email)return;$('#lerr').textContent='发送中…';
 await api('/api/send-code',{method:'POST',body:JSON.stringify({email})});
 $('#lerr').textContent='验证码已发送（查看Worker日志）';
}
async function doLogin(){
 const email=$('#lemail').value.trim(),code=$('#lcode').value.trim();
 const nick=$('#lnick').value.trim(),qq=$('#lqq').value.trim();
 const r=await api('/api/login',{method:'POST',body:JSON.stringify({email,code,nickname:nick,qq})});
 if(r.err){$('#lerr').textContent=r.err;return}
 token=r.token;me=r.user;sessionStorage.setItem('tk',token);
 showApp();
}
function logout(){sessionStorage.removeItem('tk');location.reload()}
function showApp(){
 if(me.is_admin)$('#banner').ondblclick=editAnnounce;
 $('#login-wrap').style.display='none';$('#app').style.display='flex';
 $('#uname').textContent=me.nickname+(me.is_admin?' 👑':'');
 loadMsgs();pollTimer=setInterval(loadMsgs,3000);
}
async function loadMsgs(){
 const msgs=await api('/api/msgs');
 $('#chat').innerHTML=msgs.map(m=>`
  <div class="msg">
   <img src="${m.avatar||'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'}">
   <div class="body">
    <div><b>${esc(m.nickname)}</b> <span class="meta">${m.created_at}</span>
     ${me.is_admin?`<span class="del" onclick="delMsg(${m.id})">删除</span>`:''}</div>
    <div>${esc(m.content)}</div>
   </div>
  </div>`).join('');
 $('#chat').scrollTop=$('#chat').scrollHeight;
}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;')}
async function sendMsg(){
 const v=$('#txt').value.trim();if(!v)return;
 await api('/api/msgs',{method:'POST',body:JSON.stringify({content:v})});
 $('#txt').value='';loadMsgs();
}
async function delMsg(id){if(confirm('删除？')){await api('/api/msg/'+id,{method:'DELETE'});loadMsgs()}}
async function editAnnounce(){
 const v=prompt('修改公告',(await api('/api/announce')).announcement);
 if(v!==null)await api('/api/announce',{method:'POST',body:JSON.stringify({announcement:v})}),loadAnnounce();
}
async function loadAnnounce(){
 const r=await api('/api/announce');
 $('#banner').textContent=r.announcement||'暂无公告';
}
// init
(async()=>{
 loadAnnounce();
 token=sessionStorage.getItem('tk');
 if(token){
  me=await api('/api/me');
  if(me.id)showApp();else sessionStorage.removeItem('tk'),token='';
 }
})();
</script></body></html>`;
