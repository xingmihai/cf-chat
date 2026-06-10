import template from './template.html';

async function sendEmail(env, to, code) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: '聊天室 <onboarding@resend.dev>',
      to: [to],
      subject: '聊天室登录验证码',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
          <h2 style="color:#4f6ef7">🔐 聊天室登录验证码</h2>
          <p>您好！</p>
          <p>您正在登录聊天室，验证码如下：</p>
          <div style="font-size:36px;letter-spacing:8px;font-weight:bold;color:#333;background:#f0f4ff;padding:16px 24px;text-align:center;border-radius:8px;margin:20px 0">
            ${code}
          </div>
          <p style="color:#999;font-size:13px">验证码 5 分钟内有效，请勿泄露给他人。</p>
          <p style="color:#999;font-size:12px">如果不是您本人操作，请忽略此邮件。</p>
        </div>
      `
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- 发送验证码 ----
    if (path === '/api/send-code' && request.method === 'POST') {
  const { email } = await request.json();
  
  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ err: '请输入有效的邮箱地址' }), { status: 400 });
  }
  
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await env.KV.put('code:' + email, code, { expirationTtl: 300 });
  
  try {
    await sendEmail(env, email, code);
    return new Response(JSON.stringify({ ok: true, message: '验证码已发送到邮箱' }));
  } catch (err) {
    console.error('邮件发送失败:', err);
    return new Response(JSON.stringify({ err: '邮件发送失败，请稍后重试' }), { status: 500 });
  }
}

    // ---- 登录 ----
    if (path === '/api/login' && request.method === 'POST') {
      const { email, code, nickname, qq } = await request.json();
      const saved = await env.KV.get('code:' + email);
      if (saved !== code) {
        return new Response(JSON.stringify({ err: '验证码错误或已过期' }), { status: 400 });
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

    // ---- 其他接口保持不变 ----
    const getUserFromToken = (request) => {
      const authHeader = request.headers.get('Authorization') || '';
      try {
        return JSON.parse(atob(authHeader.replace('Bearer ', '')));
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

    // ---- 返回页面 ----
    return new Response(template, { 
      headers: { 'Content-Type': 'text/html;charset=utf-8' } 
    });
  }
};
