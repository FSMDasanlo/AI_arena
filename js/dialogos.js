"use strict";

const CONFIG = window.APP_CONFIG || {};
const GROQ_MODEL = CONFIG.groqModel || "openai/gpt-oss-120b";
const GEMINI_MODEL = CONFIG.geminiModel || "gemini-3.5-flash-lite";
const TIMEOUT_MS = 120000;

const $ = (id) => document.getElementById(id);

// history: [{ role: "user" | "assistant", content }]
const fighters = [
    {
        id: "groq",
        model: GROQ_MODEL,
        other: "gemini",
        hasKey: () => !!CONFIG.groqApiKey,
        ask: async (history, signal) => {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                signal,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${CONFIG.groqApiKey}`,
                },
                body: JSON.stringify({ model: GROQ_MODEL, messages: history }),
            });
            const data = await readJson(res);
            return data.choices?.[0]?.message?.content ?? "(respuesta vacía)";
        },
    },
    {
        id: "gemini",
        model: GEMINI_MODEL,
        other: "groq",
        hasKey: () => !!CONFIG.geminiApiKey,
        ask: async (history, signal) => {
            const contents = history.map((m) => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
            }));
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
                {
                    method: "POST",
                    signal,
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": CONFIG.geminiApiKey,
                    },
                    body: JSON.stringify({ contents }),
                }
            );
            const data = await readJson(res);
            const parts = data.candidates?.[0]?.content?.parts;
            return parts?.map((p) => p.text).join("") || "(respuesta vacía)";
        },
    },
];

const state = { round: 0, running: false, history: {}, last: {} };

async function readJson(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data;
}

function formatTime(ms) {
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function getMaxLines() {
    const n = parseInt($("max-lines").value, 10);
    return n > 0 ? n : 0;
}

function limitLines(text, maxLines) {
    if (!maxLines) return text;
    const lines = text.split("\n").filter((l, i, a) => l.trim() || (a[i - 1] ?? "").trim());
    if (lines.length <= maxLines) return lines.join("\n");
    return `${lines.slice(0, maxLines).join("\n")}\n… (recortado a ${maxLines} líneas)`;
}

function buildMessage(f, round, maxLines) {
    const note = $(`prompt-${f.id}`).value.trim();
    let msg;
    if (round === 1) {
        msg = note;
    } else {
        const otherName = f.other === "groq" ? "Groq" : "Gemini";
        msg = `Tu interlocutor (${otherName}) responde:\n"""\n${state.last[f.other]}\n"""\n\n` +
            "Replica defendiendo tu postura: rebate sus argumentos y aporta otros nuevos. No cambies de bando.";
        if (note) msg += `\n\nMatiz del moderador: ${note}`;
    }
    if (maxLines) msg += `\n\nResponde en un máximo de ${maxLines} líneas.`;
    return msg;
}

function appendTurn(id, round, content, cls = "") {
    const answer = $(`answer-${id}`);
    if (state.round === 1 && round === 1) answer.textContent = "";
    const div = document.createElement("div");
    div.className = `turn ${cls}`;
    const h = document.createElement("strong");
    h.textContent = `Ronda ${round}`;
    const p = document.createElement("div");
    p.textContent = content;
    div.append(h, p);
    answer.appendChild(div);
    answer.scrollTop = answer.scrollHeight;
    return p;
}

async function runFighter(f, round, maxLines) {
    const card = $(`card-${f.id}`);
    const badge = $(`badge-${f.id}`);
    card.classList.remove("error");
    card.classList.add("loading");
    badge.textContent = "";
    $(`copy-${f.id}`).disabled = true;

    const userMsg = buildMessage(f, round, maxLines);
    const history = [...(state.history[f.id] || []), { role: "user", content: userMsg }];
    const slot = appendTurn(f.id, round, "Pensando…");
    const start = performance.now();
    const ticker = setInterval(() => {
        slot.textContent = `Pensando… ${((performance.now() - start) / 1000).toFixed(0)} s`;
    }, 500);
    try {
        if (!f.hasKey()) throw new Error("Falta la API key en js/config.js");
        const text = limitLines(await f.ask(history, AbortSignal.timeout(TIMEOUT_MS)), maxLines);
        const ms = performance.now() - start;
        slot.textContent = `⏱ ${formatTime(ms)}\n\n${text}`;
        badge.textContent = formatTime(ms);
        state.history[f.id] = [...history, { role: "assistant", content: text }];
        state.last[f.id] = text;
        $(`copy-${f.id}`).disabled = false;
        return true;
    } catch (err) {
        card.classList.add("error");
        const msg = err.name === "TimeoutError" ? "Sin respuesta tras 120 s" : err.message;
        slot.textContent = `❌ Error: ${msg}`;
        return false;
    } finally {
        clearInterval(ticker);
        card.classList.remove("loading");
    }
}

async function nextRound() {
    if (state.running) return;
    const round = state.round + 1;
    if (round === 1 && !($("prompt-groq").value.trim() && $("prompt-gemini").value.trim())) {
        alert("Escribe el planteamiento para las dos IA.");
        return;
    }
    state.running = true;
    $("fight-btn").disabled = true;
    state.round = round;
    const results = await Promise.all(fighters.map((f) => runFighter(f, round, getMaxLines())));
    // Si una IA falla, la ronda no cuenta: se puede reintentar sin perder el hilo
    if (results.every(Boolean)) {
        $("round-info").textContent = `Ronda ${round} completada`;
        $("fight-btn").textContent = "🔁 Siguiente ronda";
        fighters.forEach((f) => ($(`prompt-${f.id}`).value = ""));
        fighters.forEach((f) => ($(`prompt-${f.id}`).placeholder = "Matiz opcional para la siguiente réplica…"));
    } else {
        state.round = round - 1;
        $("round-info").textContent = "Ronda fallida: revisa el error y reintenta";
        if (round > 1) rollbackPartial(results);
    }
    $("fight-btn").disabled = false;
    state.running = false;
}

// Mantiene sincronizados los historiales si solo una IA respondió
function rollbackPartial(results) {
    fighters.forEach((f, i) => {
        if (results[i]) {
            state.history[f.id] = state.history[f.id].slice(0, -2);
            state.last[f.id] = state.history[f.id].at(-1)?.content;
        }
    });
}

function resetAll() {
    if (state.running) return;
    state.round = 0;
    state.history = {};
    state.last = {};
    fighters.forEach((f) => {
        $(`answer-${f.id}`).textContent = "Esperando…";
        $(`badge-${f.id}`).textContent = "";
        $(`copy-${f.id}`).disabled = true;
        $(`card-${f.id}`).classList.remove("error");
        $(`prompt-${f.id}`).value = "";
        $(`prompt-${f.id}`).placeholder = `Tema y postura que defiende ${f.id === "groq" ? "Groq" : "Gemini"}…`;
    });
    $("round-info").textContent = "Ronda 0";
    $("fight-btn").textContent = "⚔️ ¡Al careo!";
}

async function copyAnswer(id) {
    const btn = $(`copy-${id}`);
    const text = state.last[id];
    if (!text) return;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            if (!ok) throw new Error("copy failed");
        }
        btn.textContent = "✅";
    } catch {
        btn.textContent = "❌";
    }
    setTimeout(() => (btn.textContent = "📋"), 1500);
}

document.addEventListener("DOMContentLoaded", () => {
    fighters.forEach((f) => {
        $(`model-${f.id}`).textContent = f.model;
        $(`copy-${f.id}`).addEventListener("click", () => copyAnswer(f.id));
        $(`prompt-${f.id}`).addEventListener("keydown", (e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                nextRound();
            }
        });
    });
    $("dialog-form").addEventListener("submit", (e) => {
        e.preventDefault();
        nextRound();
    });
    $("reset-btn").addEventListener("click", resetAll);
});
