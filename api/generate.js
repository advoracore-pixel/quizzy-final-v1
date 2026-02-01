import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // 1. CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { mode, content, config } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) throw new Error("API Key Missing on Server");

    // Initialize Gemini (1.5 Flash is best for speed + images)
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // --- PROMPT ENGINEERING ---

    // A. Common Rules (Updated for Subject & Topic)
    const COMMON_RULES = `
    **CRITICAL OUTPUT RULES:**
    1. Return ONLY valid JSON. No Markdown, no backticks, no intro text.
    2. JSON Structure:
       {
         "subject": "Broad Academic or Practical Category (e.g., Physics, History, Coding, General Knowledge)",
         "topicName": "Specific, concise title based on content (e.g., Newton's Laws, World War II)",
         "questions": [
           {
             "id": 1,
             "question": "Question text...",
             "options": ["Option A", "Option B", "Option C", "Option D"],
             "answer": 0, // MUST be an Integer Index (0, 1, 2, or 3) pointing to correct option
             "explanation": "Brief reason why."
           }
         ]
       }
    3. Ensure exactly 4 options per question.
    4. "answer" must be a NUMBER (index), NOT a string.
    5. Difficulty: ${config.difficulty}, Language: ${config.language}, Count: ${config.count}, Type: ${config.type}.
    `;

    // B. Mode-Specific Prompts
    let finalPrompt = "";
    let imagePart = null;

    if (mode === 'topic') {
      finalPrompt = `
      You are a charismatic Quiz Examiner. Create a quiz on the TOPIC: "${content}".
      
      **Content Strategy:**
      1. Analyze the topic string to determine the 'subject' and refined 'topicName'.
      2. 70% Core Knowledge questions.
      3. 1st question must be EASY (Confidence Booster).
      4. Include 1 question with a humorous tone or funny options (The 'Witty' One).
      
      ${COMMON_RULES}`;

    } else if (mode === 'text') {
      finalPrompt = `
      You are a meticulous Quiz Examiner. Create a quiz based STRICTLY on the following TEXT:
      
      "${content.substring(0, 10000)}" 
      
      **Content Strategy:**
      1. Analyze the text to infer the 'subject' and generate a catchy 'topicName'.
      2. Questions must be answerable from the text.
      3. 1st question: Giveaway/Easy.
      4. 1 question should test attention to detail (The 'Curveball').
      
      ${COMMON_RULES}`;

    } else if (mode === 'file') {
      finalPrompt = `
      You are a Visual Data Analyst. Analyze the provided image/document.
      
      **Task:**
      1. Identify the 'subject' (e.g., if image is a circuit, subject is Physics/Electronics).
      2. Generate a relevant 'topicName' describing the image content.
      3. Extract key concepts and generate questions.
      
      **Content Strategy:**
      1. If diagram: Ask spatial questions.
      2. If text: Quiz on concepts.
      
      ${COMMON_RULES}`;

      // Handle Base64 Image
      const base64Data = content.split(',')[1];
      const mimeType = content.substring(content.indexOf(':') + 1, content.indexOf(';'));

      imagePart = {
        inlineData: {
          data: base64Data,
          mimeType: mimeType || "image/jpeg"
        }
      };
    }

    // --- GENERATION ---
    let result;
    if (imagePart) {
        result = await model.generateContent([finalPrompt, imagePart]);
    } else {
        result = await model.generateContent(finalPrompt);
    }

    // --- PROCESSING RESPONSE ---
    const response = await result.response;
    let text = response.text();

    // Cleaning Markdown
    text = text.replace(/```json|```/g, '').trim();

    const jsonResponse = JSON.parse(text);

    return res.status(200).json(jsonResponse);

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}
  
