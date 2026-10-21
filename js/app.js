"use strict";

const CONFIG = window.APP_CONFIG || {};

const GROQ_MODEL = CONFIG.groqModel || "openai/gpt-oss-120b";
const GEMINI_MODEL = CONFIG.geminiModel || "gemini-3.5-flash-lite";

const TIMEOUT_MS = 120000;
const MAX_FILE_BYTES = 200 * 1024;

const fighters = [
    {
        id: "groq",
        model: GROQ_MODEL,
        ask: async (prompt, signal) => {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                signal,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${CONFIG.groqApiKey}`,
                },
                body: JSON.stringify({
                    model: GROQ_MODEL,
                    messages: [{ role: "user", content: prompt }],
                }),
            });
            const data = await readJson(res);
            return data.choices?.[0]?.message?.content ?? "(respuesta vacía)";
        },
        hasKey: () => !!CONFIG.groqApiKey,
    },
    {
        id: "gemini",
        model: GEMINI_MODEL,
        ask: async (prompt, signal) => {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
                {
                    method: "POST",
                    signal,
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": CONFIG.geminiApiKey,
                    },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
                }
            );
            const data = await readJson(res);
            const parts = data.candidates?.[0]?.content?.parts;
            return parts?.map((p) => p.text).join("") || "(respuesta vacía)";
        },
        hasKey: () => !!CONFIG.geminiApiKey,
    },
];

const $ = (id) => document.getElementById(id);

async function readJson(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error?.message || `HTTP ${res.status}`);
    }
    return data;
}

function formatTime(ms) {
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const answers = {};

async function copyAnswer(id) {
    const btn = $(`copy-${id}`);
    const text = answers[id];
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

async function runFighter(f, prompt, maxLines) {
    const card = $(`card-${f.id}`);
    const answer = $(`answer-${f.id}`);
    const badge = $(`badge-${f.id}`);

    card.classList.remove("winner", "error");
    card.classList.add("loading");
    badge.textContent = "";
    answers[f.id] = "";
    $(`copy-${f.id}`).disabled = true;
    answer.textContent = "Pensando…";

    const start = performance.now();
    const ticker = setInterval(() => {
        answer.textContent = `Pensando… ${((performance.now() - start) / 1000).toFixed(0)} s`;
    }, 500);
    try {
        if (!f.hasKey()) throw new Error("Falta la API key en js/config.js");
        const text = limitLines(await f.ask(prompt, AbortSignal.timeout(TIMEOUT_MS)), maxLines);
        const ms = performance.now() - start;
        answer.textContent = `⏱ ${formatTime(ms)}\n\n${text}`;
        badge.textContent = formatTime(ms);
        answers[f.id] = text;
        $(`copy-${f.id}`).disabled = false;
        return { id: f.id, ms, ok: true };
    } catch (err) {
        const ms = performance.now() - start;
        card.classList.add("error");
        const msg = err.name === "TimeoutError" ? "Sin respuesta tras 120 s (el servidor está saturado o lento)" : err.message;
        answer.textContent = `⏱ ${formatTime(ms)}\n\n❌ Error: ${msg}`;
        return { id: f.id, ms, ok: false };
    } finally {
        clearInterval(ticker);
        card.classList.remove("loading");
    }
}

async function fight(question) {
    const btn = $("fight-btn");
    const verdict = $("verdict");
    const maxLines = getMaxLines();
    const prompt = buildPrompt(question, maxLines);
    btn.disabled = true;
    verdict.hidden = true;
    document.querySelectorAll(".card").forEach((c) => c.classList.remove("winner"));

    const results = await Promise.all(fighters.map((f) => runFighter(f, prompt, maxLines)));

    const valid = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
    if (valid.length) {
        const w = valid[0];
        $(`card-${w.id}`).classList.add("winner");
        const name = w.id === "groq" ? "Groq" : "Gemini";
        verdict.textContent = `🏆 ${name} ha sido la más rápida (${formatTime(w.ms)}). ¿Y la mejor respuesta? Eso lo decides tú.`;
        verdict.hidden = false;
    }
    btn.disabled = false;
}

function getMaxLines() {
    const n = parseInt($("max-lines").value, 10);
    return n > 0 ? n : 0;
}

// Pide el límite en el prompt y además lo aplica al mostrar, por si el modelo no obedece
function buildPrompt(question, maxLines) {
    let prompt = question;
    if (attachedFile) {
        prompt += `\n\nContenido del archivo adjunto "${attachedFile.name}":\n"""\n${attachedFile.text}\n"""`;
    }
    if (maxLines) {
        prompt += `\n\nResponde en un máximo de ${maxLines} líneas.`;
    }
    return prompt;
}

function limitLines(text, maxLines) {
    if (!maxLines) return text;
    const lines = text.split("\n").filter((l, i, a) => l.trim() || (a[i - 1] ?? "").trim());
    if (lines.length <= maxLines) return lines.join("\n");
    return `${lines.slice(0, maxLines).join("\n")}\n… (recortado a ${maxLines} líneas)`;
}

let attachedFile = null;

function setAttachment(file) {
    attachedFile = file;
    $("file-name").textContent = file ? `📄 ${file.name}` : "";
    $("file-clear").hidden = !file;
    if (!file) $("file-input").value = "";
}

async function onFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
        alert(`El archivo supera ${MAX_FILE_BYTES / 1024} KB.`);
        return setAttachment(null);
    }
    const text = await file.text();
    if (text.includes("\u0000")) {
        alert("Solo se admiten archivos de texto (txt, md, csv, json, código…).");
        return setAttachment(null);
    }
    setAttachment({ name: file.name, text });
}

document.addEventListener("DOMContentLoaded", () => {
    fighters.forEach((f) => ($(`model-${f.id}`).textContent = f.model));
    fighters.forEach((f) => $(`copy-${f.id}`).addEventListener("click", () => copyAnswer(f.id)));
    $("file-input").addEventListener("change", onFileSelected);
    $("file-clear").addEventListener("click", () => setAttachment(null));

    $("duel-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const prompt = $("prompt").value.trim();
        if (prompt) fight(prompt);
    });

    $("prompt").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            $("duel-form").requestSubmit();
        }
    });
});
