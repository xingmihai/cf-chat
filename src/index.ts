import { Hono } from 'hono'

const app = new Hono<{ Bindings: { DB: D1Database } }>()

// 注册
app.post('/api/register', async c => {
  const { qq, password, nickname } = await c.req.json()
  if (!/^\d{5,12}$/.test(qq)) return c.json({ err: 'QQ号格式错误' }, 400)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
    .then(h => Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join(''))
  try {
    await c.env.DB.prepare('INSERT INTO users(qq,password_hash,nickname) VALUES(?,?,?)')
      .bind(qq, hash, nickname || qq).run()
    return c.json({ ok: true })
  } catch { return c.json({ err: 'QQ号已注册' }, 409) }
})

// 登录
app.post('/api/login', async c => {
  const { qq, password } = await c.req.json()
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
    .then(h => Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join(''))
  const u = await c.env.DB.prepare('SELECT qq,nickname FROM users WHERE qq=? AND password_hash=?')
    .bind(qq, hash).first()
  if (!u) return c.json({ err: '账号或密码错误' }, 401)
  return c.json(u)
})

// 修改昵称
app.patch('/api/user/nickname', async c => {
  const { qq, nickname } = await c.req.json()
  await c.env.DB.prepare('UPDATE users SET nickname=? WHERE qq=?').bind(nickname, qq).run()
  return c.json({ ok: true })
})

// 发消息
app.post('/api/msg', async c => {
  const { qq, content } = await c.req.json()
  await c.env.DB.prepare('INSERT INTO messages(qq,content) VALUES(?,?)').bind(qq, content).run()
  return c.json({ ok: true })
})

// 拉消息（长轮询思路，简化版 since 参数）
app.get('/api/msgs', async c => {
  const since = c.req.query('since') || '0'
  const msgs = await c.env.DB.prepare(`
    SELECT m.id,m.content,m.created_at,u.qq,u.nickname
    FROM messages m JOIN users u ON u.qq=m.qq
    WHERE m.id > ? ORDER BY m.id ASC LIMIT 100
  `).bind(Number(since)).all()
  return c.json(msgs.results)
})

// 用户列表
app.get('/api/users', async c => {
  const r = await c.env.DB.prepare('SELECT qq,nickname FROM users').all()
  return c.json(r.results)
})

// 提供前端页面
app.get('*', async c => {
  const html = await fetch(new URL('./index.html', import.meta.url)).then(r => r.text())
  return c.html(html)
})

export default app
