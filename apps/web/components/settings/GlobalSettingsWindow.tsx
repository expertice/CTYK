"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GlobalSettings } from "../../lib/settings/global-settings";
import { OLLAMA_DEFAULT_MODEL_TAG } from "../../lib/llm/ollama-default-model";
import { getUiCopy } from "../../lib/i18n/ui-copy";
import {
  createDefaultGlobalSettings,
  notifyGlobalSettingsChanged,
  readGlobalSettings,
  writeGlobalSettings,
} from "../../lib/settings/global-settings";
import { RuntimeEnvironmentPanel } from "./RuntimeEnvironmentPanel";

interface GlobalSettingsWindowProps {
  open: boolean;
  onClose: () => void;
}

type ChatTurn = { role: "user" | "assistant"; content: string };

type OllamaProbeState = {
  phase: "idle" | "loading" | "ok" | "error";
  models: string[];
  version?: string;
  root?: string;
  error: string;
};

const QWEN_CLOUD_MODELS = [
  "qwen-plus",
  "qwen-turbo",
  "qwen-max",
  "qwen3-235b-a22b",
  "qwen3-32b",
  "qwen3-14b",
  "qwen3-8b",
] as const;

export function GlobalSettingsWindow({ open, onClose }: GlobalSettingsWindowProps) {
  const copy = getUiCopy("ru");
  const [settingsSection, setSettingsSection] = useState<"llm" | "system">("llm");
  const [llmSection, setLlmSection] = useState<"local" | "cloud">("local");
  const [settings, setSettings] = useState<GlobalSettings>(() => createDefaultGlobalSettings());
  const [ollama, setOllama] = useState<OllamaProbeState>({
    phase: "idle",
    models: [],
    error: "",
  });
  const [chatMessages, setChatMessages] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [cloudChatMessages, setCloudChatMessages] = useState<ChatTurn[]>([]);
  const [cloudChatInput, setCloudChatInput] = useState("");
  const [cloudChatLoading, setCloudChatLoading] = useState(false);
  const [cloudChatError, setCloudChatError] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const ollamaAbortRef = useRef<AbortController | null>(null);

  const runOllamaProbe = useCallback(async (baseUrl: string, signal?: AbortSignal) => {
    const trimmed = baseUrl.trim();
    if (!trimmed) {
      if (!signal?.aborted) {
        setOllama({ phase: "idle", models: [], error: "" });
      }
      return;
    }
    if (!signal?.aborted) {
      setOllama((s) => ({ ...s, phase: "loading", error: "" }));
    }
    try {
      const res = await fetch("/api/llm/ollama-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: trimmed }),
        signal,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        ollamaReachable?: boolean;
        models?: string[];
        version?: string;
        root?: string;
        error?: string;
      };
      if (signal?.aborted) return;
      if (!res.ok) {
        setOllama({
          phase: "error",
          models: [],
          error: typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
        });
        return;
      }
      if (data.ok && data.ollamaReachable) {
        setOllama({
          phase: "ok",
          models: Array.isArray(data.models) ? data.models : [],
          version: typeof data.version === "string" ? data.version : undefined,
          root: typeof data.root === "string" ? data.root : undefined,
          error: "",
        });
        return;
      }
      setOllama({
        phase: "error",
        models: [],
        error:
          typeof data.error === "string"
            ? data.error
            : "Не отвечает как Ollama (проверьте URL или запустите ollama serve)",
      });
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      setOllama({
        phase: "error",
        models: [],
        error: e instanceof Error ? e.message : "Ошибка запроса",
      });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSettingsSection("llm");
    const loaded = readGlobalSettings();
    setLlmSection(loaded.llmActiveSource === "cloud" ? "cloud" : "local");
    setSettings(loaded);
    setChatMessages([]);
    setChatInput("");
    setChatError("");
    setCloudChatMessages([]);
    setCloudChatInput("");
    setCloudChatError("");
    if (loaded.llmLocal.baseUrl.trim().length > 0) {
      setOllama((prev) => ({ ...prev, phase: "loading", error: "" }));
    } else {
      setOllama({ phase: "idle", models: [], error: "" });
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      ollamaAbortRef.current?.abort();
      return;
    }
    const url = settings.llmLocal.baseUrl;
    const timer = window.setTimeout(() => {
      ollamaAbortRef.current?.abort();
      const ac = new AbortController();
      ollamaAbortRef.current = ac;
      void runOllamaProbe(url, ac.signal);
    }, 420);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, settings.llmLocal.baseUrl, runOllamaProbe]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, cloudChatMessages]);

  const canSend = useMemo(() => {
    const { llmLocal } = settings;
    return (
      llmLocal.baseUrl.trim().length > 0 &&
      llmLocal.model.trim().length > 0 &&
      chatInput.trim().length > 0 &&
      !chatLoading
    );
  }, [settings, chatInput, chatLoading]);

  const canSendCloud = useMemo(() => {
    const cloud = settings.llmCloud ?? createDefaultGlobalSettings().llmCloud;
    return (
      cloud.baseUrl.trim().length > 0 &&
      cloud.model.trim().length > 0 &&
      cloudChatInput.trim().length > 0 &&
      !cloudChatLoading
    );
  }, [settings.llmCloud, cloudChatInput, cloudChatLoading]);

  /** Варианты для выпадающего списка: модели из Ollama + сохранённое имя, если его ещё нет в списке */
  const ollamaModelSelectOptions = useMemo(() => {
    const cur = settings.llmLocal.model.trim();
    const fromServer = ollama.models;
    if (!cur) return fromServer;
    if (fromServer.includes(cur)) return fromServer;
    return [cur, ...fromServer];
  }, [ollama.models, settings.llmLocal.model]);

  async function handleSendChat() {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const { llmLocal } = settings;
    if (!llmLocal.baseUrl.trim() || !llmLocal.model.trim()) {
      setChatError("Укажите Base URL и модель слева");
      return;
    }

    const nextHistory: ChatTurn[] = [...chatMessages, { role: "user", content: text }];
    setChatMessages(nextHistory);
    setChatInput("");
    setChatError("");
    setChatLoading(true);

    try {
      const response = await fetch("/api/llm/probe-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: llmLocal.baseUrl.trim(),
          apiKey: llmLocal.apiKey.trim() || undefined,
          model: llmLocal.model.trim(),
          messages: nextHistory.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Ошибка ${response.status}`);
      }
      if (typeof payload.reply !== "string") {
        throw new Error("Пустой ответ");
      }
      setChatMessages((prev) => [...prev, { role: "assistant", content: payload.reply! }]);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Не удалось связаться с LLM");
      setChatMessages((prev) => prev.slice(0, -1));
      setChatInput(text);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleSendCloudChat() {
    const text = cloudChatInput.trim();
    if (!text || cloudChatLoading) return;
    const cloud = settings.llmCloud ?? createDefaultGlobalSettings().llmCloud;
    if (!cloud.baseUrl.trim() || !cloud.model.trim()) {
      setCloudChatError("Укажите Base URL и модель слева");
      return;
    }

    const nextHistory: ChatTurn[] = [...cloudChatMessages, { role: "user", content: text }];
    setCloudChatMessages(nextHistory);
    setCloudChatInput("");
    setCloudChatError("");
    setCloudChatLoading(true);

    try {
      const response = await fetch("/api/llm/probe-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: cloud.baseUrl.trim(),
          apiKey: cloud.apiKey.trim() || undefined,
          model: cloud.model.trim(),
          messages: nextHistory.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Ошибка ${response.status}`);
      }
      if (typeof payload.reply !== "string") {
        throw new Error("Пустой ответ");
      }
      setCloudChatMessages((prev) => [...prev, { role: "assistant", content: payload.reply! }]);
    } catch (e) {
      setCloudChatError(e instanceof Error ? e.message : "Не удалось связаться с LLM");
      setCloudChatMessages((prev) => prev.slice(0, -1));
      setCloudChatInput(text);
    } finally {
      setCloudChatLoading(false);
    }
  }

  function handleClearChat() {
    setChatMessages([]);
    setChatError("");
  }

  function handleSave() {
    const next: GlobalSettings = {
      ...settings,
      llmActiveSource: llmSection,
      llmLocal: {
        ...settings.llmLocal,
        availableModels: [...ollama.models],
      },
    };
    writeGlobalSettings(next);
    notifyGlobalSettingsChanged(next);
    onClose();
  }

  function handleReset() {
    setSettings(createDefaultGlobalSettings());
    setLlmSection("local");
  }

  if (!open) return null;

  const { llmLocal } = settings;
  const llmCloud = settings.llmCloud ?? createDefaultGlobalSettings().llmCloud;

  function handleRefreshOllama() {
    ollamaAbortRef.current?.abort();
    const ac = new AbortController();
    ollamaAbortRef.current = ac;
    void runOllamaProbe(llmLocal.baseUrl, ac.signal);
  }

  return (
    <div
      className="app-settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={copy.settingsModal.dialogAria}
    >
      <div className="app-settings-modal app-settings-modal--wide">
        <div className="app-settings-header">
          <h2>{copy.settingsModal.title}</h2>
          <button type="button" className="app-settings-close" onClick={onClose} aria-label={copy.settingsModal.close}>
            ×
          </button>
        </div>
        <div className="app-settings-shell app-settings-shell--three">
          <nav className="app-settings-nav" aria-label={copy.settingsModal.navAria}>
            <button
              type="button"
              className={settingsSection === "llm" ? "app-settings-tab app-settings-tab-active" : "app-settings-tab"}
              onClick={() => setSettingsSection("llm")}
            >
              {copy.settingsModal.tabLlm}
            </button>
            <button
              type="button"
              className={settingsSection === "system" ? "app-settings-tab app-settings-tab-active" : "app-settings-tab"}
              onClick={() => setSettingsSection("system")}
            >
              {copy.settingsModal.tabSystem}
            </button>
          </nav>
          <nav className="app-settings-subnav" aria-label="Уточнение раздела настроек">
            {settingsSection === "llm" ? (
              <>
                <button
                  type="button"
                  className={llmSection === "local" ? "app-settings-tab app-settings-tab-active" : "app-settings-tab"}
                  onClick={() => setLlmSection("local")}
                >
                  Локальные
                </button>
                <button
                  type="button"
                  className={llmSection === "cloud" ? "app-settings-tab app-settings-tab-active" : "app-settings-tab"}
                  onClick={() => setLlmSection("cloud")}
                >
                  Облачные
                </button>
              </>
            ) : (
              <button type="button" className="app-settings-tab app-settings-tab-active" disabled>
                Общее
              </button>
            )}
          </nav>
          {settingsSection === "llm" ? (
            <div className="app-settings-pane app-settings-pane--llm">
              {llmSection === "local" ? (
                <div className="app-settings-body--llm-split">
                  <div className="app-settings-content app-settings-content--form">
            <p className="field-hint">
              OpenAI-совместимый endpoint (Ollama, LM Studio, vLLM и т.п.). Пример для Ollama:{" "}
              <code>http://127.0.0.1:11434/v1</code>. Имя модели должно совпадать с тегом из списка Ollama выше или
              из <code>ollama list</code> (например <code>qwen2.5:3b</code>), иначе будет 404.
            </p>
            <label className="field">
              Base URL
              <input
                type="url"
                autoComplete="off"
                value={llmLocal.baseUrl}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    llmLocal: { ...prev.llmLocal, baseUrl: e.target.value },
                  }))
                }
                placeholder="http://127.0.0.1:11434/v1"
              />
            </label>
            <div className="app-settings-ollama-status" role="status" aria-live="polite">
              {llmLocal.baseUrl.trim().length === 0 ? (
                <p className="field-hint app-settings-ollama-line">Укажите Base URL — проверим Ollama и подтянем список моделей.</p>
              ) : ollama.phase === "loading" ? (
                <p className="app-settings-ollama-line app-settings-ollama-line--loading">Проверка Ollama…</p>
              ) : ollama.phase === "ok" ? (
                <div className="app-settings-ollama-line app-settings-ollama-line--ok">
                  <span className="app-settings-ollama-pill app-settings-ollama-pill--ok">Ollama</span>
                  <span className="app-settings-ollama-meta">
                    {ollama.version ? `версия ${ollama.version}` : "сервер отвечает"}
                    {ollama.models.length > 0 ? ` · ${ollama.models.length} моделей` : ""}
                  </span>
                  {ollama.root ? (
                    <span className="app-settings-ollama-root" title="Корень API Ollama">
                      {ollama.root}
                    </span>
                  ) : null}
                </div>
              ) : ollama.phase === "error" ? (
                <p className="app-settings-ollama-line app-settings-ollama-line--err">{ollama.error}</p>
              ) : (
                <p className="field-hint app-settings-ollama-line">Статус появится после ввода Base URL.</p>
              )}
              <button
                type="button"
                className="app-settings-ollama-refresh"
                onClick={handleRefreshOllama}
                disabled={!llmLocal.baseUrl.trim() || ollama.phase === "loading"}
              >
                Обновить
              </button>
            </div>
            <label className="field">
              API key (если требуется)
              <input
                type="password"
                autoComplete="off"
                value={llmLocal.apiKey}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    llmLocal: { ...prev.llmLocal, apiKey: e.target.value },
                  }))
                }
                placeholder="оставьте пустым для локального сервера без ключа"
              />
            </label>
            <label className="field">
              Модель
              {ollama.phase === "loading" && llmLocal.baseUrl.trim().length > 0 ? (
                <input type="text" autoComplete="off" disabled value={llmLocal.model} />
              ) : ollama.phase === "ok" && ollama.models.length > 0 ? (
                <>
                  <select
                    className="app-settings-model-select"
                    value={llmLocal.model}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        llmLocal: { ...prev.llmLocal, model: e.target.value },
                      }))
                    }
                  >
                    {ollamaModelSelectOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                        {!ollama.models.includes(name) ? " (сохранено)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="field-hint">Модели с вашего Ollama (<code>/api/tags</code>). При смене Base URL список обновится.</p>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    autoComplete="off"
                    value={llmLocal.model}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        llmLocal: { ...prev.llmLocal, model: e.target.value },
                      }))
                    }
                    placeholder={OLLAMA_DEFAULT_MODEL_TAG}
                  />
                  {ollama.phase === "ok" && ollama.models.length === 0 ? (
                    <p className="field-hint">
                      Список моделей пуст — выполните <code>ollama pull …</code> или введите тег модели вручную.
                    </p>
                  ) : ollama.phase === "error" && llmLocal.baseUrl.trim().length > 0 ? (
                    <p className="field-hint">
                      Не удалось получить список с Ollama — введите имя модели вручную (как в <code>ollama list</code>).
                    </p>
                  ) : null}
                </>
              )}
            </label>
                  </div>
                  <div className="app-settings-content app-settings-content--chat">
                    <div className="app-settings-chat-head">
                      <h3 className="app-settings-chat-title">Проверка связи</h3>
                      <button type="button" className="app-settings-chat-clear" onClick={handleClearChat}>
                        Очистить чат
                      </button>
                    </div>
                    <div className="app-settings-chat-log" role="log" aria-live="polite" aria-relevant="additions">
                      {chatMessages.length === 0 ? (
                        <p className="field-hint app-settings-chat-empty">Напишите сообщение и нажмите «Отправить».</p>
                      ) : (
                        chatMessages.map((m, i) => (
                          <div
                            key={`${i}-${m.role}`}
                            className={m.role === "user" ? "app-settings-chat-bubble app-settings-chat-bubble--user" : "app-settings-chat-bubble app-settings-chat-bubble--assistant"}
                          >
                            <span className="app-settings-chat-role">{m.role === "user" ? "Вы" : "Модель"}</span>
                            <pre className="app-settings-chat-text">{m.content}</pre>
                          </div>
                        ))
                      )}
                      <div ref={chatEndRef} />
                    </div>
                    {chatError ? <p className="error app-settings-chat-error">{chatError}</p> : null}
                    <div className="app-settings-chat-compose">
                      <textarea
                        className="app-settings-chat-input"
                        rows={3}
                        placeholder="Текст для проверки…"
                        value={chatInput}
                        disabled={chatLoading}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void handleSendChat();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="app-settings-chat-send"
                        disabled={!canSend}
                        onClick={() => void handleSendChat()}
                      >
                        {chatLoading ? "Отправка…" : "Отправить"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="app-settings-body--llm-split">
                  <div className="app-settings-content app-settings-content--form">
                    <h3 style={{ marginTop: 0 }}>Облачные LLM</h3>
                    <p className="field-hint">
                      Коннектор QWEN Cloud (OpenAI-compatible). Укажите API key, при необходимости поменяйте endpoint и
                      выберите модель.
                    </p>
                    <label className="field">
                      Провайдер
                      <input type="text" value="QWEN Cloud" disabled />
                    </label>
                    <label className="field">
                      Base URL
                      <input
                        type="url"
                        autoComplete="off"
                        value={llmCloud.baseUrl}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            llmCloud: {
                              ...(prev.llmCloud ?? createDefaultGlobalSettings().llmCloud),
                              baseUrl: e.target.value,
                            },
                          }))
                        }
                        placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
                      />
                    </label>
                    <label className="field">
                      API key
                      <input
                        type="password"
                        autoComplete="off"
                        value={llmCloud.apiKey}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            llmCloud: {
                              ...(prev.llmCloud ?? createDefaultGlobalSettings().llmCloud),
                              apiKey: e.target.value,
                            },
                          }))
                        }
                        placeholder="sk-..."
                      />
                    </label>
                    <label className="field">
                      Модель
                      <select
                        className="app-settings-model-select"
                        value={llmCloud.model}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            llmCloud: {
                              ...(prev.llmCloud ?? createDefaultGlobalSettings().llmCloud),
                              model: e.target.value,
                            },
                          }))
                        }
                      >
                        {QWEN_CLOUD_MODELS.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <p className="field-hint">
                        При отсутствии модели в аккаунте QWEN можно временно ввести имя вручную через JSON настроек.
                      </p>
                    </label>
                  </div>
                  <div className="app-settings-content app-settings-content--chat">
                    <div className="app-settings-chat-head">
                      <h3 className="app-settings-chat-title">Проверка связи (Cloud)</h3>
                      <button
                        type="button"
                        className="app-settings-chat-clear"
                        onClick={() => {
                          setCloudChatMessages([]);
                          setCloudChatError("");
                        }}
                      >
                        Очистить чат
                      </button>
                    </div>
                    <div className="app-settings-chat-log" role="log" aria-live="polite" aria-relevant="additions">
                      {cloudChatMessages.length === 0 ? (
                        <p className="field-hint app-settings-chat-empty">Напишите сообщение и нажмите «Отправить».</p>
                      ) : (
                        cloudChatMessages.map((m, i) => (
                          <div
                            key={`${i}-${m.role}`}
                            className={
                              m.role === "user"
                                ? "app-settings-chat-bubble app-settings-chat-bubble--user"
                                : "app-settings-chat-bubble app-settings-chat-bubble--assistant"
                            }
                          >
                            <span className="app-settings-chat-role">{m.role === "user" ? "Вы" : "Модель"}</span>
                            <pre className="app-settings-chat-text">{m.content}</pre>
                          </div>
                        ))
                      )}
                      <div ref={chatEndRef} />
                    </div>
                    {cloudChatError ? <p className="error app-settings-chat-error">{cloudChatError}</p> : null}
                    <div className="app-settings-chat-compose">
                      <textarea
                        className="app-settings-chat-input"
                        rows={3}
                        placeholder="Текст для проверки…"
                        value={cloudChatInput}
                        disabled={cloudChatLoading}
                        onChange={(e) => setCloudChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void handleSendCloudChat();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="app-settings-chat-send"
                        disabled={!canSendCloud}
                        onClick={() => void handleSendCloudChat()}
                      >
                        {cloudChatLoading ? "Отправка…" : "Отправить"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="app-settings-pane app-settings-pane--system">
              <div className="app-settings-content">
                <h3 style={{ marginTop: 0 }}>ПРОЦЕСС</h3>
                <p className="field-hint">
                  Управление совместимостью и строгими правилами графа/сценариев. Рекомендуется оставлять включенным
                  в боевом режиме.
                </p>
                <label className="asr-gpu-inline">
                  <input
                    type="checkbox"
                    checked={settings.process.enforceGraphModulePortsMatchProgram}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        process: {
                          ...prev.process,
                          enforceGraphModulePortsMatchProgram: e.target.checked,
                        },
                      }))
                    }
                  />{" "}
                  Граф строго следует программным входам/выходам модулей
                </label>
                <label className="asr-gpu-inline">
                  <input
                    type="checkbox"
                    checked={settings.process.enforceEdgeTypeCompatibility}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        process: {
                          ...prev.process,
                          enforceEdgeTypeCompatibility: e.target.checked,
                        },
                      }))
                    }
                  />{" "}
                  Строгое совпадение типов входов/выходов на ребрах
                </label>
                <label className="asr-gpu-inline">
                  <input
                    type="checkbox"
                    checked={settings.process.showUniversalInputForReport}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        process: {
                          ...prev.process,
                          showUniversalInputForReport: e.target.checked,
                        },
                      }))
                    }
                  />{" "}
                  Универсальный вход для мультиприемника отчета
                </label>
                <RuntimeEnvironmentPanel />
              </div>
            </div>
          )}
        </div>
        <div className="app-settings-footer">
          <>
            <button type="button" onClick={handleReset}>
              Сбросить
            </button>
            <div className="app-settings-footer-spacer" />
            <button type="button" onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="app-settings-primary" onClick={handleSave}>
              Сохранить
            </button>
          </>
        </div>
      </div>
    </div>
  );
}
