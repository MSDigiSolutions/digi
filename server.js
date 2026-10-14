const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3000;
const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = "llama3.1";

// ============ BOT RULES ============
// Edit this default however you like — it's injected as an extra system message on
// every request, on top of whatever system prompt the HTML sends. Restart the server
// to pick up changes made here.
//
// You can ALSO change the active rules live from the website (Settings → Bot Rules)
// without restarting the server — that just overwrites `activeRules` below in memory.
// It resets back to DEFAULT_RULES whenever the server restarts.
const DEFAULT_RULES = `- Be encouraging and patient.
- Never just give the final answer straight away for a Questions-mode prompt — guide the student toward it.
- Keep responses free of profanity or inappropriate content.`;

let activeRules = DEFAULT_RULES;

// Response depth -> Ollama generation options.
// num_predict caps how many tokens the model can generate (rough length control).
// "thinker" runs a lower temperature for more focused, deliberate reasoning.
const DEPTH_OPTIONS = {
  low:     { num_predict: 300,  temperature: 0.7 },
  medium:  { num_predict: 800,  temperature: 0.7 },
  high:    { num_predict: 1600, temperature: 0.7 },
  thinker: { num_predict: 2200, temperature: 0.5 }
};

app.use(cors());
// Raised to fit large attachments — base64 encoding inflates file size by roughly a third,
// so this needs real headroom above the 200MB client-side attachment limit.
app.use(express.json({ limit: "300mb" }));

// Serves the tutor HTML + any other static files placed next to server.js
app.use(express.static(__dirname));

// Lets the website read the currently active rules (e.g. to populate a textarea on load).
app.get("/api/rules", (req, res) => {
  res.json({ rules: activeRules, defaultRules: DEFAULT_RULES });
});

// Lets the website overwrite the active rules for live testing — no server restart needed.
// Sending an empty/missing string resets back to DEFAULT_RULES.
app.post("/api/rules", (req, res) => {
  const { rules } = req.body;
  activeRules = (typeof rules === "string" && rules.trim()) ? rules : DEFAULT_RULES;
  console.log("\n[RULES UPDATED]:\n" + activeRules + "\n");
  res.json({ rules: activeRules });
});

app.post("/api/chat", async (req, res) => {
  const { messages, depth } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "Request body must include a 'messages' array." });
  }

  const genOptions = DEPTH_OPTIONS[depth] || DEPTH_OPTIONS.medium;
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
  const promptText = lastUserMsg ? lastUserMsg.content : "(no user message found)";
  const startTime = Date.now();

  // Insert the current bot rules as their own system message, right after the client's
  // system prompt (or at the very front if the client didn't send one). Keeping it as a
  // separate message — rather than string-concatenating it into the client's prompt —
  // means it's easy to log and reason about on its own, and it always wins as the most
  // recent system instruction the model sees.
  const rulesMessage = { role: "system", content: "Additional rules:\n" + activeRules };
  const firstSystemIndex = messages.findIndex(m => m.role === "system");
  const messagesWithRules = [...messages];
  if (firstSystemIndex === -1) {
    messagesWithRules.unshift(rulesMessage);
  } else {
    messagesWithRules.splice(firstSystemIndex + 1, 0, rulesMessage);
  }

  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: messagesWithRules,
        stream: false,
        options: genOptions
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Ollama error:", text);
      return res.status(502).json({ error: "Ollama request failed", detail: text });
    }

    const data = await response.json();
    const thinkingMs = Date.now() - startTime;
    const reply = data.message.content;

    console.log("\n========== NEW EXCHANGE ==========");
    console.log("[PROMPT]:", promptText);
    console.log("[RULES]:", activeRules);
    console.log(`[DEPTH]: ${depth || "medium"} (num_predict: ${genOptions.num_predict}, temp: ${genOptions.temperature})`);
    console.log(`[THINKING TIME]: ${(thinkingMs / 1000).toFixed(2)}s`);
    console.log("[RESPONSE]:", reply);
    console.log("===================================\n");

    // Ollama's /api/chat returns { message: { role, content }, ... }
    res.json({ content: reply });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Could not reach Ollama. Is 'ollama serve' running?" });
  }
});

app.listen(PORT, () => {
  console.log(`AI Tutor server running at http://localhost:${PORT}`);
  console.log(`Forwarding chat requests to Ollama model "${MODEL}" at ${OLLAMA_URL}`);
  console.log(`Active bot rules (edit live via Settings → Bot Rules, or edit DEFAULT_RULES in this file):`);
  console.log(activeRules);
});
