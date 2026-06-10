import indexHtml from './index.html';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const db = env.DB;
    const kv = env.KV;
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // 工具：SHA-256 哈希
    async function sha256(str) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str + '_salt'));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // 工具：返回 JSON 错误
    function jsonErr(msg) {
      return new Response(JSON.stringify({ err: msg }), { headers: cors });
    }

    // ========== 发送验证码 ==========
    if (url.pathname === '/api/sendcode' && request.method === 'POST') {
      const { email } = await request.json();
      if (!/^[a-z0-9._%+\-]+@qq\.com$/i.test(email)) {
        return jsonErr('仅支持QQ邮箱');
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await kv.put('vc:' + email, code, { expirationTtl: 600 }); // 10分钟有效期
      
      // 通过 MailChannels 发送验证码
      try {
        await fetch('https://api.mailchannels.net/tx/v1/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalizations: [{ to: [{ email }] }],
            from: { email: 'noreply@你的域名.com', name: 'Chat验证' },
            subject: '您的注册验证码',
            content: [{
              type: 'text/plain',
              value: `您的验证码是：${code}\n10分钟内有效，请勿泄露。`
            }]
          })
        });
      } catch (e) {
        // 发送失败不影响，用户可重试
      }
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    // ========== 注册 ==========
    if (url.pathname === '/api/register' && request.method === 'POST') {
      const { email, pwd, nickname, code } = await request.json();
      if (!/^[a-z0-9._%+\-]+@qq\.com$/i.test(email)) return jsonErr('仅支持QQ邮箱');
      if (!pwd || pwd.length < 4) return jsonErr('密码至少4位');
      
      // 校验验证码
      const savedCode = await kv.get('vc:' + email);
      if (!savedCode || savedCode !== code) return jsonErr('验证码错误或已过期');
      await kv.delete('vc:' + email);

      // 检查是否已注册
      const exists = await db.prepare('SELECT email FROM users WHERE email=?').bind(email).first();
      if (exists) return jsonErr('该邮箱已注册');

      const hash = await sha256(pwd);
      const nm = nickname || email.split('@')[0];
      await db.prepare('INSERT INTO users(email, password_hash, nickname) VALUES(?,?,?)')
        .bind(email, hash, nm).run();
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    // ========== 登录 ==========
    if (url.pathname === '/api/login' && request.method === 'POST') {
      const { email, pwd } = await request.json();
      const user = await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
      if (!user) return jsonErr('用户不存在');
      const hash = await sha256(pwd);
      if (user.password_hash !== hash) return jsonErr('密码错误');
      return new Response(JSON.stringify({ ok: true, email: user.email, nickname: user.nickname }), { headers: cors });
    }

    // ========== 修改昵称 ==========
    if (url.pathname === '/api/profile' && request.method === 'POST') {
      const { email, pwd, nickname } = await request.json();
      const user = await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
      if (!user) return jsonErr('用户不存在');
      const hash = await sha256(pwd);
      if (user.password_hash !== hash) return jsonErr('密码错误');
      await db.prepare('UPDATE users SET nickname=? WHERE email=?').bind(nickname, email).run();
      await db.prepare('UPDATE messages SET nickname=? WHERE email=?').bind(nickname, email).run();
      return new Response(JSON.stringify({ ok: true, nickname }), { headers: cors });
    }

    // ========== 发送消息 ==========
    if (url.pathname === '/api/send' && request.method === 'POST') {
      const { email, nickname, content } = await request.json();
      await db.prepare('INSERT INTO messages(email, nickname, content) VALUES(?,?,?)')
        .bind(email, nickname, content.trim().slice(0, 500)).run();
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    // ========== 获取消息 ==========
    if (url.pathname === '/api/messages') {
      const msgs = await db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 50').all();
      return new Response(JSON.stringify(msgs.results.reverse()), { headers: cors });
    }

    // ========== 心跳 ==========
    if (url.pathname === '/api/heartbeat' && request.method === 'POST') {
      const { email } = await request.json();
      const now = Math.floor(Date.now() / 1000);
      await db.prepare('INSERT OR REPLACE INTO online_users(email, last_seen) VALUES(?,?)')
        .bind(email, now).run();
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    // ========== 在线人数 ==========
    if (url.pathname === '/api/online') {
      const cutoff = Math.floor(Date.now() / 1000) - 150; // 150秒超时
      await db.prepare('DELETE FROM online_users WHERE last_seen < ?').bind(cutoff).run();
      const result = await db.prepare('SELECT COUNT(*) as count FROM online_users').first();
      return new Response(JSON.stringify({ count: result.count }), { headers: cors });
    }

    // ========== 检查管理员 ==========
    if (url.pathname === '/api/checkadmin' && request.method === 'POST') {
      const { email } = await request.json();
      const admin = await db.prepare('SELECT email FROM admins WHERE email=?').bind(email).first();
      return new Response(JSON.stringify({ admin: !!admin }), { headers: cors });
    }

    // ========== 删除消息（仅管理员） ==========
    if (url.pathname === '/api/delmsg' && request.method === 'POST') {
      const { email, msgId } = await request.json();
      const admin = await db.prepare('SELECT email FROM admins WHERE email=?').bind(email).first();
      if (!admin) return jsonErr('你不是管理员');
      await db.prepare('DELETE FROM messages WHERE id=?').bind(msgId).run();
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    // ========== 返回前端页面 ==========
    return new Response(indexHtml, {
      headers: { 'Content-Type': 'text/html;charset=utf-8' }
    });
  }
};
