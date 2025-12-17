require("dotenv").config();
const usage = {};

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("❌ Unhandled Rejection:", err);
});

console.log("✅ server.js started");

const express = require("express");
const cors = require("cors");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Serve frontend
app.use(express.static("public"));

// Prompt (single string)
const PROMPT_STRING =
  "You are an assistant for radiology images ONLY (X-ray, CT, MRI, or ultrasound). If the image is NOT a medical radiology image, respond exactly with: \"This is not a radiology image.\" and stop. If it IS a radiology image, respond in the following exact structure: 1) Modality and view. 2) Key findings as bullet points. 3) Most likely impression. 4) Top two differential diagnoses. 5) Urgent red flags to rule out. 6) Advice stating clearly that this is NOT a medical diagnosis and that a qualified clinician must be consulted.";

app.post("/api/analyze", upload.single("image"), async (req, res) => {
  try {
    // ---- Daily usage limit (per IP) ----
    const ip = req.ip;
    const today = new Date().toDateString();

    if (!usage[ip]) usage[ip] = {};
    if (!usage[ip][today]) usage[ip][today] = 0;

    if (usage[ip][today] >= 3) {
      return res.status(429).json({
        error: "Daily free limit reached (3 analyses/day).",
      });
    }

    usage[ip][today]++;

    // ---- Validate upload ----
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    // Convert image bytes -> base64 data URL
    const base64 = req.file.buffer.toString("base64");
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    // ---- Call your Hugging Face Inference Endpoint (MedGemma) ----
    const endpointUrl = process.env.HF_ENDPOINT_URL;
    if (!endpointUrl) {
      return res.status(500).json({ error: "HF_ENDPOINT_URL missing in .env" });
    }
    if (!process.env.HF_TOKEN) {
      return res.status(500).json({ error: "HF_TOKEN missing in .env" });
    }

    const response = await fetch(`${endpointUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/medgemma-27b-it",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT_STRING },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 500,
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    console.error("❌ Analyze error:", err);
    return res.status(500).json({ error: "Failed to analyze image" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
});
