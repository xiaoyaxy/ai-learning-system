import React, { useState } from "react";
import { api } from "../../lib/api";
export function DemoLogin({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  return (
    <main className="empty">
      <span className="eyebrow">知行 · AI 学习群</span>
      <h1>进入你的学习空间</h1>
      <p>输入 demo 访问密码，继续你的学习。</p>
      <form
        className="demo-login"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setPending(true);
          try {
            await api.login(password);
            setPassword("");
            onSuccess();
          } catch (e) {
            setError(e instanceof Error ? e.message : "登录未完成，请重试。");
          } finally {
            setPending(false);
          }
        }}
      >
        <label htmlFor="demo-password">访问密码</label>
        <input
          id="demo-password"
          type="password"
          autoComplete="current-password"
          maxLength={256}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={pending}>
          {pending ? "正在进入…" : "进入学习群"}
        </button>
      </form>
    </main>
  );
}
