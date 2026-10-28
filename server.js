
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Ollama address for local development.
// IMPORTANT: localhost refers to the machine running this server.
// On Render, configure OLLAMA_URL to point to a reachable Ollama service.
const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://localhost:11434/api/chat";

const MODEL = process.env.OLLAMA_MODEL || "llama3.1";

// Default rules for the Learnify AI tutor.
const DEFAULT_RULES = `- Be encouraging and patient.
- Never just give the final answer straight away for a Questions-mode prompt — guide the student toward it.
- Keep responses free of profanity or inappropriate content.`;

let activeRules = DEFAULT_RULES;

// Response depth settings.
const DEPTH_OPTIONS = {
  low: { num_predict: 300, temperature: 0.7 },
  medium: { num_predict: 800, temperature: 0.7 },
  high: { num_predict: 1600, temperature: 0.7 },
  thinker: { num_predict: 2200, temperature: 0.5 }
};

app.use(cors());

// Keep the JSON limit as low as practical for public deployment.
// Increase it only if your app genuinely needs large JSON uploads.
app.use(express.json({ limit: "10mb" }));

// Serve the website files located beside server.js.
app.use(express.static(__dirname));

// Get the active tutor rules.
app.get("/api/rules", (req, res) => {
  res.json({
    rules: activeRules,
    defaultRules: DEFAULT_RULES
  });
});

// Update the active tutor rules in memory.
app.post("/api/rules", (req, res) => {
  const { rules } = req.body || {};

  activeRules =
    typeof rules === "string" && rules.trim()
      ? rules
      : DEFAULT_RULES;

  console.log("[RULES UPDATED]:", activeRules);

  res.json({ rules: activeRules });
});

// Send a chat request to Ollama.
app.post("/api/chat", async (req, res) => {
  const { messages, depth } = req.body || {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({
      error: "Request body must include a 'messages' array."
    });
  }

  const genOptions = DEPTH_OPTIONS[depth] || DEPTH_OPTIONS.medium;

  const lastUserMsg = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  const promptText = lastUserMsg
    ? lastUserMsg.content
    : "(no user message found)";

  const rulesMessage = {
    role: "system",
    content: "Additional rules:\n" + activeRules
  };

  const messagesWithRules = [...messages];
  const firstSystemIndex = messagesWithRules.findIndex(
    (message) => message.role === "system"
  );

  if (firstSystemIndex === -1) {
    messagesWithRules.unshift(rulesMessage);
  } else {
    messagesWithRules.splice(firstSystemIndex + 1, 0, rulesMessage);
  }

  const startTime = Date.now();

  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messagesWithRules,
        stream: false,
        options: genOptions
      })
    });

    if (!response.ok) {
      const detail = await response.text();

      console.error("Ollama request failed:", detail);

      return res.status(502).json({
        error: "Ollama request failed.",
        detail
      });
    }

    const data = await response.json();
    const reply = data?.message?.content;

    if (typeof reply !== "string") {
      return res.status(502).json({
        error: "Ollama returned an unexpected response."
      });
    }

    const elapsedSeconds = (
      (Date.now() - startTime) / 1000
    ).toFixed(2);

    console.log("========== LEARNIFY CHAT ==========");
    console.log("Prompt:", promptText);
    console.log("Depth:", depth || "medium");
    console.log("Response time:", elapsedSeconds + "s");
    console.log("===================================");

    return res.json({ content: reply });
  } catch (error) {
    console.error("Could not connect to Ollama:", error.message);

    return res.status(502).json({
      error:
        "Could not reach Ollama. Check that the Ollama service is running and OLLAMA_URL is correct."
    });
  }
});

// Start the server on Render's assigned port.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Learnify server listening on port ${PORT}`);
  console.log(`Ollama endpoint: ${OLLAMA_URL}`);
  console.log(`Ollama model: ${MODEL}`);
});
