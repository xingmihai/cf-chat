import indexHtml from './index.html';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const db = env.DB;
    const cors = { 
      'Access-Control-Allow-Origin': '*', 
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // 1. 获取公告
    if (url.pathname === '/api/announcement') {
      const ann = await db.prepare('SELECT content FROM announcements WHERE id=1').first();
      return new Response(JSON.stringify({ content: ann ? ann.content : '暂无公告' }), { headers: cors });
    }

    // 2. 修改公告（仅管理员）
    if (url.pathname === '/api/setannouncement' && request.method === 'POST') {
      const { qq, content } = await request.json();
      const admin = await db.prepare('SELECT qq FROM admins WHERE qq=?').bind(qq).first();
      if (!admin) return new Response(JSON.stringify({ err: '你不是管理员' }), { headers: cors });
      
      await db.prepare('INSERT OR REPLACE INTO announcements (id, content) VALUES (1, ?)').bind(content).run();
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    // 3. 删除消息（仅管理员）
    if (url.pathname === '/api/delmsg' && request.method === 'POST') {
      const { qq, msgId } = await request.json();
      const admin = await db.prepare('SELECT qq FROM admins WHERE qq=?').bind(qq).first();
      if (!admin) return new Response(JSON.stringify({ err: '你不是管理员' }), { headers: cors });
      await db.prepare('DELETE FROM messages WHERE id=?').bind(msgId).run();
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    // 4. 获取在线人数
    if (url.pathname === '/api/online') {
      const online = await db.prepare('SELECT COUNT(*) as c FROM users WHERE last_active > ?').bind(Date.now() / 1000 - 300).first();
      return new Response(JSON.stringify({ count: online.c || 0 }), { headers: cors });
    }

    // 5. 注册/登录
    if (url.pathname === '/api/register' && request.method === 'POST') {
      const { qq, pwd, nickname } = await request.json();
      if (!/^\d{5,13}$/.test(qq)) return new Response(JSON.stringify({ err: 'QQ号格式错误' }), { headers: cors });
      
      const exists = await db.prepare('SELECT qq FROM users WHERE qq=?').bind(qq).first();
      if (exists) {
        await db.prepare('UPDATE users SET last_active=? WHERE qq=?').bind(Date.now() / 1000, qq).run();
      } else {
        await db.prepare('INSERT INTO users (qq, pwd, nickname, last_active) VALUES (?, ?, ?, ?)').bind(qq, pwd, nickname || `用户${qq}`, Date.now() / 1000).run();
      }
      return new Response(JSON.stringify({ ok: true, qq }), { headers: cors });
    }

    // 6. 发送消息
    if (url.pathname === '/api/send' && request.method === 'POST') {
      const { qq, nickname, text } = await request.json();
      if (!text.trim()) return new Response(JSON.stringify({ err: '内容不能为空' }), { headers: cors });
      
      const now = Date.now();
      await db.prepare('INSERT INTO messages (qq, nickname, text, time) VALUES (?, ?, ?, ?)').bind(qq, nickname, text, now).run();
      await db.prepare('UPDATE users SET last_active=? WHERE qq=?').bind(now / 1000, qq).run();
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    // 7. 获取历史消息
    if (url.pathname === '/api/history') {
      const list = await db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 50').all();
      return new Response(JSON.stringify(list.results.reverse()), { headers: cors });
    }

    // 返回前端页面
    return new Response(indexHtml, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
};
