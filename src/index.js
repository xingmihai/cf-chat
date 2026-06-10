// 导入 HTML 文件内容
import indexHtml from './index.html';

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

  // ★ 先更新 users
  await db.prepare('UPDATE users SET nickname=? WHERE qq=?').bind(nickname,qq).run();
  // ★ 再同步更新历史消息昵称
  await db.prepare('UPDATE messages SET nickname=? WHERE qq=?').bind(nickname,qq).run();

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
    return new Response(indexHtml, { 
      headers: { 'Content-Type': 'text/html;charset=utf-8' } 
    });
  }
};
