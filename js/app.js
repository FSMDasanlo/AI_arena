"use strict";

const CONFIG = window.APP_CONFIG || {};

const GROQ_MODEL = CONFIG.groqModel || "openai/gpt-oss-120b";
const GEMINI_MODEL = CONFIG.geminiModel || "gemini-3.5-flash-lite";

const TIMEOUT_MS = 120000;
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
        ask: async (prompt, signal, images) => {
            const parts = [{ text: prompt }];
            for (const image of images) {
                parts.push({ text: `Imagen adjunta: ${image.name}` });
                parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
            }
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
                {
                    method: "POST",
                    signal,
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": CONFIG.geminiApiKey,
                    },
                    body: JSON.stringify({ contents: [{ parts }] }),
                }
            );
            const data = await readJson(res);
            const responseParts = data.candidates?.[0]?.content?.parts;
            return responseParts?.map((p) => p.text).join("") || "(respuesta vacía)";
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

async function runFighter(f, prompt, maxLines, attachment) {
    const card = $(`card-${f.id}`);
    const answer = $(`answer-${f.id}`);
    const badge = $(`badge-${f.id}`);

    card.classList.remove("winner", "error");
    card.classList.add("loading");
    badge.textContent = "";
    answers[f.id] = "";
    $(`copy-${f.id}`).disabled = true;
    if (f.id === "groq" && attachment?.images.length && !attachment.text) {
        card.classList.remove("loading");
        answer.textContent = "Groq no participa: el adjunto solo contiene imágenes.";
        return { id: f.id, ok: false };
    }
    answer.textContent = "Pensando…";

    const start = performance.now();
    const ticker = setInterval(() => {
        answer.textContent = `Pensando… ${((performance.now() - start) / 1000).toFixed(0)} s`;
    }, 500);
    try {
        if (!f.hasKey()) throw new Error("Falta la API key en js/config.js");
        const text = limitLines(await f.ask(prompt, AbortSignal.timeout(TIMEOUT_MS), attachment?.images || []), maxLines);
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
    if (processingFile) return;
    const btn = $("fight-btn");
    const verdict = $("verdict");
    const maxLines = getMaxLines();
    const attachment = attachedFile;
    const prompt = buildPrompt(question, maxLines, attachment);
    btn.disabled = true;
    $("file-input").disabled = true;
    $("file-clear").disabled = true;
    verdict.hidden = true;
    document.querySelectorAll(".card").forEach((c) => c.classList.remove("winner"));

    const results = await Promise.all(fighters.map((f) => runFighter(f, prompt, maxLines, attachment)));

    const valid = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);
    if (valid.length && attachment?.images.length && !attachment.text) {
        verdict.textContent = "Solo Gemini ha participado porque el adjunto contiene únicamente imágenes.";
        verdict.hidden = false;
    } else if (valid.length) {
        const w = valid[0];
        $(`card-${w.id}`).classList.add("winner");
        const name = w.id === "groq" ? "Groq" : "Gemini";
        verdict.textContent = `🏆 ${name} ha sido la más rápida (${formatTime(w.ms)}). ¿Y la mejor respuesta? Eso lo decides tú.`;
        if (attachment?.images.length) verdict.textContent += " Groq no recibe las imágenes.";
        verdict.hidden = false;
    }
    btn.disabled = false;
    $("file-input").disabled = false;
    $("file-clear").disabled = false;
}

function getMaxLines() {
    const n = parseInt($("max-lines").value, 10);
    return n > 0 ? n : 0;
}

// Pide el límite en el prompt y además lo aplica al mostrar, por si el modelo no obedece
function buildPrompt(question, maxLines, attachment) {
    let prompt = question;
    if (attachment?.text) {
        prompt += `\n\n${attachment.text}`;
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
let processingFile = false;
let selectionVersion = 0;

function setAttachment(file) {
    attachedFile = file;
    $("file-name").textContent = file ? `📄 ${file.name}` : "";
    $("file-warning").textContent = file ? file.warnings.join("\n") : "";
    $("file-clear").hidden = !file;
    if (!file) $("file-input").value = "";
}

async function onFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;
    const version = ++selectionVersion;
    setAttachment(null);
    processingFile = true;
    $("fight-btn").disabled = true;
    $("file-name").textContent = `Procesando ${file.name}…`;
    $("file-clear").hidden = false;
    try {
        if (!window.ArenaAttachments) throw new Error("Faltan las dependencias de archivos. Ejecuta npm install y npm run build.");
        const attachment = await window.ArenaAttachments.readAttachment(file);
        if (version === selectionVersion) setAttachment(attachment);
    } catch (error) {
        if (version === selectionVersion) {
            setAttachment(null);
            alert(`No se ha podido procesar el archivo: ${error.message}`);
        }
    } finally {
        if (version === selectionVersion) {
            processingFile = false;
            $("fight-btn").disabled = false;
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    fighters.forEach((f) => ($(`model-${f.id}`).textContent = f.model));
    fighters.forEach((f) => $(`copy-${f.id}`).addEventListener("click", () => copyAnswer(f.id)));
    $("file-input").addEventListener("change", onFileSelected);
    $("file-clear").addEventListener("click", () => {
        selectionVersion++;
        processingFile = false;
        $("fight-btn").disabled = false;
        setAttachment(null);
    });

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
