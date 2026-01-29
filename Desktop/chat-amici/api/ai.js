import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY missing" });
    }

    const { prompt } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const response = await client.responses.create({
      model: "gpt-5",
      input: prompt,
    });

    return res.status(200).json({
      text: response.output_text,
    });
  } catch (err) {
    console.error("AI ERROR:", err);
    return res.status(500).json({
      error: err?.message || "AI error",
    });
  }
}
