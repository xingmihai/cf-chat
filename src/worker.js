import template from './template.html';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- API ----
    if (path === '/api/send-code' && request.method === 'POST') {
      const { email } = await request.json();
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.KV.put('code:' + email, code, { expirationTtl: 300 });
      console.log(`LOGIN CODE for ${email}: ${code}`);
      return new Response(JSON.stringify({ ok: true }));
    }

    if (path === '/api/login' && request.method === 'POST') {
      const { email, code, nickname, qq } = await request.json();
      const saved = await env.KV.get('code:' + email);
      if (saved !== code) {
        return new Response(JSON.stringify({ err: '验证码错误' }), { status: 400 });
      }

      let user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
      
      if (!user) {
        const firstUser = await env.DB.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').first();
        const isAdmin = !firstUser;
        
        await env.DB.prepare(
          'INSERT INTO users(email, nickname, qq, is_admin) VALUES(?, ?, ?, ?)'
        ).bind(email, nickname || email.split('@')[0], qq || '', isAdmin ? 1 : 0).run();
        
        user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
      }
      
      const token = btoa(JSON.stringify({ uid: user.id, email: user.email }));
      return new Response(JSON.stringify({
        token,
        user: { 
          id: user.id, 
          email: user.email, 
          nickname: user.nickname, 
          qq: user.qq, 
          is_admin: !!user.is_admin 
        }
      }));
    }

    // 解析token
    const getUserFromToken = (request) => {
      const authHeader = request.headers.get('Authorization') || '';
      try {
        const payload = JSON.parse(atob(authHeader.replace('Bearer ', '')));
        return payload;
      } catch {
        return null;
      }
    };

    if (path === '/api/announce' && request.method === 'GET') {
      const row = await env.DB.prepare("SELECT value FROM config WHERE key='announcement'").first();
      return new Response(JSON.stringify({ announcement: row?.value || '' }));
    }

    if (path === '/api/announce' && request.method === 'POST') {
      const tokenData = getUserFromToken(request);
      if (!tokenData) return new Response('Unauthorized', { status: 401 });
      
      const user = await env.DB.prepare('SELECT is_admin FROM users WHERE id=?').bind(tokenData.uid).first();
      if (!user?.is_admin) return new Response('Forbidden', { status: 403 });
      
      const { announcement } = await request.json();
      await env.DB.prepare("UPDATE config SET value=? WHERE key='announcement'").bind(announcement).run();
      return new Response(JSON.stringify({ ok: true }));
    }

    if (path === '/api/msgs' && request.method === 'GET') {
      const msgs = await env.DB.prepare(
        'SELECT m.*, u.qq FROM messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 200'
      ).all();
      return new Response(JSON.stringify(msgs.results.reverse()));
    }

    if (path === '/api/msgs' && request.method === 'POST') {
      const tokenData = getUserFromToken(request);
      if (!tokenData) return new Response('请先登录', { status: 401 });
      
      const { content } = await request.json();
      if (!content || !content.trim()) {
        return new Response(JSON.stringify({ err: '内容不能为空' }), { status: 400 });
      }
      
      const user = await env.DB.prepare('SELECT nickname, qq FROM users WHERE id=?').bind(tokenData.uid).first();
      const avatar = user.qq ? `http://q.qlogo.cn/headimg/${user.qq}/100` : '';
      
      await env.DB.prepare(
        'INSERT INTO messages(user_id, nickname, avatar, content) VALUES(?, ?, ?, ?)'
      ).bind(tokenData.uid, user.nickname, avatar, content.trim()).run();
      
      return new Response(JSON.stringify({ ok: true }));
    }

    if (path.startsWith('/api/msg/') && request.method === 'DELETE') {
      const tokenData = getUserFromToken(request);
      if (!tokenData) return new Response('Unauthorized', { status: 401 });
      
      const user = await env.DB.prepare('SELECT is_admin FROM users WHERE id=?').bind(tokenData.uid).first();
      if (!user?.is_admin) return new Response('Forbidden', { status: 403 });
      
      const msgId = path.split('/')[3];
      await env.DB.prepare('DELETE FROM messages WHERE id=?').bind(msgId).run();
      return new Response(JSON.stringify({ ok: true }));
    }

    if (path === '/api/me') {
      const tokenData = getUserFromToken(request);
      if (!tokenData) return new Response(JSON.stringify({}));
      
      const user = await env.DB.prepare('SELECT id, email, nickname, qq, is_admin FROM users WHERE id=?').bind(tokenData.uid).first();
      return new Response(JSON.stringify(user ? { ...user, is_admin: !!user.is_admin } : {}));
    }

    // ---- 返回 SPA HTML ----
    return new Response(template, { 
      headers: { 'Content-Type': 'text/html;charset=utf-8' } 
    });
  }
};
