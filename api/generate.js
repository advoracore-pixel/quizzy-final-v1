import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // CORS Headers (Frontend ko allow karne ke liye)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { topic, count, difficulty } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) throw new Error("API Key Missing on Server");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Create a JSON quiz about "${topic}". 
    Count: ${count || 5}. Difficulty: ${difficulty || "Medium"}.
    Format: {"questions": [{"id": 1, "question": "...", "options": ["..."], "answer": "..."}]}.
    Strictly JSON only. No markdown.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().replace(/```json|```/g, '').trim();

    return res.status(200).json({ success: true, data: JSON.parse(text) });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
                                        }
