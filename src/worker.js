import template from './template.html';

async function sendEmail(env, to, code) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: '聊天室 <noreply@xmhai.cn>',
      to: [to],
      subject: '聊天室注册验证码',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
          <h2 style="color:#4f6ef7">🔐 聊天室注册验证码</h2>
          <p>您好！</p>
          <p>您正在注册聊天室，验证码如下：</p>
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

// 获取客户端真实 IP
function getClientIP(request) {
  return request.headers.get('cf-connecting-ip') || 
         request.headers.get('x-real-ip') || 
         request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
         'unknown';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const clientIP = getClientIP(request);

    // ---- 发送注册验证码（限制：每个IP每天1条）----
    if (path === '/api/send-register-code' && request.method === 'POST') {
      const { email } = await request.json();
      
      if (!email || !email.includes('@')) {
        return new Response(JSON.stringify({ err: '请输入有效的邮箱地址' }), { status: 400 });
      }
      
      // 检查是否已注册
      const existingUser = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
      if (existingUser) {
        return new Response(JSON.stringify({ err: '该邮箱已注册，请直接登录' }), { status: 400 });
      }
      
      // 检查IP每日限制
      const today = new Date().toISOString().split('T')[0];
      const ipCodeKey = `register_code_limit:${clientIP}:${today}`;
      const ipLimitCount = await env.KV.get(ipCodeKey);
      
      if (ipLimitCount) {
        return new Response(JSON.stringify({ 
          err: '每个IP每天只能发送1条注册验证码，请明天再试' 
        }), { status: 429 });
      }
      
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.KV.put('register_code:' + email, code, { expirationTtl: 300 });
      
      // 记录IP发送次数
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const ttlSeconds = Math.floor((tomorrow - now) / 1000);
      
      await env.KV.put(ipCodeKey, '1', { expirationTtl: ttlSeconds });
      
      try {
        await sendEmail(env, email, code);
        return new Response(JSON.stringify({ ok: true, message: '验证码已发送到邮箱' }));
      } catch (err) {
        console.error('邮件发送失败:', err);
        return new Response(JSON.stringify({ err: '邮件发送失败，请稍后重试' }), { status: 500 });
      }
    }

    // ---- 注册（邮箱 + 验证码 + 密码）----
    if (path === '/api/register' && request.method === 'POST') {
      const { email, code, password, nickname, qq } = await request.json();
      
      // 验证参数
      if (!email || !code || !password || !nickname) {
        return new Response(JSON.stringify({ err: '请填写所有必填项' }), { status: 400 });
      }
      
      if (password.length < 6) {
        return new Response(JSON.stringify({ err: '密码至少6位' }), { status: 400 });
      }
      
      // 验证验证码
      const saved = await env.KV.get('register_code:' + email);
      if (saved !== code) {
        return new Response(JSON.stringify({ err: '验证码错误或已过期' }), { status: 400 });
      }
      
      // 检查是否已注册
      const existingUser = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
      if (existingUser) {
        return new Response(JSON.stringify({ err: '该邮箱已注册' }), { status: 400 });
      }
      
      // 判断是否为第一个用户（管理员）
      const firstUser = await env.DB.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').first();
      const isAdmin = !firstUser;
      
      // 创建用户（密码明文存储，因为你说只是本站用）
      const result = await env.DB.prepare(
        'INSERT INTO users(email, password, nickname, qq, is_admin) VALUES(?, ?, ?, ?, ?)'
      ).bind(email, password, nickname, qq || '', isAdmin ? 1 : 0).run();
      
      const user = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
      const token = btoa(JSON.stringify({ uid: user.id, email: user.email }));
      
      // 删除已使用的验证码
      await env.KV.delete('register_code:' + email);
      
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

    // ---- 登录（只需要邮箱 + 密码）----
    if (path === '/api/login' && request.method === 'POST') {
      const { email, password } = await request.json();
      
      if (!email || !password) {
        return new Response(JSON.stringify({ err: '请填写邮箱和密码' }), { status: 400 });
      }
      
      const user = await env.DB.prepare('SELECT * FROM users WHERE email=? AND password=?').bind(email, password).first();
      
      if (!user) {
        return new Response(JSON.stringify({ err: '邮箱或密码错误' }), { status: 401 });
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

    // ---- 解析token ----
    const getUserFromToken = (request) => {
      const authHeader = request.headers.get('Authorization') || '';
      try {
        return JSON.parse(atob(authHeader.replace('Bearer ', '')));
      } catch {
        return null;
      }
    };

    // ---- 公告 ----
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

    // ---- 获取消息 ----
    if (path === '/api/msgs' && request.method === 'GET') {
      const msgs = await env.DB.prepare(
        'SELECT m.*, u.qq FROM messages m JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 200'
      ).all();
      return new Response(JSON.stringify(msgs.results.reverse()));
    }

    // ---- 发送消息（限制：每个IP每分钟5条）----
    if (path === '/api/msgs' && request.method === 'POST') {
      const tokenData = getUserFromToken(request);
      if (!tokenData) return new Response('请先登录', { status: 401 });
      
      const { content } = await request.json();
      if (!content || !content.trim()) {
        return new Response(JSON.stringify({ err: '内容不能为空' }), { status: 400 });
      }
      
      // 检查IP发送频率
      const minuteKey = `msg_limit:${clientIP}:${Math.floor(Date.now() / 60000)}`;
      const msgCount = parseInt(await env.KV.get(minuteKey) || '0');
      
      if (msgCount >= 5) {
        return new Response(JSON.stringify({ 
          err: '发送太频繁，每分钟最多5条消息' 
        }), { status: 429 });
      }
      
      await env.KV.put(minuteKey, String(msgCount + 1), { expirationTtl: 120 });
      
      const user = await env.DB.prepare('SELECT nickname, qq FROM users WHERE id=?').bind(tokenData.uid).first();
      const avatar = user.qq ? `http://q.qlogo.cn/headimg/${user.qq}/100` : '';
      
      await env.DB.prepare(
        'INSERT INTO messages(user_id, nickname, avatar, content) VALUES(?, ?, ?, ?)'
      ).bind(tokenData.uid, user.nickname, avatar, content.trim()).run();
      
      return new Response(JSON.stringify({ ok: true }));
    }

    // ---- 删除消息 ----
    if (path.startsWith('/api/msg/') && request.method === 'DELETE') {
      const tokenData = getUserFromToken(request);
      if (!tokenData) return new Response('Unauthorized', { status: 401 });
      
      const user = await env.DB.prepare('SELECT is_admin FROM users WHERE id=?').bind(tokenData.uid).first();
      if (!user?.is_admin) return new Response('Forbidden', { status: 403 });
      
      const msgId = path.split('/')[3];
      await env.DB.prepare('DELETE FROM messages WHERE id=?').bind(msgId).run();
      return new Response(JSON.stringify({ ok: true }));
    }

    // ---- 获取当前用户信息 ----
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
