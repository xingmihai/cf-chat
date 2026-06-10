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
      await db.prepare('UPDATE users SET nickname=? WHERE qq=?').bind(nickname,qq).run();
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
        'SELECT * FROM messages ORDER BY id DESC LIMIT 58'
      ).all();
      return new Response(JSON.stringify(msgs.results.reverse()),{headers:cors});
    }

    // 心跳
    if (url.pathname === '/api/heartbeat' && request.method === 'POST') {
      const { qq } = await request.json();
      const now = Math.floor(Date.now() / 1000);
      await db.prepare('INSERT OR REPLACE INTO online_users(qq,last_seen) VALUES(?,?)')
        .bind(qq, now).run();
      return new Response(JSON.stringify({ok:true}),{headers:cors});
    }

    // 在线人数
    if (url.pathname === '/api/online') {
      const cutoff = Math.floor(Date.now() / 1000) - 96;
      await db.prepare('DELETE FROM online_users WHERE last_seen < ?').bind(cutoff).run();
      const result = await db.prepare('SELECT COUNT(*) as count FROM online_users').first();
      return new Response(JSON.stringify({count: result.count}),{headers:cors});
    }

    // 获取公告
    if (url.pathname === '/api/announcement') {
      const ann = await db.prepare('SELECT content FROM announcements WHERE id=1').first();
      return new Response(JSON.stringify({content: ann ? ann.content : ''}),{headers:cors});
    }

    // 修改公告（仅管理员）
    if (url.pathname === '/api/setannouncement' && request.method === 'POST') {
      const { qq, content } = await request.json();
      const admin = await db.prepare('SELECT qq FROM admins WHERE qq=?').bind(qq).first();
      if (!admin) return new Response(JSON.stringify({err:'你不是管理员'}),{headers:cors});
      const now = Math.floor(Date.now() / 1000);
      await db.prepare('UPDATE announcements SET content=?, updated_at=? WHERE id=1')
        .bind(content.trim().slice(0,500), now).run();
      return new Response(JSON.stringify({ok:true}),{headers:cors});
    }

    // 检查是否是管理员
    if (url.pathname === '/api/checkadmin' && request.method === 'POST') {
      const { qq } = await request.json();
      const admin = await db.prepare('SELECT qq FROM admins WHERE qq=?').bind(qq).first();
      return new Response(JSON.stringify({admin: !!admin}),{headers:cors});
    }

    // 删除消息（仅管理员）
    if (url.pathname === '/api/delmsg' && request.method === 'POST') {
      const { qq, msgId } = await request.json();
      const admin = await db.prepare('SELECT qq FROM admins WHERE qq=?').bind(qq).first();
      if (!admin) return new Response(JSON.stringify({err:'你不是管理员'}),{headers:cors});
      await db.prepare('DELETE FROM messages WHERE id=?').bind(msgId).run();
      return new Response(JSON.stringify({ok:true}),{headers:cors});
    }

    // 返回前端页面
    return new Response(indexHtml, { 
      headers: { 'Content-Type': 'text/html;charset=utf-8' } 
    });
  }
};
