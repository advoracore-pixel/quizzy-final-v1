
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
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // --- PROMPT ENGINEERING ---

    let typeInstructions = "";

    if (config.type === 'Mixed') {
      typeInstructions = `
      - **VARIETY MODE:** You MUST generate a mix of the following question styles (keeping exactly 4 options for ALL):
        1. **Fill-in-the-Blank:** Question contains "______". Options: 4 words to fill it.
        2. **Assertion-Reasoning:** Question: "Assertion (A): ... Reason (R): ...". Options: ["Both True", "A True R False", "A False R True", "Both False"].
        3. **Statement Analysis:** Question: "Which of the following is INCORRECT?". Options: 4 full sentences.
        4. **Standard MCQ:** Direct question. Options: 4 answers.
      - **CRITICAL:** Do NOT generate 2-option True/False. Always use 4 options.
      `;
    } else if (config.type === 'True/False') {
      typeInstructions = `- Format: "Identify the TRUE (or FALSE) statement." Provide exactly 4 distinct statements as options.`;
    } else if (config.type === 'Fill Blanks') {
      typeInstructions = `- Format: A sentence with a missing word "______". Provide exactly 4 word choices as options.`;
    } else {
      typeInstructions = `- Format: Standard Multiple Choice Question with exactly 4 options.`;
    }

    
    const COMMON_RULES = `
    **CRITICAL OUTPUT RULES:**
    1. Return ONLY valid JSON. No Markdown, no backticks, no intro text.
    2. JSON Structure:
       {
         "subject": "Broad Category (MUST BE IN ENGLISH, e.g., Physics, History)", 
         "topicName": "Specific Title (MUST BE IN ENGLISH, e.g., Newton's Laws)",
         "summary": "A short, engaging description (Max 25 words) of what the quiz covers. MUST BE IN ${config.language}. CRITICAL: Do NOT mention 'source', 'image', 'provided text', or 'file'. Just describe the academic topic directly.",
         "questions": [
           {
             "id": 1,
             "question": "Question text in ${config.language}...",
             "options": ["Option A", "Option B", "Option C", "Option D"], // Text in ${config.language}
             "answer": 0, // MUST be an Integer Index (0, 1, 2, or 3)
             "explanation": "Brief reason in ${config.language}."
           }
         ]
       }
    3. QUESTION STYLE RULES:
       ${typeInstructions}
    4. **Ensure exactly 4 options per question.** (Mandatory).
    5. "answer" must be a NUMBER (index), NOT a string.
    6. **STRICT LANGUAGE RULES:**
       - **METADATA (subject, topicName):** You MUST write these strictly in **ENGLISH** (for internal categorization).
       - **CONTENT (summary, question, options, explanation):** You MUST write these in **${config.language}**.
    7. Difficulty: ${config.difficulty}, Count: ${config.count}.
    `;


    // B. Mode-Specific Prompts
    let finalPrompt = "";
    let imagePart = null;

    if (mode === 'topic') {
      finalPrompt = `
      You are a charismatic Quiz Examiner. Create a quiz on the TOPIC: "${content}".
      
      **Content Strategy:**
      1. Analyze the topic string to determine the 'subject' and refined 'topicName'.
      2. Generate a 'summary' (in ${config.language}) that invites the user to take the quiz.
      3. 70% Core Knowledge questions.
      4. 1st question must be EASY (Confidence Booster).
      5. Include 1 question with a humorous tone or funny options (The 'Witty' One).
      
      ${COMMON_RULES}`;

    } else if (mode === 'text') {
      finalPrompt = `
      You are a meticulous Quiz Examiner. Create a quiz based STRICTLY on the following TEXT:
      
      "${content.substring(0, 10000)}" 
      
      **Content Strategy:**
      1. Analyze the text to infer the 'subject' and generate a catchy 'topicName'.
      2. Generate a 'summary' (in ${config.language}) that describes the key themes of the text WITHOUT saying "based on text".
      3. Questions must be answerable from the text.
      4. 1st question: Giveaway/Easy.
      
      ${COMMON_RULES}`;

    } else if (mode === 'file') {
      finalPrompt = `
      You are a Visual Data Analyst. Analyze the provided image/document.
      
      **Task:**
      1. Identify the 'subject' (e.g., if image is a circuit, subject is Physics/Electronics).
      2. Generate a relevant 'topicName' describing the image content.
      3. Generate a 'summary' (in ${config.language}) describing the concept shown (e.g., "Test your understanding of Circuit Diagrams"). DO NOT say "This image shows...".
      4. Extract key concepts and generate questions.
      
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

    // --- GENERATION WITH FAILOVER ---
    let response;
    const modelsToTry = ["gemini-2.5-flash-lite", "gemini-2.5-flash","Gemini-3-Flash"];
    let lastError;

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        let result;
        
        // Safety Settings
        const generationConfig = { responseMimeType: "application/json" };

        if (imagePart) {
          result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: finalPrompt }, imagePart] }],
            generationConfig
          });
        } else {
          result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
            generationConfig
          });
        }
        
        response = await result.response;
        if (response) break;
      } catch (err) {
        lastError = err;
        console.error(`Model ${modelName} failed`, err);
        continue;
      }
    }

    if (!response) throw lastError;

    // --- PROCESSING RESPONSE ---
    let text = response.text();
    text = text.replace(/```json|```/g, '').trim();

    try {
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}') + 1;
      const cleanJson = text.substring(jsonStart, jsonEnd);
      const jsonResponse = JSON.parse(cleanJson);
      return res.status(200).json(jsonResponse);
    } catch (parseError) {
      console.error("JSON Parse Fail:", text);
      throw new Error("AI returned invalid JSON structure");
    }

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

