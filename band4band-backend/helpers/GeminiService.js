import { GoogleGenAI } from '@google/genai';
import { PROMPT_SYSTEM } from './prompts.js';

class GeminiService {
  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  static getInstance() {
    if (!GeminiService.instance) {
      GeminiService.instance = new GeminiService();
    }
    return GeminiService.instance;
  }

  /**
   * Generates a 4-line verse using the provided prompt.
   * @param {string} prompt The populated string template prompt.
   * @returns {Promise<string>} The generated verse.
   */
  async generateVerse(prompt) {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction: PROMPT_SYSTEM,
          temperature: 0.9,
        }
      });
      return response.text;
    } catch (error) {
      console.error("Gemini API Error:", error);
      return "Error generating verse.\nError generating verse.\nError generating verse.\nError generating verse.";
    }
  }

  /**
   * Generates all 16 verses in parallel.
   * @param {string[]} player1Prompts Array of 8 prompts for Player 1.
   * @param {string[]} player2Prompts Array of 8 prompts for Player 2.
   * @returns {Promise<{player1Verses: string[], player2Verses: string[]}>}
   */
  async generateAllVerses(player1Prompts, player2Prompts) {
    const player1Promises = player1Prompts.map(p => this.generateVerse(p));
    const player2Promises = player2Prompts.map(p => this.generateVerse(p));

    const [player1Verses, player2Verses] = await Promise.all([
      Promise.all(player1Promises),
      Promise.all(player2Promises)
    ]);

    return { player1Verses, player2Verses };
  }
}

export default GeminiService.getInstance();
